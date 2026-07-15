/**
 * POST /api/generate-sql
 *
 * Vector-augmented natural language → SQL generation.
 * Uses the system prompt from user attachment + vector context retrieval.
 *
 * Request:
 *   userQuery      – natural language question
 *   savedReports   – optional: saved report objects for vector corpus
 *   fixLog         – optional: fix history entries for vector corpus
 *
 * Response:
 *   sql            – generated T-SQL string
 *   explanation    – one-sentence description of what the query does
 *   confidence     – 0–1 confidence score
 *   sourcesUsed    – corpus document IDs / labels used in context
 *   vectorResults  – top-K vector search results (for observability)
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId, isAiConfigured } from "@/lib/ai/gateway";
import { vectorSearch, formatVectorContext } from "@/lib/ai/vectorSearch";
import { readFileSync } from "fs";
import { join } from "path";

// ── Response schema ───────────────────────────────────────────────────────────

const GenerateSQLSchema = z.object({
  sql: z.string().describe("The generated, executable T-SQL query."),
  explanation: z.string().describe("One sentence explaining what the query returns."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence that the SQL is correct (0.0–1.0)."),
  sourcesUsed: z
    .array(z.string())
    .describe("Labels of schema/report/history sources used."),
  tablesReferenced: z
    .array(z.string())
    .describe("Fully-qualified table names referenced in the SQL."),
});

// ── System prompt (from user attachment) ─────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert healthcare SQL engineer for Microsoft SQL Server (T-SQL).

You have access to:
1. Relevant schema context (from vector search) — tables, columns, relationships
2. Past queries and fixes — what has worked before
3. Saved reports — reusable patterns from real business questions

STRICT RULES:
- NEVER invent schema. Only use table/column names present in the retrieved context or metadata.
- ALWAYS qualify table names with their schema prefix (e.g. Accounting.CASH_DEPOSITS).
- PRIORITIZE retrieved context over assumptions. Use saved report patterns when relevant.
- REUSE patterns from past successful queries and fixes.
- Generate valid, executable T-SQL (SQL Server syntax).
- Use DATEADD / DATEDIFF / GETDATE() for date arithmetic, not NOW() or DATE_SUB().
- Use TOP N instead of LIMIT N.
- Always alias aggregated columns (e.g. SUM(...) AS total_amount).
- Include ORDER BY for analytical queries.

GOAL:
Generate accurate, production-ready T-SQL for the user query using only grounded schema context.

OUTPUT:
Return ONLY valid JSON matching the schema. Do not wrap in markdown code fences.`;

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const {
    userQuery = "",
    savedReports = [],
    fixLog = [],
  } = body as {
    userQuery: string;
    savedReports?: unknown[];
    fixLog?: unknown[];
  };

  if (!userQuery.trim()) {
    return NextResponse.json({ error: "userQuery is required" }, { status: 400 });
  }

  // Step 1: Vector search — retrieve relevant schema + reports + history
  const vectorResults = await vectorSearch({
    query: userQuery,
    topK: 10,
    savedReports: savedReports as Parameters<typeof vectorSearch>[0]["savedReports"],
    fixLog: fixLog as Parameters<typeof vectorSearch>[0]["fixLog"],
  });

  const vectorContext = formatVectorContext(vectorResults);
  const sourcesUsed = vectorResults.map((r) => r.content.slice(0, 80));

  // Step 2: Load compact metadata for full schema grounding
  let compactSchema = "";
  try {
    const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
    const meta = JSON.parse(raw) as { tables?: unknown[] };
    if (Array.isArray(meta.tables)) {
      const tableLines = meta.tables
        .map((t: unknown) => {
          const table = t as {
            schema?: string;
            table?: string;
            name?: string;
            columns?: Array<{ name?: string; data_type?: string }>;
          };
          const full = table.schema ? `${table.schema}.${table.table}` : (table.name ?? "");
          const cols = (table.columns ?? []).map((c) => c.name).filter(Boolean).join(", ");
          return `${full}: ${cols}`;
        })
        .slice(0, 60) // cap to avoid context overflow
        .join("\n");
      compactSchema = tableLines;
    }
  } catch {
    compactSchema = "(metadata unavailable)";
  }

  // Step 3: Build the user prompt
  const userPrompt = buildPrompt(userQuery, vectorContext, compactSchema);

  // If AI not configured, fall back to deterministic SQL builder
  if (!isAiConfigured()) {
    const fallback = buildDemoSQL(userQuery);
    return NextResponse.json({
      sql: fallback,
      explanation: "Rule-based SQL generated (AI not configured).",
      confidence: 0.5,
      sourcesUsed: [],
      tablesReferenced: [],
      vectorResults,
      meta: { model: "heuristic", fallback: true },
    });
  }

  try {
    const result = await generateText({
      model: getModel("capable"),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      experimental_output: Output.object({ schema: GenerateSQLSchema }),
      temperature: 0.05,
    });

    const gen = result.experimental_output;

    // Auto-trigger fix if confidence is low
    const needsFix = gen.confidence < 0.7;

    return NextResponse.json({
      ...gen,
      needsFix,
      vectorResults,
      meta: { model: getModelId("capable"), fallback: false },
    });
  } catch (err) {
    console.error("[generate-sql] AI call failed:", err);

    const fallback = buildDemoSQL(userQuery);
    return NextResponse.json({
      sql: fallback,
      explanation: "Rule-based fallback (AI error).",
      confidence: 0.5,
      sourcesUsed,
      tablesReferenced: [],
      vectorResults,
      needsFix: false,
      meta: { model: "heuristic", fallback: true },
    });
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(userQuery: string, vectorContext: string, compactSchema: string): string {
  return `RELEVANT CONTEXT (from vector search):
${vectorContext}

---

FULL SCHEMA REFERENCE (table: columns):
${compactSchema}

---

USER QUERY:
"${userQuery}"

Generate the SQL. Return ONLY valid JSON.`;
}

// ── Rule-based fallback SQL ───────────────────────────────────────────────────

function buildDemoSQL(q: string): string {
  const lower = q.toLowerCase();

  if (lower.includes("cash deposit") || lower.includes("deposit")) {
    return `SELECT
  cd.cd_branchcode,
  SUM(cd.cd_initialamount) AS total_deposits,
  COUNT(*) AS deposit_count
FROM Accounting.CASH_DEPOSITS cd
WHERE cd.cd_insertdate >= DATEADD(month, -1, GETDATE())
GROUP BY cd.cd_branchcode
ORDER BY total_deposits DESC;`;
  }

  if (lower.includes("revenue") || lower.includes("conversion")) {
    return `SELECT
  rct.rct_step,
  COUNT(*) AS step_count,
  SUM(CAST(rct.rct_finished AS int)) AS finished_count
FROM Accounting.REVENUE_CONVERSION_TRACKER rct
GROUP BY rct.rct_step
ORDER BY step_count DESC;`;
  }

  if (lower.includes("claim") || lower.includes("episode")) {
    return `SELECT
  cea.ce_branchcode,
  COUNT(*) AS episode_count,
  SUM(cea.ce_totalcharges) AS total_charges
FROM dbo.CLIENT_EPISODES_ALL cea
WHERE cea.ce_admitdate >= DATEADD(month, -1, GETDATE())
GROUP BY cea.ce_branchcode
ORDER BY episode_count DESC;`;
  }

  if (lower.includes("patient") || lower.includes("client")) {
    return `SELECT TOP 100
  cl.cl_clientid,
  cl.cl_firstname,
  cl.cl_lastname,
  cl.cl_branchcode
FROM dbo.CLIENTS cl
WHERE cl.cl_status = 'A'
ORDER BY cl.cl_insertdate DESC;`;
  }

  return `SELECT TOP 100
  *
FROM dbo.CLIENT_EPISODES_ALL
WHERE ce_admitdate >= DATEADD(month, -1, GETDATE())
ORDER BY ce_admitdate DESC;`;
}
