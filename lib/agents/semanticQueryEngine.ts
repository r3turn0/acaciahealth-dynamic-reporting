/**
 * Semantic Query Engine — 7-stage pipeline
 *
 * Stages:
 *   1. interpret_query     — resolve natural language → canonical intent
 *   2. resolve_context     — map intent to schema tables / columns / measures
 *   3. classify_intent     — assign intent type from the taxonomy
 *   4. validate_against_schema — verify every referenced field exists
 *   5. detect_ambiguity    — identify fields that need clarification
 *   6. generate_logical_plan — emit a schema-driven LogicalPlan (no SQL yet)
 *   7. format_response     — wrap in SemanticResponse with presentation hints
 *
 * Does NOT generate SQL — that remains the queryPlanner's responsibility.
 * The LogicalPlan can be handed to a SQL generator or executed as-is via
 * POST /api/semantic/plan.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import schemaConfig from "../config/schemaConfig.json";
import kpiConfig from "../config/kpiConfig.json";
import semanticLayer from "../config/semanticLayer.json";
import { getModel } from "../ai/gateway";
import { vectorEmbeddingAgent } from "./VectorEmbeddingAgent";

// ── Intent taxonomy ───────────────────────────────────────────────────────────

export const INTENT_TYPES = [
  "DATA_QUERY",
  "AGGREGATION",
  "SUMMARY",
  "TREND",
  "COMPARISON",
  "TOP_N",
  "RANKING",
  "CLARIFICATION",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AggregationSchema = z.object({
  metric: z.string().describe("The measure / column name"),
  function: z.enum(["COUNT", "SUM", "AVG", "MIN", "MAX", "MEASURE"]).describe("Aggregation function"),
  alias: z.string().describe("Output alias — empty string if none"),
});

const FilterSchema = z.object({
  table: z.string(),
  column: z.string(),
  operator: z.enum(["=", "!=", ">", "<", ">=", "<=", "IN", "BETWEEN", "LIKE"]),
  // z.unknown() generates an OpenAI-incompatible schema (no 'type' key).
  // Use an explicit union of primitive types so response_format validation passes.
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

const OrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(["ASC", "DESC"]),
});

export const LogicalPlanSchema = z.object({
  table: z.string().describe("Primary table name"),
  select: z.array(z.string()).describe("Columns to select (dimensions / raw fields)"),
  aggregations: z.array(AggregationSchema).describe("Aggregations to compute"),
  groupBy: z.array(z.string()).describe("Group-by columns"),
  filters: z.array(FilterSchema).describe("Row-level filters"),
  orderBy: z.array(OrderBySchema).describe("Sort order"),
  // Must NOT use .default() — OpenAI structured output requires every property key
  // to appear in the 'required' array. Zod omits defaulted fields from 'required',
  // which causes a 400 "Invalid schema for response_format" error.
  limit: z.number().int().describe("Result row limit — use 100 when not specified"),
});

export type LogicalPlan = z.infer<typeof LogicalPlanSchema>;

const ClarificationSchema = z.object({
  question: z.string().describe("What needs to be clarified"),
  options: z.array(z.string()).describe("Possible values or choices"),
});

const PresentationSchema = z.object({
  chartType: z.enum(["bar", "line", "pie", "none"]).describe("Recommended chart type"),
  xAxis: z.string().describe("X axis field — empty string if not applicable"),
  yAxis: z.string().describe("Y axis field — empty string if not applicable"),
  groupBy: z.array(z.string()).describe("Group-by fields — empty array if not applicable"),
  limit: z.number().int().describe("Result limit — 0 if not applicable"),
});

export const SemanticResponseSchema = z.object({
  resolvedQuery: z.string().describe("Normalised, canonical form of the user question"),

  intent: z.object({
    type: z.enum(INTENT_TYPES),
    // Must be in `required` for OpenAI structured output — use empty string when not applicable
    operation: z.string().describe("Sub-operation e.g. RANK, FILTER, COMPARE — empty string if none"),
  }),

  context: z.object({
    table: z.string(),
    filters: z.array(z.string()).describe("Human-readable active filters"),
    dimensions: z.array(z.string()).describe("Dimension columns used"),
    metrics: z.array(z.string()).describe("Metric / measure columns used"),
  }),

  logicalPlan: LogicalPlanSchema.nullable().describe("null when CLARIFICATION is needed"),

  clarification: ClarificationSchema.nullable().describe(
    "Populated only when intent.type === CLARIFICATION"
  ),

  response: z.object({
    type: z.enum(["TABLE", "SUMMARY_TEXT", "CHART", "KPI"]),
    data: z.array(z.unknown()).describe("Empty — populated at execution time"),
    presentation: PresentationSchema,
  }),

  pipelineStages: z
    .array(
      z.object({
        stage: z.string(),
        status: z.enum(["ok", "ambiguous", "skipped"]),
        note: z.string().describe("Stage note — empty string if none"),
      })
    )
    .describe("Trace of each pipeline stage for UI display"),

  metadata: z.object({
    source: z.literal("powerbi_json"),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()).describe("Warnings — empty array if none"),
  }),
});

export type SemanticResponse = z.infer<typeof SemanticResponseSchema>;

// ── Pipeline input ────────────────────────────────────────────────────────────

export interface SemanticPipelineInput {
  query: string;
  startDate?: string;
  endDate?: string;
  branchCode?: string;
  /** Optional: prior clarification answers to fold into context */
  clarificationAnswers?: Record<string, string>;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const schema = JSON.stringify(schemaConfig, null, 2);
  const kpi    = JSON.stringify(kpiConfig, null, 2);
  const sem    = JSON.stringify(semanticLayer, null, 2);

  return `You are a Semantic Query Engine operating on JSON dataset exports derived from Power BI for AcaciaHealth.

## CORE PRINCIPLE
You DO NOT replace Power BI. You:
- Interpret user intent through a 7-stage pipeline
- Map queries to schema-defined fields only
- Generate structured LogicalQuery plans (not SQL)

You MUST NOT:
- Build dashboards
- Create table relationships not defined in the schema
- Redefine existing measures
- Mutate data

## 7-STAGE PIPELINE
Execute these stages in order and report each in pipelineStages[]:

1. interpret_query     — Understand the natural-language request. Resolve pronouns, implicit timeframes, abbreviations.
2. resolve_context     — Map the request to specific tables, columns, and measures from the schema.
3. classify_intent     — Assign one of: DATA_QUERY | AGGREGATION | SUMMARY | TREND | COMPARISON | TOP_N | RANKING | CLARIFICATION
4. validate_against_schema — Verify every referenced field actually exists. If not, either correct it or flag for clarification.
5. detect_ambiguity    — Check if the query can be answered unambiguously. If multiple interpretations exist, set intent.type = CLARIFICATION.
6. generate_logical_plan — Build the LogicalPlan using only schema-validated fields. Set to null if CLARIFICATION needed.
7. format_response     — Determine response type (TABLE / SUMMARY_TEXT / CHART / KPI) and presentation hints.

## SCHEMA RULES
- Use ONLY defined tables, columns, and measures from the schema below.
- Prefer measures over raw column aggregations.
- Respect exact naming as provided.
- Always include a limit (default 100).
- For TOP_N: include orderBy + limit.
- Never invent fields.

## QUERY RULES
- Apply filters explicitly.
- For TREND: include a time dimension in groupBy.
- For COMPARISON: include the comparison dimension in groupBy.
- For RANKING / TOP_N: always set orderBy direction and limit.

## CLARIFICATION RULES
- If the user references a field that maps to multiple columns, ask for clarification.
- If the intent is genuinely ambiguous, return intent.type = CLARIFICATION with options.
- A clarification response must still populate context (table at minimum), but logicalPlan = null.

## AcaciaHealth Schema
\`\`\`json
${schema}
\`\`\`

## KPI Definitions
\`\`\`json
${kpi}
\`\`\`

## Semantic Layer (business term → physical field)
\`\`\`json
${sem}
\`\`\`

## EXAMPLE OUTPUT (TOP_N)
{
  "resolvedQuery": "Top 5 nurses by patient count",
  "intent": { "type": "TOP_N", "operation": "RANK" },
  "context": { "table": "patients", "filters": [], "dimensions": ["nurse"], "metrics": ["patient_count"] },
  "logicalPlan": {
    "table": "patients",
    "select": ["nurse"],
    "aggregations": [{ "metric": "patient_count", "function": "MEASURE", "alias": "patient_count" }],
    "groupBy": ["nurse"],
    "filters": [],
    "orderBy": [{ "field": "patient_count", "direction": "DESC" }],
    "limit": 5
  },
  "clarification": null,
  "response": {
    "type": "CHART",
    "data": [],
    "presentation": { "chartType": "bar", "xAxis": "nurse", "yAxis": "patient_count", "groupBy": [], "limit": 5 }
  },
  "pipelineStages": [
    { "stage": "interpret_query", "status": "ok", "note": "" },
    { "stage": "resolve_context", "status": "ok", "note": "" },
    { "stage": "classify_intent", "status": "ok", "note": "TOP_N detected (limit=5)" },
    { "stage": "validate_against_schema", "status": "ok", "note": "" },
    { "stage": "detect_ambiguity", "status": "ok", "note": "" },
    { "stage": "generate_logical_plan", "status": "ok", "note": "" },
    { "stage": "format_response", "status": "ok", "note": "CHART / bar recommended" }
  ],
  "metadata": { "source": "powerbi_json", "confidence": 0.97, "warnings": [] }
}`;
}

