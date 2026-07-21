/**
 * lib/ai/promptTemplates.ts
 *
 * Schema-aware prompt template builder for AcaciaHealth's AI query engine.
 *
 * Responsibilities:
 *  - Injects the full schema context (tables, joins, columns) into every prompt
 *  - Embeds KPI definitions so the model knows formula semantics upfront
 *  - Includes the semantic layer (business term → physical column mappings)
 *  - Adds thesaurus-derived hints when table tags are available
 *  - Produces consistent user-turn messages for NL→SQL, correction, and KPI tasks
 */

import schemaConfig from "@/lib/config/schemaConfig.json";
import kpiConfig from "@/lib/config/kpiConfig.json";
import semanticLayer from "@/lib/config/semanticLayer.json";
import {
  buildSQLPlannerSystemPrompt,
  buildSQLCorrectionSystemPrompt,
  buildInsightsSystemPrompt,
} from "@/lib/ai/insightAgentPrompt";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromptContext {
  /** Natural-language user request */
  userPrompt: string;
  startDate: string;
  endDate: string;
  branchCode?: string;
  role?: "admin" | "analyst" | "viewer";
  /** Optional thesaurus tags detected in the user prompt */
  detectedTags?: string[];
  /** Optional relevant table names suggested by the semantic search layer */
  suggestedTables?: string[];
}

export interface CorrectionContext extends PromptContext {
  failedSQL: string;
  errorMessage: string;
  attemptNumber: number;
}

export interface KpiInterpretationContext {
  kpiName: string;
  formula: string;
  value: number;
  unit: string;
  target?: number | null;
  trend?: "improving" | "declining" | "stable" | null;
  trendDelta?: number | null;
  rows: Record<string, unknown>[];
}

// ── Shared schema block ───────────────────────────────────────────────────────

function buildSchemaBlock(): string {
  const lines: string[] = [];

  lines.push("## Physical Schema");
  for (const [table, cfg] of Object.entries(schemaConfig as Record<string, { alias: string; keys: string[]; joins: Record<string, string> }>)) {
    lines.push(`\n### ${table} (alias: ${cfg.alias})`);
    lines.push(`  Primary keys: ${cfg.keys.join(", ")}`);
    if (Object.keys(cfg.joins).length) {
      lines.push("  Join conditions:");
      for (const [target, condition] of Object.entries(cfg.joins)) {
        lines.push(`    → ${target}: ${condition}`);
      }
    }
  }

  lines.push("\n## Semantic Layer (business term → physical column)");
  const sl = semanticLayer as {
    tables: Record<string, { physical_name: string; alias: string; synonyms: string[]; description: string }>;
    metrics: Record<string, { expression: string; description: string }>;
    time_intelligence: Record<string, string>;
    sensitive_columns: string[];
    masked_columns: Record<string, string>;
  };

  lines.push("\nBusiness tables:");
  for (const [name, t] of Object.entries(sl.tables)) {
    lines.push(`  ${name} → ${t.physical_name} (${t.alias}) | synonyms: ${t.synonyms.join(", ")}`);
    lines.push(`    ${t.description}`);
  }

  lines.push("\nPre-built metric expressions:");
  for (const [name, m] of Object.entries(sl.metrics)) {
    lines.push(`  ${name}: ${m.expression}  — ${m.description}`);
  }

  lines.push("\nTime intelligence patterns (replace {{date_col}} with the actual column):");
  for (const [grain, expr] of Object.entries(sl.time_intelligence)) {
    lines.push(`  ${grain}: ${expr}`);
  }

  lines.push(`\nSENSITIVE columns (never expose raw): ${sl.sensitive_columns.join(", ")}`);
  lines.push("Masked expressions:");
  for (const [col, mask] of Object.entries(sl.masked_columns)) {
    lines.push(`  ${col} → ${mask}`);
  }

  return lines.join("\n");
}

function buildKpiBlock(): string {
  const lines = ["## KPI Catalogue"];
  for (const [kpi, cfg] of Object.entries(kpiConfig as unknown as Record<string, {
    fact_table: string; alias: string; date_column: string;
    aggregation: string; label: string; description: string;
  }>)) {
    lines.push(`\n### ${kpi} (${cfg.label})`);
    lines.push(`  Table: ${cfg.fact_table} (${cfg.alias})  Date column: ${cfg.date_column}`);
    lines.push(`  Aggregation: ${cfg.aggregation}`);
    lines.push(`  Description: ${cfg.description}`);
  }
  return lines.join("\n");
}

