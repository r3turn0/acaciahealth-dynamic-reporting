/**
 * POST /api/fix-query
 *
 * Receives a broken SQL query along with error context and schema metadata,
 * then uses the AI to produce a repaired query with explanation + diff.
 *
 * Request body:
 *   userQuery      – original natural-language request
 *   generatedSQL   – the SQL that failed
 *   apiError       – HTTP / API level error string
 *   dbErrorLogs    – raw database error message
 *   metadata       – schema object (tables + columns). Falls back to public/metadata.json
 *   userFeedback   – optional user-provided hint text
 *
 * Response:
 *   fixedSQL       – corrected SQL string
 *   explanation    – human-readable summary of what was changed
 *   confidence     – 0–1 score
 *   changes        – array of { type, from, to } diff items
 *   autoRetry      – boolean: true when confidence >= 0.9
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import { getModel, getModelId } from "@/lib/ai/gateway";

// ── Response schema ───────────────────────────────────────────────────────────

const FixResponseSchema = z.object({
  fixedSQL: z.string().describe("The corrected, executable SQL query."),
  explanation: z
    .string()
    .describe("One or two sentences explaining exactly what was wrong and what was changed."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence that the fix is correct (0.0–1.0)."),
  changes: z
    .array(
      z.object({
        type: z
          .enum([
            "column_fix",
            "table_fix",
            "syntax_fix",
            "join_fix",
            "filter_fix",
            "function_fix",
            "schema_prefix",
            "other",
          ])
          .describe("Category of the change."),
        from: z.string().describe("Original (wrong) token or clause."),
        to: z.string().describe("Replacement token or clause."),
        reason: z.string().optional().describe("Why this change was made."),
      })
    )
    .describe("Structured list of specific changes made."),
});

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert SQL engineer for healthcare analytics systems (Microsoft SQL Server / T-SQL).

GOAL:
Fix broken SQL queries using database error messages, API errors, and schema metadata.

STRICT RULES:
1. NEVER invent tables or columns — only use names present in the metadata.
2. Always qualify table names with their schema prefix (e.g. Accounting.CASH_DEPOSITS).
3. Prioritize fixing based on error messages first, then schema validation.
4. Maintain the original intent of the query exactly.
5. Produce valid, executable T-SQL.
6. If user feedback hints at the problem, use it to guide the fix.

THINKING PROCESS:
1. Identify the root cause from the DB error logs / API error.
2. Map incorrect identifiers to exact names in the metadata.
3. Fix joins, filters, schema prefixes, or syntax.
4. Validate every referenced identifier against the schema before outputting.
5. Assign a confidence score: 1.0 = certain fix, 0.5 = educated guess.

OUTPUT:
Return ONLY valid JSON matching the schema provided. Do not wrap in markdown code fences.`;

// ── Route handler ─────────────────────────────────────────────────────────────

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

  // Resolve metadata: prefer inline payload, then fall back to the bundled file.
  let metadata = inlineMetadata;
  if (!metadata) {
    try {
      const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
      metadata = JSON.parse(raw);
    } catch {
      metadata = { tables: [], note: "metadata unavailable" };
    }
  }

  const userPrompt = buildPrompt({
    userQuery,
    generatedSQL,
    apiError,
    dbErrorLogs,
    metadata,
    userFeedback,
  });

  try {
    const result = await generateText({
      model: getModel("capable"),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      experimental_output: Output.object({ schema: FixResponseSchema }),
      temperature: 0.05,
    });

    const fix = result.experimental_output;

    return NextResponse.json({
      ...fix,
      autoRetry: fix.confidence >= 0.9,
      meta: { model: getModelId("capable") },
    });
  } catch (err) {
    console.error("[fix-query] AI call failed:", err);

    // Best-effort heuristic fallback
    const heuristic = heuristicFix(generatedSQL, dbErrorLogs, metadata);
    return NextResponse.json({
      ...heuristic,
      autoRetry: heuristic.confidence >= 0.9,
      meta: { model: "heuristic", fallback: true },
    });
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt({
  userQuery,
  generatedSQL,
  apiError,
  dbErrorLogs,
  metadata,
  userFeedback,
}: {
  userQuery: string;
  generatedSQL: string;
  apiError: string;
  dbErrorLogs: string;
  metadata: unknown;
  userFeedback: string;
}) {
  const parts: string[] = [];

  if (userQuery.trim()) parts.push(`USER INTENT:\n${userQuery}`);
  parts.push(`BROKEN SQL:\n${generatedSQL}`);
  if (apiError.trim()) parts.push(`API ERROR:\n${apiError}`);
  if (dbErrorLogs.trim()) parts.push(`DATABASE ERROR LOGS:\n${dbErrorLogs}`);
  if (userFeedback.trim()) parts.push(`USER FEEDBACK / HINT:\n${userFeedback}`);

  // Compact metadata — only include schema + table + column names + types to stay within context
  const compactMeta = compactMetadata(metadata);
  parts.push(`SCHEMA METADATA:\n${JSON.stringify(compactMeta, null, 2)}`);

  return parts.join("\n\n---\n\n");
}

// Reduce the full metadata.json to only what the AI needs
function compactMetadata(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const m = raw as { tables?: unknown[] };
  if (!Array.isArray(m.tables)) return raw;

  return {
    tables: m.tables.map((t: unknown) => {
      const table = t as {
        schema?: string;
        table?: string;
        // generic schema shapes
        name?: string;
        columns?: unknown[];
        foreign_keys?: unknown[];
        primary_keys?: unknown[];
      };
      return {
        table: table.schema ? `${table.schema}.${table.table}` : (table.name ?? table.table),
        columns: Array.isArray(table.columns)
          ? table.columns.map((c: unknown) => {
              const col = c as { name?: string; data_type?: string; type?: string; nullable?: boolean };
              return {
                name: col.name,
                type: col.data_type ?? col.type,
                nullable: col.nullable,
              };
            })
          : [],
        foreign_keys: Array.isArray(table.foreign_keys)
          ? table.foreign_keys.map((fk: unknown) => {
              const f = fk as {
                name?: string;
                from?: { schema?: string; table?: string; columns?: string[] };
                to?: { schema?: string; table?: string; columns?: string[] };
              };
              return {
                from: f.from
                  ? `${f.from.schema}.${f.from.table}(${(f.from.columns ?? []).join(",")})`
                  : undefined,
                to: f.to
                  ? `${f.to.schema}.${f.to.table}(${(f.to.columns ?? []).join(",")})`
                  : undefined,
              };
            })
          : [],
      };
    }),
  };
}

// ── Heuristic fallback ────────────────────────────────────────────────────────

function heuristicFix(
  sql: string,
  dbError: string,
  metadata: unknown
): {
  fixedSQL: string;
  explanation: string;
  confidence: number;
  changes: { type: string; from: string; to: string; reason?: string }[];
} {
  const changes: { type: string; from: string; to: string; reason?: string }[] = [];
  let fixed = sql;

  // Extract "Invalid column name 'X'" patterns from SQL Server errors
  const colMatches = [...dbError.matchAll(/invalid column name ['"]?([a-z0-9_]+)['"]?/gi)];
  const tblMatches = [...dbError.matchAll(/invalid object name ['"]?([a-z0-9_.]+)['"]?/gi)];

  const allColumns = extractAllColumns(metadata);
  const allTables = extractAllTables(metadata);

  for (const m of colMatches) {
    const bad = m[1];
    const best = bestMatch(bad, allColumns);
    if (best && best !== bad) {
      fixed = fixed.replace(new RegExp(`\\b${bad}\\b`, "gi"), best);
      changes.push({ type: "column_fix", from: bad, to: best, reason: "Matched against schema metadata" });
    }
  }

  for (const m of tblMatches) {
    const bad = m[1];
    const best = bestMatch(bad.split(".").pop() ?? bad, allTables.map((t) => t.split(".").pop() ?? t));
    if (best) {
      const fullTable = allTables.find((t) => t.endsWith(best)) ?? best;
      fixed = fixed.replace(new RegExp(`\\b${bad.replace(".", "\\.")}\\b`, "gi"), fullTable);
      changes.push({ type: "table_fix", from: bad, to: fullTable, reason: "Schema prefix added" });
    }
  }

  const confidence = changes.length > 0 ? 0.65 : 0.3;

  return {
    fixedSQL: fixed,
    explanation:
      changes.length > 0
        ? `Heuristic fix applied ${changes.length} correction(s) based on error message pattern matching.`
        : "Could not automatically determine a fix. Review the error logs and schema manually.",
    confidence,
    changes,
  };
}

function extractAllColumns(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as { tables?: unknown[] };
  if (!Array.isArray(m.tables)) return [];
  const cols: string[] = [];
  for (const t of m.tables) {
    const table = t as { columns?: unknown[] };
    if (Array.isArray(table.columns)) {
      for (const c of table.columns) {
        const col = c as { name?: string };
        if (col.name) cols.push(col.name);
      }
    }
  }
  return [...new Set(cols)];
}

function extractAllTables(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as { tables?: unknown[] };
  if (!Array.isArray(m.tables)) return [];
  return m.tables.map((t: unknown) => {
    const table = t as { schema?: string; table?: string; name?: string };
    return table.schema ? `${table.schema}.${table.table}` : (table.name ?? table.table ?? "");
  });
}

function bestMatch(bad: string, candidates: string[]): string | null {
  const b = bad.toLowerCase();
  // 1. Exact match (case-insensitive)
  const exact = candidates.find((c) => c.toLowerCase() === b);
  if (exact) return exact;
  // 2. Substring match
  const sub = candidates.find((c) => c.toLowerCase().includes(b) || b.includes(c.toLowerCase()));
  if (sub) return sub;
  // 3. Levenshtein distance <= 3
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(b, c.toLowerCase());
    if (d < bestDist && d <= 3) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}
