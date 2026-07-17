/**
 * POST /api/fix-query
 *
 * Self-healing SQL repair.
 *
 * Flow:
 *  1. Embed the user query → retrieve top-8 relevant context docs via pgvector
 *  2. Build a repair prompt injecting: broken SQL, errors, context, schema, user hint
 *  3. Call OpenAI gpt-4o (via OPENAI_API_KEY or AI Gateway fallback) for JSON output
 *  4. Return fixedSQL + explanation + confidence + structured change diff
 *
 * Request:
 *   userQuery      – original natural-language intent
 *   generatedSQL   – the SQL that failed
 *   apiError       – HTTP-level error string
 *   dbErrorLogs    – raw database error message
 *   metadata       – optional inline schema (falls back to public/metadata.json)
 *   userFeedback   – optional user hint
 *
 * Response:
 *   fixedSQL, explanation, confidence, changes[], autoRetry
 */

import { NextRequest, NextResponse } from "next/server";
import { chatJSON } from "@/lib/ai/gateway";
import { vectorSearch, formatVectorContext } from "@/lib/ai/vectorSearch";
import { readFileSync } from "fs";
import { join } from "path";
import { runSelfHealingPipeline } from "@/lib/sql/pipeline";

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert SQL engineer for healthcare analytics on Microsoft SQL Server (T-SQL).

GOAL: Fix broken SQL queries using database error messages, API errors, vector context, and schema metadata.

