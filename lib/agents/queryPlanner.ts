/**
 * AI Query Planner Agent
 * Converts natural language → structured SQL plan using Azure OpenAI via AI SDK 6.
 * Falls back to the rule-based queryGenerator when the AI key is not configured.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import schemaConfig from "../config/schemaConfig.json";
import kpiConfig from "../config/kpiConfig.json";
import semanticLayer from "../config/semanticLayer.json";

// ── Output schema ─────────────────────────────────────────────────────────────

export const QueryPlanSchema = z.object({
  sql: z.string().describe("The complete, parameterized T-SQL SELECT query"),
  explanation: z.string().describe("Plain-English explanation of what the query does"),
  tables_used: z.array(z.string()).describe("Physical table names referenced"),
  filters_applied: z.array(z.string()).describe("Human-readable list of filters"),
  kpi_detected: z.string().nullable().describe("The KPI category detected, or null"),
  strategy: z.enum(["sql", "api_fallback"]).describe("Execution strategy chosen"),
  api_fallback_reason: z.string().nullable().describe("Why SQL was not possible, if applicable"),
  cost_warning: z.string().nullable().describe("Warning if the query may be expensive, otherwise null"),
  optimized_suggestion: z.string().nullable().describe("An optimized alternative SQL if cost warning applies, otherwise null"),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const schemaJSON = JSON.stringify(schemaConfig, null, 2);
  const kpiJSON = JSON.stringify(kpiConfig, null, 2);
  const semanticJSON = JSON.stringify(semanticLayer, null, 2);

  return `You are an expert healthcare data analyst and T-SQL query planner for AcaciaHealth.
Your job is to convert natural language questions into safe, optimized T-SQL SELECT queries.

## Strict Rules (NEVER violate these)
- ONLY generate SELECT statements. Never UPDATE, DELETE, INSERT, DROP, TRUNCATE, CREATE, or EXEC.
- Never use SELECT *. Always name explicit columns.
- Always include a WHERE clause with @StartDate and @EndDate parameters.
- Always include TOP 10000 to cap result size.
- Never use CROSS JOIN.
- Never expose sensitive columns (SSN, DateOfBirth) unless specifically asked — and even then use masking expressions from the semantic layer.
- All string comparisons on branch codes must use RTRIM() on both sides.

## AcaciaHealth Schema
\`\`\`json
${schemaJSON}
\`\`\`

## KPI Definitions
\`\`\`json
${kpiJSON}
\`\`\`

## Semantic Layer (business term → physical mapping)
\`\`\`json
${semanticJSON}
\`\`\`

## T-SQL Date Parameters
Always use these named parameters:
- @StartDate (MSSQL Date type)
- @EndDate   (MSSQL Date type)

## Query Cost Rules
Flag a cost_warning if the query:
- Joins more than 3 large tables
- Has no GROUP BY but requests millions of rows
- Scans the entire CLIENT_EPISODES_ALL without a branch filter
In those cases, also provide an optimized_suggestion.

## API Fallback
If the request genuinely cannot be answered with SQL (e.g., asks for a live external API, real-time scheduling, document retrieval), set strategy = "api_fallback" and explain why.

## Example SQL pattern
SELECT TOP 10000
    RTRIM(b.branch_name) AS branch_name,
    DATEPART(WEEK, epi.epi_SocDate) AS week_number,
    COUNT(*) AS admissions
FROM CLIENT_EPISODES_ALL epi
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(b.branch_name), DATEPART(WEEK, epi.epi_SocDate)
ORDER BY week_number, branch_name`;
}

// ── Planner function ──────────────────────────────────────────────────────────

export interface PlannerInput {
  prompt: string;
  startDate: string;
  endDate: string;
  branchCode?: string;
  role?: "admin" | "analyst" | "viewer";
}

export async function planQuery(input: PlannerInput): Promise<QueryPlan> {
  const { prompt, startDate, endDate, branchCode, role = "analyst" } = input;

  const userMessage = `
Convert the following natural language request into a T-SQL query plan.

Request: "${prompt}"

Date range: ${startDate} to ${endDate}
${branchCode ? `Branch filter: ${branchCode}` : ""}
User role: ${role}

Return a structured QueryPlan object.
`.trim();

  const model = process.env.AZURE_OPENAI_DEPLOYMENT
    ? `azure/${process.env.AZURE_OPENAI_DEPLOYMENT}`
    : "openai/gpt-4o-mini";

  const result = await generateText({
    model,
    system: buildSystemPrompt(),
    prompt: userMessage,
    experimental_output: Output.object({ schema: QueryPlanSchema }),
    temperature: 0.1,
  });

  return result.experimental_output as QueryPlan;
}