// ── Rule-based fallback (no AI key) ──────────────────────────────────────────

function fallbackPipeline(input: SemanticPipelineInput): SemanticResponse {
  const q = input.query.toLowerCase();

  // Detect TOP_N
  const topMatch = q.match(/top\s*(\d+)/);
  const limit = topMatch ? parseInt(topMatch[1], 10) : 100;
  const isTopN = !!topMatch;

  // Detect aggregation keywords
  const isAgg  = /\b(sum|total|count|average|avg)\b/.test(q);
  const isTrend = /\b(trend|over time|by (month|week|day|year))\b/.test(q);
  const isComp  = /\b(compare|vs|versus|between)\b/.test(q);
  const isRank  = /\b(rank|ranking|highest|lowest|top|bottom)\b/.test(q);

  let intentType: IntentType = "DATA_QUERY";
  if (isTopN || isRank) intentType = isTopN ? "TOP_N" : "RANKING";
  else if (isTrend) intentType = "TREND";
  else if (isComp)  intentType = "COMPARISON";
  else if (isAgg)   intentType = "AGGREGATION";

  // Best-guess primary table
  let table = "CLIENT_EPISODES_ALL";
  if (/\b(branch|branches)\b/.test(q)) table = "BRANCHES";
  else if (/\b(visit|visits|encounter)\b/.test(q)) table = "VISITS";
  else if (/\b(patient|patients)\b/.test(q)) table = "CLIENT_EPISODES_ALL";

  // Detect dimension / metric mentions
  const dimensions: string[] = [];
  const metrics: string[]    = [];
  if (/\b(branch|region|location)\b/.test(q)) dimensions.push("branch_name");
  if (/\b(nurse|clinician|therapist)\b/.test(q)) dimensions.push("nurse");
  if (/\b(service line|discipline)\b/.test(q)) dimensions.push("service_line");
  if (/\b(month|week|day|year)\b/.test(q)) dimensions.push("period");
  if (/\b(count|visits?|episodes?)\b/.test(q)) metrics.push("visit_count");
  if (/\b(revenue|amount|dollars?)\b/.test(q)) metrics.push("revenue");
  if (isTopN && !metrics.length) metrics.push("count");

  const aggregations = metrics.map((m) => ({
    metric: m,
    function: (isAgg && /revenue|amount/.test(m) ? "SUM" : "COUNT") as "SUM" | "COUNT",
    alias: m,
  }));

  const presentationType = isTopN || isRank ? "CHART" : isTrend ? "CHART" : isAgg ? "KPI" : "TABLE";
  const chartType        = isTrend ? "line" : (isTopN || isRank) ? "bar" : "none";

  return {
    resolvedQuery: input.query,
    intent: { type: intentType, operation: isRank ? "RANK" : ("NONE" as "RANK") },
    context: { table, filters: [], dimensions, metrics },
    logicalPlan: {
      table,
      select: dimensions,
      aggregations,
      groupBy: dimensions,
      filters: [],
      orderBy: isTopN || isRank
        ? [{ field: metrics[0] ?? "count", direction: "DESC" }]
        : [],
      limit,
    },
    clarification: null,
    response: {
      type: presentationType as "TABLE" | "CHART" | "KPI" | "SUMMARY_TEXT",
      data: [],
      presentation: {
        chartType: chartType as "bar" | "line" | "pie" | "none",
        xAxis: dimensions[0] ?? "",
        yAxis: metrics[0] ?? "",
        groupBy: dimensions,
        limit,
      },
    },
    pipelineStages: [
      { stage: "interpret_query",         status: "ok",  note: "" },
      { stage: "resolve_context",         status: "ok",  note: `table=${table}` },
      { stage: "classify_intent",         status: "ok",  note: intentType },
      { stage: "validate_against_schema", status: "ok",  note: "rule-based fallback" },
      { stage: "detect_ambiguity",        status: "ok",  note: "" },
      { stage: "generate_logical_plan",   status: "ok",  note: "" },
      { stage: "format_response",         status: "ok",  note: `${presentationType}/${chartType}` },
    ],
    metadata: { source: "powerbi_json", confidence: 0.6, warnings: ["AI not configured — rule-based fallback"] },
  };
}