STRICT RULES:
1. NEVER invent tables or columns — only use names present in the metadata or context.
2. Always qualify table names with their schema prefix (e.g. Accounting.CASH_DEPOSITS).
3. Prioritize fixing based on the error message first, then schema validation.
4. Maintain the original intent of the query exactly.
5. Produce valid, executable T-SQL.
6. Use user feedback hints to guide the fix.

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "fixedSQL": "<corrected T-SQL>",
  "explanation": "<one or two sentences describing what was wrong and what changed>",
  "confidence": <0.0 to 1.0>,
  "changes": [
    { "type": "column_fix|table_fix|syntax_fix|join_fix|filter_fix|function_fix|schema_prefix|other", "from": "<original>", "to": "<replacement>", "reason": "<optional why>" }
  ]
}`;

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    userQuery = "",
    generatedSQL = "",
    apiError = "",
    dbErrorLogs = "",
    metadata: inlineMetadata,
    userFeedback = "",
  } = body as {
    userQuery: string;
    generatedSQL: string;
    apiError: string;
    dbErrorLogs: string;
    metadata?: unknown;
    userFeedback?: string;
  };

  if (!generatedSQL.trim()) {
    return NextResponse.json({ error: "generatedSQL is required" }, { status: 400 });
  }

  // Step 1: vector search for relevant context
  const vectorResults = await vectorSearch({ query: userQuery || generatedSQL, topK: 8 });
  const vectorContext = formatVectorContext(vectorResults);

  // Step 2: resolve schema metadata
  let metadata = inlineMetadata;
  if (!metadata) {
    try {
      const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
      metadata = JSON.parse(raw);
    } catch {
      metadata = { tables: [] };
    }
  }

  // Run 3-tier self-healing pipeline first (deterministic before AI)
  const pipelineResult = await runSelfHealingPipeline({
    sql:      generatedSQL,
    dbError:  dbErrorLogs || apiError,
    userQuery,
  });

  // If deterministic tier fixed it, return immediately without an AI call
  if (pipelineResult.tier === "deterministic" && pipelineResult.valid) {
    return NextResponse.json({
      fixedSQL:    pipelineResult.sql,
      explanation: pipelineResult.explanation,
      confidence:  0.85,
      changes:     pipelineResult.changes,
      autoRetry:   true,
      tier:        "deterministic",
      meta:        { model: "deterministic", fallback: false },
    });
  }

  // Tier 3: Step 3: build prompt
  const parts: string[] = [];
  if (userQuery.trim()) parts.push(`USER INTENT:\n${userQuery}`);
  parts.push(`BROKEN SQL:\n${generatedSQL}`);
  if (apiError.trim()) parts.push(`API ERROR:\n${apiError}`);
  if (dbErrorLogs.trim()) parts.push(`DATABASE ERROR:\n${dbErrorLogs}`);
  if (userFeedback.trim()) parts.push(`USER HINT:\n${userFeedback}`);
  parts.push(`RELEVANT CONTEXT (vector search):\n${vectorContext}`);
  parts.push(`SCHEMA METADATA:\n${JSON.stringify(compactMetadata(metadata), null, 2)}`);
  const userPrompt = parts.join("\n\n---\n\n") + "\n\nReturn ONLY valid JSON.";

  try {
    const fix = await chatJSON<{
      fixedSQL: string;
      explanation: string;
      confidence: number;
      changes: { type: string; from: string; to: string; reason?: string }[];
    }>(SYSTEM_PROMPT, userPrompt);

    return NextResponse.json({
      fixedSQL: fix.fixedSQL ?? generatedSQL,
      explanation: fix.explanation ?? "",
      confidence: fix.confidence ?? 0.5,
      changes: fix.changes ?? [],
      autoRetry: (fix.confidence ?? 0) >= 0.9,
      tier: "ai_fallback",
      meta: { model: "gpt-4o" },
    });
  } catch (err) {
    console.error("[fix-query] AI call failed:", err);
    const heuristic = heuristicFix(generatedSQL, dbErrorLogs, metadata);
    return NextResponse.json({
      ...heuristic,
      autoRetry: heuristic.confidence >= 0.9,
      meta: { model: "heuristic", fallback: true },
    });
  }
}

// ── Compact metadata helper ───────────────────────────────────────────────────

function compactMetadata(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const m = raw as { tables?: unknown[] };
  if (!Array.isArray(m.tables)) return raw;
  return {
    tables: m.tables.map((t: unknown) => {
      const table = t as { schema?: string; table?: string; name?: string; columns?: unknown[]; foreign_keys?: unknown[] };
      return {
        table: table.schema ? `${table.schema}.${table.table}` : (table.name ?? table.table),
        columns: Array.isArray(table.columns)
          ? table.columns.map((c: unknown) => {
              const col = c as { name?: string; data_type?: string; type?: string; nullable?: boolean };
              return { name: col.name, type: col.data_type ?? col.type, nullable: col.nullable };
            })
          : [],
        foreign_keys: Array.isArray(table.foreign_keys)
          ? table.foreign_keys.map((fk: unknown) => {
              const f = fk as { from?: { schema?: string; table?: string; columns?: string[] }; to?: { schema?: string; table?: string; columns?: string[] } };
              return {
                from: f.from ? `${f.from.schema}.${f.from.table}(${(f.from.columns ?? []).join(",")})` : undefined,
                to: f.to ? `${f.to.schema}.${f.to.table}(${(f.to.columns ?? []).join(",")})` : undefined,
              };
            })
          : [],
      };
    }),
  };
}

// ── Heuristic fallback ────────────────────────────────────────────────────────

function heuristicFix(sql: string, dbError: string, metadata: unknown) {
  const changes: { type: string; from: string; to: string; reason?: string }[] = [];
  let fixed = sql;

  const allColumns = extractAll(metadata, "columns");
  const allTables = extractAll(metadata, "tables");

  for (const m of [...dbError.matchAll(/invalid column name ['"]?([a-z0-9_]+)['"]?/gi)]) {
    const bad = m[1];
    const best = bestMatch(bad, allColumns);
    if (best && best !== bad) {
      fixed = fixed.replace(new RegExp(`\\b${bad}\\b`, "gi"), best);
      changes.push({ type: "column_fix", from: bad, to: best });
    }
  }
  for (const m of [...dbError.matchAll(/invalid object name ['"]?([a-z0-9_.]+)['"]?/gi)]) {
    const bad = m[1];
    const short = bad.split(".").pop() ?? bad;
    const best = bestMatch(short, allTables.map((t) => t.split(".").pop() ?? t));
    if (best) {
      const full = allTables.find((t) => t.endsWith(best)) ?? best;
      fixed = fixed.replace(new RegExp(`\\b${bad.replace(".", "\\.")}\\b`, "gi"), full);
      changes.push({ type: "table_fix", from: bad, to: full });
    }
  }

  return {
    fixedSQL: fixed,
    explanation: changes.length > 0
      ? `Heuristic applied ${changes.length} correction(s) from error pattern matching.`
      : "Could not determine a fix automatically — review schema and error logs.",
    confidence: changes.length > 0 ? 0.65 : 0.3,
    changes,
  };
}

function extractAll(metadata: unknown, mode: "columns" | "tables"): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as { tables?: unknown[] };
  if (!Array.isArray(m.tables)) return [];
  const out: string[] = [];
  for (const t of m.tables) {
    const table = t as { schema?: string; table?: string; name?: string; columns?: unknown[] };
    if (mode === "tables") {
      out.push(table.schema ? `${table.schema}.${table.table}` : (table.name ?? table.table ?? ""));
    } else {
      for (const c of table.columns ?? []) {
        const col = c as { name?: string };
        if (col.name) out.push(col.name);
      }
    }
  }
  return [...new Set(out)];
}

function bestMatch(bad: string, candidates: string[]): string | null {
  const b = bad.toLowerCase();
  const exact = candidates.find((c) => c.toLowerCase() === b);
  if (exact) return exact;
  const sub = candidates.find((c) => c.toLowerCase().includes(b) || b.includes(c.toLowerCase()));
  if (sub) return sub;
  let best: string | null = null, bestDist = Infinity;
  for (const c of candidates) {
    const d = lev(b, c.toLowerCase());
    if (d < bestDist && d <= 3) { bestDist = d; best = c; }
  }
  return best;
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}
