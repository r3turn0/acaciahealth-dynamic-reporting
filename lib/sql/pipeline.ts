/**
 * lib/sql/pipeline.ts
 *
 * 3-Tier Self-Healing SQL Pipeline
 *
 * Tier 1 — Validation Layer    (hard stop: read-only, blocked patterns)
 * Tier 2 — Deterministic Engine (metadata-driven rules, no AI call)
 * Tier 3 — AI Fallback          (freeform GPT fix, re-validated before return)
 *
 * Every tier's output passes through validateSQL before execution.
 */

import schemaConfig from "@/lib/config/schemaConfig.json";
import kpiConfig    from "@/lib/config/kpiConfig.json";
import semanticLayer from "@/lib/config/semanticLayer.json";
import { validateReadOnlySql } from "@/lib/services/queryGuard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PipelineResult {
  sql:          string;
  tier:         "original" | "deterministic" | "ai_fallback" | "failed";
  explanation:  string;
  changes:      PipelineChange[];
  valid:        boolean;
  errors:       string[];
}

export interface PipelineChange {
  type:    string;
  from:    string;
  to:      string;
  reason?: string;
}

// ── Tier 1: Validation ────────────────────────────────────────────────────────

export function validateSQL(sql: string): { valid: boolean; errors: string[] } {
  const result = validateReadOnlySql(sql);
  const errors = [...result.errors];
  if (sql.length > 50_000) errors.push("Query exceeds maximum length of 50000 characters");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

// ── Tier 2: Deterministic Fix Engine ─────────────────────────────────────────

/** Column alias → physical column mappings from schemaConfig + semanticLayer */
function buildColumnMappings(): Record<string, string> {
  const mappings: Record<string, string> = {};

  // From semanticLayer tables
  const tables = (semanticLayer as { tables?: Record<string, { columns?: Record<string, { physical?: string }> }> }).tables ?? {};
  for (const tableData of Object.values(tables)) {
    for (const [alias, col] of Object.entries(tableData.columns ?? {})) {
      if (col.physical) mappings[alias] = col.physical;
    }
  }

  // Common HCHB shorthand aliases
  const extras: Record<string, string> = {
    branch:       "branch_name",
    branch_code:  "epi_branchcode",
    soc:          "epi_SocDate",
    dob:          "epi_birthdate",
    admit_date:   "epi_SocDate",
    discharge:    "epi_DischargeDate",
    census_date:  "epi_SocDate",
    adc:          "daily_census",
    hce:          "daily_census",
  };
  return { ...mappings, ...extras };
}

/** Preferred fact table per domain keyword */
const FACT_TABLE_RULES: Record<string, string> = {
  census:    "VW_FACT_DAILY_CENSUS",
  adc:       "VW_FACT_DAILY_CENSUS",
  hce:       "VW_FACT_DAILY_CENSUS",
  admission: "CLIENT_EPISODES_ALL",
  discharge: "CLIENT_EPISODES_ALL",
  episode:   "CLIENT_EPISODES_ALL",
  revenue:   "Billing.LINE_ITEMS",
  billing:   "Billing.LINE_ITEMS",
};

/** KPI metric expressions from kpiConfig */
function getMetricExpression(keyword: string): string | null {
  const kpi = kpiConfig as Record<string, { aggregation?: string }>;
  for (const [key, def] of Object.entries(kpi)) {
    if (keyword.toLowerCase().includes(key)) return def.aggregation ?? null;
  }
  return null;
}

export function deterministicFix(
  sql: string,
  dbError: string
): { sql: string; changes: PipelineChange[] } {
  const changes: PipelineChange[] = [];
  let fixed = sql;
  const mappings = buildColumnMappings();

  // Fix: invalid column name → map to closest known column
  for (const m of [...dbError.matchAll(/invalid column name ['"]?([a-zA-Z0-9_]+)['"]?/gi)]) {
    const bad = m[1];
    const mapped = mappings[bad.toLowerCase()] ?? mappings[bad];
    if (mapped && mapped !== bad) {
      fixed = fixed.replace(new RegExp(`\\b${bad}\\b`, "gi"), mapped);
      changes.push({ type: "column_fix", from: bad, to: mapped, reason: "column mapping" });
    }
  }

  // Fix: invalid object name → map to preferred fact table
  for (const m of [...dbError.matchAll(/invalid object name ['"]?([a-zA-Z0-9_.]+)['"]?/gi)]) {
    const bad = m[1];
    const lower = bad.toLowerCase();
    for (const [key, table] of Object.entries(FACT_TABLE_RULES)) {
      if (lower.includes(key)) {
        fixed = fixed.replace(new RegExp(bad.replace(".", "\\."), "gi"), table);
        changes.push({ type: "table_fix", from: bad, to: table, reason: `fact table for ${key}` });
        break;
      }
    }
  }

  // Fix: missing GROUP BY with aggregates
  if (
    dbError.toLowerCase().includes("is invalid in the select list") &&
    !/GROUP\s+BY/i.test(fixed)
  ) {
    // Extract SELECT columns that are not aggregates
    const selectMatch = fixed.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (selectMatch) {
      const cols = selectMatch[1]
        .split(",")
        .map((c) => c.trim())
        .filter((c) => !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c))
        .map((c) => c.split(/\s+AS\s+/i)[0].trim());
      if (cols.length > 0) {
        fixed = fixed + ` GROUP BY ${cols.join(", ")}`;
        changes.push({ type: "syntax_fix", from: "missing GROUP BY", to: `GROUP BY ${cols.join(", ")}` });
      }
    }
  }

  // Fix: ensure date filter present for census/census-like queries
  if (
    /VW_FACT_DAILY_CENSUS/i.test(fixed) &&
    !/census_date|@StartDate|@EndDate/i.test(fixed)
  ) {
    const hasWhere = /WHERE/i.test(fixed);
    const clause = "census_date BETWEEN @StartDate AND @EndDate";
    fixed = hasWhere
      ? fixed.replace(/WHERE/i, `WHERE ${clause} AND`)
      : fixed + ` WHERE ${clause}`;
    changes.push({ type: "filter_fix", from: "missing date filter", to: clause });
  }

  return { sql: fixed, changes };
}

// ── Tier 3: AI Fallback ───────────────────────────────────────────────────────

export async function aiFix(
  sql:       string,
  dbError:   string,
  userQuery: string
): Promise<{ sql: string; explanation: string; changes: PipelineChange[] }> {
  const { chatJSON } = await import("@/lib/ai/gateway");

  const system = `You are an expert SQL repair engine for Microsoft SQL Server T-SQL.
Your job is to fix a broken SQL query using the error message and schema context.

RULES:
- READ ONLY: only SELECT queries are allowed. Never emit INSERT/UPDATE/DELETE/DROP.
- Use only table/column names that exist in the schema below.
- Preserve the original intent exactly.
- Return ONLY valid JSON, no markdown.

SCHEMA:
${JSON.stringify(schemaConfig, null, 2)}

SEMANTIC LAYER:
${JSON.stringify(semanticLayer, null, 2)}

KPI DEFINITIONS:
${JSON.stringify(kpiConfig, null, 2)}`;

  const prompt = `USER INTENT: ${userQuery}
BROKEN SQL:
${sql}

DATABASE ERROR:
${dbError}

Return JSON: { "fixedSQL": "...", "explanation": "...", "changes": [{ "type": "...", "from": "...", "to": "...", "reason": "..." }] }`;

  try {
    const result = await chatJSON<{
      fixedSQL: string;
      explanation: string;
      changes: PipelineChange[];
    }>(system, prompt);

    return {
      sql:         result.fixedSQL ?? sql,
      explanation: result.explanation ?? "AI applied corrections",
      changes:     result.changes ?? [],
    };
  } catch {
    return { sql, explanation: "AI fix failed — review manually", changes: [] };
  }
}

// ── Main Pipeline Orchestrator ────────────────────────────────────────────────

export interface RunPipelineOptions {
  sql:        string;
  dbError?:   string;
  userQuery?: string;
  runSQL?:    (sql: string) => Promise<{ ok: boolean; error?: string; rows?: unknown[] }>;
}

export async function runSelfHealingPipeline(
  opts: RunPipelineOptions
): Promise<PipelineResult> {
  const { sql, dbError = "", userQuery = "", runSQL } = opts;

  // ── Tier 1: Validate original SQL ──────────────────────────────────────────
  const v1 = validateSQL(sql);
  if (!v1.valid) {
    return {
      sql,
      tier:        "failed",
      explanation: "Query blocked by validation layer",
      changes:     [],
      valid:        false,
      errors:      v1.errors,
    };
  }

  // If no error to fix, return original
  if (!dbError.trim()) {
    return { sql, tier: "original", explanation: "Query is valid", changes: [], valid: true, errors: [] };
  }

  // ── Tier 2: Deterministic fix ───────────────────────────────────────────────
  const { sql: fixedDet, changes: detChanges } = deterministicFix(sql, dbError);

  if (fixedDet !== sql) {
    const v2 = validateSQL(fixedDet);
    if (v2.valid) {
      // Try to execute if runner provided
      if (runSQL) {
        const res = await runSQL(fixedDet);
        if (res.ok) {
          return {
            sql:        fixedDet,
            tier:       "deterministic",
            explanation: `Auto-fixed: ${detChanges.map((c) => `${c.from} → ${c.to}`).join("; ")}`,
            changes:    detChanges,
            valid:      true,
            errors:     [],
          };
        }
        // Deterministic fix still failed — fall through to AI
      } else {
        return {
          sql:        fixedDet,
          tier:       "deterministic",
          explanation: `Auto-fixed: ${detChanges.map((c) => `${c.from} → ${c.to}`).join("; ")}`,
          changes:    detChanges,
          valid:      true,
          errors:     [],
        };
      }
    }
  }

  // ── Tier 3: AI fallback ─────────────────────────────────────────────────────
  const { sql: fixedAI, explanation, changes: aiChanges } = await aiFix(sql, dbError, userQuery);
  const v3 = validateSQL(fixedAI);

  if (!v3.valid) {
    return {
      sql:        fixedAI,
      tier:       "failed",
      explanation: "AI produced unsafe SQL — blocked by validation",
      changes:    aiChanges,
      valid:      false,
      errors:     v3.errors,
    };
  }

  return {
    sql:        fixedAI,
    tier:       "ai_fallback",
    explanation,
    changes:    [...detChanges, ...aiChanges],
    valid:      true,
    errors:     [],
  };
}