const CORE_RULES = `## Non-Negotiable Rules
- ONLY generate SELECT statements. Never UPDATE, DELETE, INSERT, DROP, TRUNCATE, CREATE, EXEC, ALTER.
- Never use SELECT *. Always name explicit columns.
- Always include a WHERE clause with @StartDate and @EndDate parameters (MSSQL date params).
- Always include TOP 10000 to cap result size.
- Never use CROSS JOIN.
- Never expose sensitive columns (SSN, DateOfBirth, MRN) — use the masked expressions above.
- All branch code comparisons must use RTRIM() on both sides: RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
- Use NOLOCK hints on large tables: FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
- Prefer DATEPART over CONVERT for grouping by time periods.`;

const CONFIDENCE_RULES = `## Confidence Score
Return a confidenceScore (0.0–1.0) reflecting how well the SQL matches the request:
- 0.9–1.0: Exact match, all dimensions resolved, no ambiguity
- 0.7–0.89: Good match, minor assumptions made
- 0.5–0.69: Partial match, some terms were approximated
- 0.3–0.49: Significant guessing, multiple interpretations possible
- 0.0–0.29: Cannot confidently answer; flag for clarification`;

// ── System prompt for NL→SQL ──────────────────────────────────────────────────

export function buildSQLSystemPrompt(): string {
  const schemaJSON   = JSON.stringify(schemaConfig, null, 2);
  const kpiJSON      = JSON.stringify(kpiConfig, null, 2);
  const semanticJSON = JSON.stringify(semanticLayer, null, 2);
  return buildSQLPlannerSystemPrompt(schemaJSON, kpiJSON, semanticJSON);
}

// ── System prompt for query correction ───────────────────────────────────────

export function buildCorrectionSystemPrompt(): string {
  const schemaJSON   = JSON.stringify(schemaConfig, null, 2);
  const kpiJSON      = JSON.stringify(kpiConfig, null, 2);
  const semanticJSON = JSON.stringify(semanticLayer, null, 2);
  return buildSQLCorrectionSystemPrompt(schemaJSON, kpiJSON, semanticJSON);
}

// ── System prompt for KPI interpretation ─────────────────────────────────────

export function buildKpiInterpretationSystemPrompt(): string {
  return buildInsightsSystemPrompt();
}

// ── User turn message builders ────────────────────────────────────────────────

export function buildSQLUserMessage(ctx: PromptContext): string {
  const parts: string[] = [
    `Convert the following natural language request into a T-SQL query plan.`,
    ``,
    `Request: "${ctx.userPrompt}"`,
    `Date range: ${ctx.startDate} to ${ctx.endDate}`,
  ];

  if (ctx.branchCode) {
    parts.push(`Branch filter: ${ctx.branchCode}`);
  }

  if (ctx.role) {
    parts.push(`User role: ${ctx.role} (analysts can see all branches; viewers are restricted to their own branch)`);
  }

  if (ctx.detectedTags?.length) {
    parts.push(`\nDetected intent tags from healthcare thesaurus: ${ctx.detectedTags.join(", ")}`);
    parts.push("Use these tags to select the most relevant tables and columns.");
  }

  if (ctx.suggestedTables?.length) {
    parts.push(`\nSemantic search suggests these tables are most relevant: ${ctx.suggestedTables.join(", ")}`);
    parts.push("Strongly prefer these tables unless there is a clear reason to use others.");
  }

  parts.push(`\nReturn a structured QueryPlan JSON object.`);
  return parts.join("\n");
}

export function buildCorrectionUserMessage(ctx: CorrectionContext): string {
  return [
    `Fix the following failing T-SQL query for AcaciaHealth.`,
    ``,
    `Original user request: "${ctx.userPrompt}"`,
    `Date range: ${ctx.startDate} to ${ctx.endDate}`,
    `Attempt number: ${ctx.attemptNumber}`,
    ``,
    `Failed SQL:`,
    "```sql",
    ctx.failedSQL,
    "```",
    ``,
    `Error message: ${ctx.errorMessage}`,
    ``,
    `Please fix the SQL, preserve the original intent, and return a corrected QueryPlan JSON.`,
    `Be specific about what you changed and why in the explanation field.`,
  ].join("\n");
}

export function buildKpiInterpretationUserMessage(ctx: KpiInterpretationContext): string {
  const sample = ctx.rows.slice(0, 5);
  return [
    `Interpret the following KPI result for an AcaciaHealth operations analyst.`,
    ``,
    `KPI: ${ctx.kpiName}`,
    `Formula: ${ctx.formula}`,
    `Computed value: ${ctx.value} ${ctx.unit}`,
    ctx.target != null ? `Target / benchmark: ${ctx.target} ${ctx.unit}` : "",
    ctx.trend ? `Trend: ${ctx.trend} (delta: ${ctx.trendDelta ?? "N/A"} ${ctx.unit})` : "",
    ``,
    `Sample data rows (up to 5):`,
    JSON.stringify(sample, null, 2),
    ``,
    `Provide a plain-language interpretation in the specified JSON format.`,
  ].filter(Boolean).join("\n");
}
