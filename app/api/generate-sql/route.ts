/**
 * POST /api/generate-sql
 *
 * Vector-augmented NL → SQL generation.
 *
 * Flow:
 *  1. Embed the user query
 *  2. Retrieve top-10 relevant context docs from pgvector (schema + reports + fixes)
 *  3. Build a grounded system prompt + context block
 *  4. Call OpenAI gpt-4o (via OPENAI_API_KEY or AI Gateway fallback) for JSON output
 *
 * Request:
 *   userQuery      – natural language question
 *   savedReports   – optional saved report objects for in-process corpus
 *   fixLog         – optional fix history entries for in-process corpus
 *
 * Response:
 *   sql            – generated T-SQL string
 *   explanation    – one-sentence description
 *   confidence     – 0–1 confidence score
 *   sourcesUsed    – vector context labels injected into prompt
 *   tablesReferenced – fully-qualified table names in the SQL
 *   needsFix       – true when confidence < 0.7
 */

import { NextRequest, NextResponse } from "next/server";
import { chatJSON, isAiConfigured } from "@/lib/ai/gateway";
import { vectorSearch, formatVectorContext } from "@/lib/ai/vectorSearch";
import { readFileSync } from "fs";
import { join } from "path";

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert healthcare SQL engineer for Microsoft SQL Server (T-SQL).

You have access to:
1. Relevant schema context retrieved via vector search — tables, columns, relationships
2. Past queries and fixes — what has worked before
3. Saved reports — reusable patterns from real business questions

STRICT RULES:
- NEVER invent schema. Only use table/column names present in the retrieved context.
- ALWAYS qualify table names with their schema prefix (e.g. Accounting.CASH_DEPOSITS).
- PRIORITIZE retrieved context over assumptions. Use saved report patterns when relevant.
- Generate valid, executable T-SQL (SQL Server syntax).
- Use DATEADD / DATEDIFF / GETDATE() for date arithmetic, not NOW() or DATE_SUB().
- Use TOP N instead of LIMIT N.
- Always alias aggregated columns (e.g. SUM(...) AS total_amount).
- Include ORDER BY for analytical queries.

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "sql": "<T-SQL string>",
  "explanation": "<one sentence>",
  "confidence": <0.0 to 1.0>,
  "sourcesUsed": ["<label>", ...],
  "tablesReferenced": ["Schema.Table", ...]
}`;

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userQuery = "", savedReports = [], fixLog = [] } = body as {
    userQuery: string;
    savedReports?: unknown[];
    fixLog?: unknown[];
  };

  if (!userQuery.trim()) {
    return NextResponse.json({ error: "userQuery is required" }, { status: 400 });
  }

  // Step 1: vector search for relevant context
  const vectorResults = await vectorSearch({
    query: userQuery,
    topK: 10,
    savedReports: savedReports as Parameters<typeof vectorSearch>[0]["savedReports"],
    fixLog: fixLog as Parameters<typeof vectorSearch>[0]["fixLog"],
  });

  const vectorContext = formatVectorContext(vectorResults);
  const sourcesUsed = vectorResults.map((r) => r.content.slice(0, 80));

  // Step 2: compact full schema for grounding
  let compactSchema = "(metadata unavailable)";
  try {
    const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
    const meta = JSON.parse(raw) as { tables?: unknown[] };
    if (Array.isArray(meta.tables)) {
      compactSchema = meta.tables
        .slice(0, 60)
        .map((t: unknown) => {
          const table = t as { schema?: string; table?: string; name?: string; columns?: Array<{ name?: string }> };
          const full = table.schema ? `${table.schema}.${table.table}` : (table.name ?? "");
          const cols = (table.columns ?? []).map((c) => c.name).filter(Boolean).join(", ");
          return `${full}: ${cols}`;
        })
        .join("\n");
    }
  } catch { /* ok */ }

  // Fallback when AI not configured
  if (!isAiConfigured()) {
    const sql = buildDemoSQL(userQuery);
    return NextResponse.json({
      sql,
      explanation: "Rule-based SQL generated (AI not configured).",
      confidence: 0.5,
      sourcesUsed: [],
      tablesReferenced: [],
      needsFix: false,
      vectorResults,
      meta: { model: "heuristic", fallback: true },
    });
  }

  // Step 3: build user prompt
  const userPrompt = `RELEVANT CONTEXT (from vector search):
${vectorContext}

---

FULL SCHEMA REFERENCE (table: columns):
${compactSchema}

---

USER QUERY:
"${userQuery}"

Return ONLY valid JSON.`;

  try {
    const gen = await chatJSON<{
      sql: string;
      explanation: string;
      confidence: number;
      sourcesUsed: string[];
      tablesReferenced: string[];
    }>(SYSTEM_PROMPT, userPrompt);

    return NextResponse.json({
      sql: gen.sql ?? "",
      explanation: gen.explanation ?? "",
      confidence: gen.confidence ?? 0.5,
      sourcesUsed: gen.sourcesUsed ?? sourcesUsed,
      tablesReferenced: gen.tablesReferenced ?? [],
      needsFix: (gen.confidence ?? 0.5) < 0.7,
      vectorResults,
      meta: { model: "gpt-4o", fallback: false },
    });
  } catch (err) {
    console.error("[generate-sql] AI call failed:", err);
    const sql = buildDemoSQL(userQuery);
    return NextResponse.json({
      sql,
      explanation: "Rule-based fallback (AI error).",
      confidence: 0.5,
      sourcesUsed,
      tablesReferenced: [],
      needsFix: false,
      vectorResults,
      meta: { model: "heuristic", fallback: true },
    });
  }
}

// ── Rule-based fallback SQL ───────────────────────────────────────────────────

function buildDemoSQL(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes("cash deposit") || lower.includes("deposit")) {
    return `SELECT cd.cd_branchcode, SUM(cd.cd_initialamount) AS total_deposits, COUNT(*) AS deposit_count
FROM Accounting.CASH_DEPOSITS cd
WHERE cd.cd_insertdate >= DATEADD(month, -1, GETDATE())
GROUP BY cd.cd_branchcode
ORDER BY total_deposits DESC;`;
  }
  if (lower.includes("revenue") || lower.includes("conversion")) {
    return `SELECT rct.rct_step, COUNT(*) AS step_count, SUM(CAST(rct.rct_finished AS int)) AS finished_count
FROM Accounting.REVENUE_CONVERSION_TRACKER rct
GROUP BY rct.rct_step
ORDER BY step_count DESC;`;
  }
  if (lower.includes("claim") || lower.includes("episode")) {
    return `SELECT cea.ce_branchcode, COUNT(*) AS episode_count, SUM(cea.ce_totalcharges) AS total_charges
FROM dbo.CLIENT_EPISODES_ALL cea
WHERE cea.ce_admitdate >= DATEADD(month, -1, GETDATE())
GROUP BY cea.ce_branchcode
ORDER BY episode_count DESC;`;
  }
  return `SELECT TOP 100 * FROM dbo.CLIENT_EPISODES_ALL WHERE ce_admitdate >= DATEADD(month, -1, GETDATE()) ORDER BY ce_admitdate DESC;`;
}
