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

/**
 * DEPRECATED — use POST /api/generate-query/correct instead.
 * This route is kept for backward compatibility with WorkspacePage and FeedbackModal.
 * It will be removed in a future release.
 */
function withDeprecationHeaders(res: NextResponse): NextResponse {
  res.headers.set("Deprecation", "true");
  res.headers.set("Sunset", "2026-10-01");
  res.headers.set("Link", '</api/generate-query/correct>; rel="successor-version"');
  res.headers.set("X-Deprecated-By", "/api/generate-query/correct");
  return res;
}
import { vectorSearch, formatVectorContext } from "@/lib/ai/vectorSearch";
import { readFileSync } from "fs";
import { join } from "path";
import { runSelfHealingPipeline } from "@/lib/sql/pipeline";
import { retryWithSchemaIntelligence } from "@/lib/agents/SchemaAwareRetryAgent";
import { validateReadOnlySql } from "@/lib/services/queryGuard";

function validateRepair(sql: string) {
  const validation = validateReadOnlySql(sql);
  if (validation.valid) return null;
  return withDeprecationHeaders(NextResponse.json({
    error: "The generated repair was blocked by read-only validation.",
    code: "SECURITY_VALIDATION_FAILED",
    category: "validation",
    retryable: false,
    recovery: ["edit_sql", "fix_query"],
    details: validation.errors,
  }, { status: 422 }));
}

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
    start_date,
    end_date,
    branch_code,
  } = body as {
    userQuery: string;
    generatedSQL: string;
    apiError: string;
    dbErrorLogs: string;
    metadata?: unknown;
    userFeedback?: string;
    start_date?: string;
    end_date?: string;
    branch_code?: string;
  };

  // Default dates: last 30 days if not provided
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const startDate = start_date ?? thirtyDaysAgo.toISOString().split("T")[0];
  const endDate   = end_date   ?? today.toISOString().split("T")[0];

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

  // Tier 1: If deterministic pipeline fixed it, return immediately
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

  // Tier 2: Phase 8-10 Schema-Aware Retry (failure classification + KG + learned mappings)
  if (userQuery.trim() || generatedSQL.trim()) {
    try {
      const retryResult = await retryWithSchemaIntelligence({
        userRequest: userQuery.trim() || generatedSQL.trim().slice(0, 200),
        startDate,
        endDate,
        branchCode: branch_code,
        failedSql: generatedSQL,
        errorMessage: dbErrorLogs || apiError,
      });

      if (retryResult.succeeded && retryResult.correctedSql) {
        const blockedRepair = validateRepair(retryResult.correctedSql);
        if (blockedRepair) return blockedRepair;
        return NextResponse.json({
          fixedSQL:    retryResult.correctedSql,
          explanation: retryResult.explanation,
          confidence:  0.88,
          changes: retryResult.attempts.flatMap((a) =>
            a.success ? [{ type: "ai_retry", from: "failed_sql", to: "corrected_sql", reason: a.remediationStrategy }] : []
          ),
          autoRetry:   true,
          tier:        "schema_aware_retry",
          retry_info:  {
            attempted:           true,
            succeeded:           true,
            totalAttempts:       retryResult.totalAttempts,
            failureClass:        retryResult.failureClass,
            learnedMappingsUsed: retryResult.learnedMappingsUsed,
          },
          meta: { model: "SchemaAwareRetryAgent", fallback: false },
        });
      }

      // Retry agent exhausted — pass failure context to AI tier
      if (retryResult.attempts.length > 0) {
        const lastAttempt = retryResult.attempts[retryResult.attempts.length - 1];
        // Inject failure context into user feedback so AI tier benefits from it
        const failureContext = `[Failure class: ${retryResult.failureClass}] [Tried: ${retryResult.totalAttempts} correction(s)]\n` +
          `Last strategy: ${lastAttempt.remediationStrategy}`;
        if (!userFeedback) (body as Record<string, unknown>)["_retryContext"] = failureContext;
      }
    } catch (retryErr) {
      console.error("[fix-query] SchemaAwareRetryAgent error:", retryErr);
      // Fall through to AI tier
    }
  }

  // Tier 3: AI fallback — build prompt with vector context + schema
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

    const fixedSQL = fix.fixedSQL ?? generatedSQL;
    const blockedRepair = validateRepair(fixedSQL);
    if (blockedRepair) return blockedRepair;
    return withDeprecationHeaders(NextResponse.json({
      fixedSQL,
      explanation: fix.explanation ?? "",
      confidence: fix.confidence ?? 0.5,
      changes: fix.changes ?? [],
      autoRetry: (fix.confidence ?? 0) >= 0.9,
      tier: "ai_fallback",
      retry_info: { attempted: false, succeeded: false, totalAttempts: 0, failureClass: "unknown", learnedMappingsUsed: 0 },
      meta: { model: "gpt-4o" },
    }));
  } catch (err) {
    console.error("[fix-query] AI call failed:", err);
    const heuristic = heuristicFix(generatedSQL, dbErrorLogs, metadata);
    const blockedRepair = validateRepair(heuristic.fixedSQL);
    if (blockedRepair) return blockedRepair;
    return withDeprecationHeaders(NextResponse.json({
      ...heuristic,
      autoRetry: heuristic.confidence >= 0.9,
      tier: "heuristic",
      retry_info: { attempted: false, succeeded: false, totalAttempts: 0, failureClass: "unknown", learnedMappingsUsed: 0 },
      meta: { model: "heuristic", fallback: true },
    }));
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
