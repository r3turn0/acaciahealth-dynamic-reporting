/**
 * lib/services/kpiFormulaEngine.ts
 *
 * KPI Formula Engine — AcaciaHealth's Biggest Differentiator
 *
 * Computes healthcare KPIs entirely in Node.js (no MSSQL aggregation needed).
 * Supports:
 *  - Simple aggregations: sum, avg, min, max, count
 *  - Rate formulas:       utilization_rate = completed / scheduled
 *  - Ratio formulas:      lupa_rate = lupa_episodes / total_episodes
 *  - PDGM formulas:       pdgm_functional_score, pdgm_comorbidity_adjustment
 *  - Trend computation:   period-over-period delta + direction
 *  - Benchmark scoring:   % deviation from target
 *  - AI interpretation:   optional GPT-powered plain-language explanation
 *
 * Separation contract:
 *  - Takes pre-fetched DataRow[] — NEVER queries databases
 *  - AI interpretation is opt-in; engine works fully without it
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, isAiConfigured } from "@/lib/ai/gateway";
import {
  buildKpiInterpretationSystemPrompt,
  buildKpiInterpretationUserMessage,
  type KpiInterpretationContext,
} from "@/lib/ai/promptTemplates";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataRow = Record<string, unknown>;

export type KpiFormulaType =
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count"
  | "count_distinct"
  | "rate"         // numerator_col / denominator_col
  | "ratio"        // same as rate but expressed as percentage
  | "lupa_rate"    // LUPA-specific: lupa_episodes / total_episodes
  | "utilization"  // completed_visits / scheduled_visits
  | "census_avg"   // average daily patient census
  | "pdgm_score"   // average PDGM clinical/functional score
  | "revenue_per_episode" // total revenue / episode count
  | "avg_visits_per_patient"; // total visits / distinct patients

export interface FormulaDefinition {
  type: KpiFormulaType;
  /** Primary column (numerator for rate/ratio types) */
  column?: string;
  /** Denominator column for rate/ratio types */
  denominatorColumn?: string;
  /** For count_distinct — column to count distinct values of */
  distinctColumn?: string;
  /** Multiply result by this factor (e.g. 100 for percentages) */
  scaleFactor?: number;
  /** Round to this many decimal places */
  decimalPlaces?: number;
}

export interface KpiFormulaInput {
  name: string;
  description: string;
  formula: FormulaDefinition;
  unit: string;
  target?: number | null;
  tags?: string[];
}

export interface KpiComputedResult {
  name: string;
  description: string;
  value: number;
  unit: string;
  formattedValue: string;
  rowCount: number;
  target: number | null;
  /** Percentage deviation from target: (value - target) / target * 100 */
  targetDelta: number | null;
  /** "above_target" | "below_target" | "on_target" | null */
  targetStatus: "above_target" | "below_target" | "on_target" | null;
  formula: FormulaDefinition;
  computedAt: string;
}

export interface TrendResult {
  currentValue: number;
  previousValue: number;
  delta: number;
  deltaPercent: number;
  direction: "improving" | "declining" | "stable";
  /** Positive direction means higher = better (e.g. revenue, admissions) */
  higherIsBetter: boolean;
}

export interface KpiInterpretation {
  interpretation: string;
  sentiment: "positive" | "neutral" | "negative";
  actionable: boolean;
  suggestedNextQuery: string | null;
}

// ── Healthcare KPI catalogue (pre-built formula definitions) ──────────────────