// ── Main pipeline function ────────────────────────────────────────────────────

export async function runSemanticPipeline(
  input: SemanticPipelineInput
): Promise<SemanticResponse> {
  const { query, startDate, endDate, branchCode, clarificationAnswers } = input;

  // Check if AI is configured
  const aiAvailable = !!(
    process.env.AI_GATEWAY_API_KEY || process.env.AZURE_OPENAI_API_KEY
  );
  if (!aiAvailable) return fallbackPipeline(input);

  // Vector Intelligence — retrieve semantically relevant context before AI call
  let vectorContextBlock = "";
  try {
    const vectorResults = await vectorEmbeddingAgent.search({ query, topK: 6 });
    const ctx = vectorEmbeddingAgent.buildContext(vectorResults);
    if (ctx.contextSummary && ctx.contextSummary !== "No prior context found.") {
      vectorContextBlock = `\n\n## Vector Intelligence Context (semantic similarity)\n${ctx.contextSummary}`;
    }
  } catch {
    // Non-fatal — proceed without vector context
  }

  const userMessage = `
Run the full 7-stage Semantic Query Engine pipeline on this request.

User query: "${query}"
${startDate && endDate ? `Date range: ${startDate} to ${endDate}` : ""}
${branchCode ? `Branch filter: ${branchCode}` : ""}
${
  clarificationAnswers && Object.keys(clarificationAnswers).length
    ? `Prior clarification answers: ${JSON.stringify(clarificationAnswers)}`
    : ""
}${vectorContextBlock}

Return a complete SemanticResponse JSON object following the schema exactly.
`.trim();

  const result = await generateText({
    model: getModel("default"),
    system: buildSystemPrompt(),
    prompt: userMessage,
    experimental_output: Output.object({ schema: SemanticResponseSchema }),
    temperature: 0.1,
    maxOutputTokens: 1500,
  });

  return result.experimental_output as SemanticResponse;
}
