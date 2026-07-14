/**
 * POST /api/kpi/compute
 *
 * KPI Formula Engine endpoint.
 * Accepts a pre-fetched dataset and a list of KPI keys to compute.
 * Returns computed values, trend analysis, and optional AI interpretation.
 *
 * Request body:
 * {
 *   rows:           DataRow[],              // current-period dataset
 *   previousRows?:  DataRow[],              // comparison-period dataset (for trend)
 *   kpiKeys?:       string[],               // keys from HEALTHCARE_KPI_CATALOGUE; defaults to all
 *   withInterpretation?: boolean            // enable GPT interpretation (default: false)
 * }
 *
 * Response:
 * {
 *   results:  Record<string, KpiComputedResult>,
 *   trends?:  Record<string, TrendResult>,
 *   interpretations?: Record<string, KpiInterpretation | null>,
 *   elapsed_ms: number
 * }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  HEALTHCARE_KPI_CATALOGUE,
  computeKpiFormula,
  computeTrend,
  interpretKpi,
  type KpiComputedResult,
  type TrendResult,
  type KpiInterpretation,
  type DataRow,
} from "@/lib/services/kpiFormulaEngine";

// KPIs where a higher value is NOT better (used to set trend direction correctly)
const LOWER_IS_BETTER = new Set(["lupa_rate"]);

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const {
      rows,
      previousRows,
      kpiKeys,
      withInterpretation = false,
    } = body as {
      rows: DataRow[];
      previousRows?: DataRow[];
      kpiKeys?: string[];
      withInterpretation?: boolean;
    };

    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: "rows must be an array" }, { status: 400 });
    }

    // Resolve which KPIs to compute
    const catalogue = HEALTHCARE_KPI_CATALOGUE;
    const keys =
      kpiKeys && kpiKeys.length
        ? kpiKeys.filter((k) => k in catalogue)
        : Object.keys(catalogue);

    if (keys.length === 0) {
      return NextResponse.json(
        { error: "No valid KPI keys found. Available: " + Object.keys(catalogue).join(", ") },
        { status: 400 }
      );
    }

    // Compute all requested KPIs
    const results: Record<string, KpiComputedResult> = {};
    for (const key of keys) {
      results[key] = computeKpiFormula(catalogue[key], rows);
    }

    // Compute trends if previousRows provided
    let trends: Record<string, TrendResult> | undefined;
    if (previousRows && Array.isArray(previousRows) && previousRows.length > 0) {
      trends = {};
      for (const key of keys) {
        trends[key] = computeTrend(
          catalogue[key],
          rows,
          previousRows,
          !LOWER_IS_BETTER.has(key)
        );
      }
    }

    // Optional AI interpretation (runs concurrently for all KPIs)
    let interpretations: Record<string, KpiInterpretation | null> | undefined;
    if (withInterpretation) {
      const entries = await Promise.all(
        keys.map(async (key) => {
          const interp = await interpretKpi(
            results[key],
            rows,
            trends?.[key] ?? null
          );
          return [key, interp] as [string, KpiInterpretation | null];
        })
      );
      interpretations = Object.fromEntries(entries);
    }

    return NextResponse.json({
      results,
      trends,
      interpretations,
      kpiKeys: keys,
      rowCount: rows.length,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    console.error("[v0] /api/kpi/compute error:", err);
    return NextResponse.json({ error: "KPI computation failed" }, { status: 500 });
  }
}

/**
 * GET /api/kpi/compute
 * Returns the full KPI catalogue definitions (no computation).
 */
export async function GET() {
  return NextResponse.json({
    catalogue: HEALTHCARE_KPI_CATALOGUE,
    availableKeys: Object.keys(HEALTHCARE_KPI_CATALOGUE),
  });
}