export const HEALTHCARE_KPI_CATALOGUE: Record<string, KpiFormulaInput> = {
  utilization_rate: {
    name: "Visit Utilization Rate",
    description: "Percentage of scheduled visits that were completed",
    formula: {
      type: "utilization",
      column: "completed_visits",
      denominatorColumn: "scheduled_visits",
      scaleFactor: 100,
      decimalPlaces: 1,
    },
    unit: "%",
    target: 90,
    tags: ["utilization", "clinical"],
  },

  lupa_rate: {
    name: "LUPA Rate",
    description: "Percentage of episodes that are Low Utilization Payment Adjustment",
    formula: {
      type: "lupa_rate",
      column: "lupa_episodes",
      denominatorColumn: "total_episodes",
      scaleFactor: 100,
      decimalPlaces: 1,
    },
    unit: "%",
    target: 7,  // Industry benchmark: keep LUPA rate below 7%
    tags: ["lupa", "pdgm", "billing"],
  },

  census_avg: {
    name: "Average Daily Census",
    description: "Average number of active patients per day",
    formula: {
      type: "census_avg",
      column: "census",
      decimalPlaces: 1,
    },
    unit: "patients",
    target: null,
    tags: ["census", "volume"],
  },

  admissions_count: {
    name: "Admissions",
    description: "Total patient admissions (Start of Care events)",
    formula: {
      type: "sum",
      column: "admissions",
      decimalPlaces: 0,
    },
    unit: "patients",
    target: null,
    tags: ["admissions", "volume"],
  },

  discharges_count: {
    name: "Discharges",
    description: "Total patient discharges",
    formula: {
      type: "sum",
      column: "discharges",
      decimalPlaces: 0,
    },
    unit: "patients",
    target: null,
    tags: ["discharges", "volume"],
  },

  revenue_total: {
    name: "Total Revenue",
    description: "Total billed revenue across the period",
    formula: {
      type: "sum",
      column: "revenue",
      decimalPlaces: 2,
    },
    unit: "$",
    target: null,
    tags: ["revenue", "billing"],
  },

  revenue_per_episode: {
    name: "Revenue Per Episode",
    description: "Average revenue generated per patient episode",
    formula: {
      type: "revenue_per_episode",
      column: "revenue",
      denominatorColumn: "episode_count",
      decimalPlaces: 2,
    },
    unit: "$/episode",
    target: null,
    tags: ["revenue", "pdgm", "billing"],
  },

  avg_visits_per_patient: {
    name: "Avg Visits Per Patient",
    description: "Average number of visits per distinct patient",
    formula: {
      type: "avg_visits_per_patient",
      column: "visit_count",
      denominatorColumn: "patient_count",
      decimalPlaces: 1,
    },
    unit: "visits/patient",
    target: null,
    tags: ["visits", "utilization", "clinical"],
  },

  pdgm_score: {
    name: "Avg PDGM Clinical Score",
    description: "Average PDGM clinical/functional complexity score",
    formula: {
      type: "pdgm_score",
      column: "pdgm_score",
      decimalPlaces: 2,
    },
    unit: "score",
    target: null,
    tags: ["pdgm", "clinical"],
  },

  discharge_to_community_rate: {
    name: "Discharge to Community Rate",
    description: "Percentage of hospice patients discharged to community (live discharge)",
    formula: {
      type: "ratio",
      column: "community_discharges",
      denominatorColumn: "total_discharges",
      scaleFactor: 100,
      decimalPlaces: 1,
    },
    unit: "%",
    target: null,
    tags: ["discharges", "hospice", "clinical"],
  },
};

// ── Number extraction utilities ───────────────────────────────────────────────

function extractNumbers(rows: DataRow[], column: string): number[] {
  return rows
    .map((r) => {
      const v = r[column];
      if (v === null || v === undefined || v === "") return NaN;
      return Number(v);
    })
    .filter((n) => !isNaN(n));
}

function safeSum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0 || isNaN(denominator)) return 0;
  return numerator / denominator;
}

function roundTo(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function formatValue(value: number, unit: string, decimalPlaces: number): string {
  const rounded = roundTo(value, decimalPlaces);
  if (unit === "$") {
    return `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (unit === "%") {
    return `${rounded.toFixed(decimalPlaces)}%`;
  }
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: decimalPlaces })} ${unit}`.trim();
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute a single KPI from a pre-fetched dataset.
 * All computation runs in Node.js — no DB queries.
 */
export function computeKpiFormula(
  kpi: KpiFormulaInput,
  rows: DataRow[]
): KpiComputedResult {
  const { formula } = kpi;
  const dp = formula.decimalPlaces ?? 2;
  const scale = formula.scaleFactor ?? 1;
  let rawValue = 0;

  if (rows.length === 0) {
    return buildResult(kpi, 0, 0, dp);
  }

  switch (formula.type) {
    case "sum": {
      const nums = extractNumbers(rows, formula.column ?? "value");
      rawValue = safeSum(nums) * scale;
      break;
    }

    case "avg":
    case "census_avg":
    case "pdgm_score": {
      const nums = extractNumbers(rows, formula.column ?? "value");
      rawValue = nums.length ? (safeSum(nums) / nums.length) * scale : 0;
      break;
    }

    case "min": {
      const nums = extractNumbers(rows, formula.column ?? "value");
      rawValue = nums.length ? Math.min(...nums) * scale : 0;
      break;
    }

    case "max": {
      const nums = extractNumbers(rows, formula.column ?? "value");
      rawValue = nums.length ? Math.max(...nums) * scale : 0;
      break;
    }

    case "count": {
      rawValue = rows.length;
      break;
    }

    case "count_distinct": {
      const col = formula.distinctColumn ?? formula.column ?? "id";
      const unique = new Set(rows.map((r) => String(r[col] ?? "")));
      rawValue = unique.size;
      break;
    }

    case "rate":
    case "ratio":
    case "utilization":
    case "lupa_rate":
    case "revenue_per_episode":
    case "avg_visits_per_patient": {
      const numCol = formula.column ?? "numerator";
      const denCol = formula.denominatorColumn ?? "denominator";
      const numerator = safeSum(extractNumbers(rows, numCol));
      const denominator = safeSum(extractNumbers(rows, denCol));
      rawValue = safeDivide(numerator, denominator) * scale;
      break;
    }

    default: {
      // Fallback: try to sum the first numeric column
      const firstCol = Object.keys(rows[0] ?? {}).find((k) =>
        typeof rows[0][k] === "number"
      );
      if (firstCol) {
        rawValue = safeSum(extractNumbers(rows, firstCol)) * scale;
      }
    }
  }

  return buildResult(kpi, rawValue, rows.length, dp);
}

function buildResult(
  kpi: KpiFormulaInput,
  value: number,
  rowCount: number,
  dp: number
): KpiComputedResult {
  const rounded = roundTo(value, dp);
  const target = kpi.target ?? null;

  let targetDelta: number | null = null;
  let targetStatus: KpiComputedResult["targetStatus"] = null;

  if (target !== null && target !== 0) {
    targetDelta = roundTo(((rounded - target) / target) * 100, 1);
    if (Math.abs(targetDelta) < 2) {
      targetStatus = "on_target";
    } else if (rounded > target) {
      targetStatus = "above_target";
    } else {
      targetStatus = "below_target";
    }
  }

  return {
    name: kpi.name,
    description: kpi.description,
    value: rounded,
    unit: kpi.unit,
    formattedValue: formatValue(rounded, kpi.unit, dp),
    rowCount,
    target,
    targetDelta,
    targetStatus,
    formula: kpi.formula,
    computedAt: new Date().toISOString(),
  };
}

// ── Multi-KPI batch computation ───────────────────────────────────────────────

/**
 * Compute multiple KPIs from the same dataset in one pass.
 * Returns a map of KPI key → KpiComputedResult.
 */
export function computeMultipleKpis(
  kpis: Record<string, KpiFormulaInput>,
  rows: DataRow[]
): Record<string, KpiComputedResult> {
  const results: Record<string, KpiComputedResult> = {};
  for (const [key, kpi] of Object.entries(kpis)) {
    results[key] = computeKpiFormula(kpi, rows);
  }
  return results;
}

// ── Trend computation ─────────────────────────────────────────────────────────

/**
 * Compute period-over-period trend.
 * currentRows:  data from the current period
 * previousRows: data from the comparison period
 */
export function computeTrend(
  kpi: KpiFormulaInput,
  currentRows: DataRow[],
  previousRows: DataRow[],
  higherIsBetter = true
): TrendResult {
  const current = computeKpiFormula(kpi, currentRows).value;
  const previous = computeKpiFormula(kpi, previousRows).value;
  const delta = roundTo(current - previous, kpi.formula.decimalPlaces ?? 2);
  const deltaPercent =
    previous !== 0 ? roundTo((delta / Math.abs(previous)) * 100, 1) : 0;

  let direction: TrendResult["direction"];
  const threshold = 1; // < 1% change = stable
  if (Math.abs(deltaPercent) < threshold) {
    direction = "stable";
  } else if ((delta > 0 && higherIsBetter) || (delta < 0 && !higherIsBetter)) {
    direction = "improving";
  } else {
    direction = "declining";
  }

  return { currentValue: current, previousValue: previous, delta, deltaPercent, direction, higherIsBetter };
}

// ── AI-assisted interpretation ────────────────────────────────────────────────

const InterpretationSchema = z.object({
  interpretation: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  actionable: z.boolean(),
  suggestedNextQuery: z.string().nullable(),
});

/**
 * Generate a plain-language interpretation of a KPI result using GPT.
 * Returns null (not an error) when AI is not configured or the call fails.
 */
export async function interpretKpi(
  kpiResult: KpiComputedResult,
  rows: DataRow[],
  trend?: TrendResult | null
): Promise<KpiInterpretation | null> {
  if (!isAiConfigured()) return null;

  const ctx: KpiInterpretationContext = {
    kpiName: kpiResult.name,
    formula: `${kpiResult.formula.type}(${kpiResult.formula.column ?? "*"})`,
    value: kpiResult.value,
    unit: kpiResult.unit,
    target: kpiResult.target,
    trend: trend?.direction ?? null,
    trendDelta: trend?.delta ?? null,
    rows,
  };

  try {
    const result = await generateText({
      model: getModel("default"),
      system: buildKpiInterpretationSystemPrompt(),
      prompt: buildKpiInterpretationUserMessage(ctx),
      experimental_output: Output.object({ schema: InterpretationSchema }),
    temperature: 0.3,
    maxOutputTokens: 512,
    });
    return result.experimental_output as KpiInterpretation;
  } catch (err) {
    console.error("[v0] KPI interpretation failed:", err);
    return null;
  }
}

// ── PDGM-specific helpers ─────────────────────────────────────────────────────

export interface PdgmSummary {
  /** Early EOE (episodes 1-2) vs Late EOE (episodes 3+) split */
  earlyEoeCount: number;
  lateEoeCount: number;
  lupaCount: number;
  lupaRate: number;
  avgClinicalScore: number;
  avgFunctionalScore: number;
  /** Comorbidity adjustment indicator: High | Low | None */
  comorbidityProfile: "High" | "Low" | "None";
}

/**
 * Compute PDGM-specific metrics from an episode dataset.
 * Expects rows with columns: episode_order, is_lupa, clinical_score, functional_score, comorbidity_flag
 */
export function computePdgmSummary(rows: DataRow[]): PdgmSummary {
  if (!rows.length) {
    return {
      earlyEoeCount: 0,
      lateEoeCount: 0,
      lupaCount: 0,
      lupaRate: 0,
      avgClinicalScore: 0,
      avgFunctionalScore: 0,
      comorbidityProfile: "None",
    };
  }

  const earlyEoe = rows.filter((r) => Number(r.episode_order ?? 0) <= 2).length;
  const lateEoe = rows.length - earlyEoe;
  const lupaRows = rows.filter(
    (r) =>
      r.is_lupa === true ||
      r.is_lupa === 1 ||
      String(r.is_lupa).toLowerCase() === "yes"
  );
  const clinicalScores = extractNumbers(rows, "clinical_score");
  const functionalScores = extractNumbers(rows, "functional_score");
  const highComorbidity = rows.filter(
    (r) =>
      r.comorbidity_flag === "High" ||
      r.comorbidity_flag === 1 ||
      r.comorbidity_flag === true
  ).length;

  const lupaRate = safeDivide(lupaRows.length, rows.length) * 100;
  const avgClinical = clinicalScores.length
    ? safeSum(clinicalScores) / clinicalScores.length
    : 0;
  const avgFunctional = functionalScores.length
    ? safeSum(functionalScores) / functionalScores.length
    : 0;

  const comorbidityRate = safeDivide(highComorbidity, rows.length);
  const comorbidityProfile =
    comorbidityRate > 0.5 ? "High" : comorbidityRate > 0.2 ? "Low" : "None";

  return {
    earlyEoeCount: earlyEoe,
    lateEoeCount: lateEoe,
    lupaCount: lupaRows.length,
    lupaRate: roundTo(lupaRate, 1),
    avgClinicalScore: roundTo(avgClinical, 2),
    avgFunctionalScore: roundTo(avgFunctional, 2),
    comorbidityProfile,
  };
}
