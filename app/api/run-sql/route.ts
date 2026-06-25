/**
 * POST /api/run-sql
 * SQL Execution Agent endpoint.
 * Accepts a pre-validated SQL string + date params, enforces read-only rules,
 * caps results at MAX_ROWS, and times out at 30 seconds.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateQuery } from "@/lib/services/queryGuard";
import { executeQuery } from "@/lib/services/db";
import { formatReport } from "@/lib/services/formatter";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import type { ReportOutput } from "@/lib/services/formatter";

const MAX_ROWS = 10_000;

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { sql, start_date, end_date, report_name, report_id } = body;

    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "sql is required" }, { status: 400 });
    }
    if (!start_date || !end_date) {
      return NextResponse.json(
        { error: "start_date and end_date are required" },
        { status: 400 }
      );
    }

    // Security validation — enforced unconditionally
    const validation = validateQuery(sql);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Query failed security validation",
          details: validation.errors,
        },
        { status: 422 }
      );
    }

    // Inject TOP guard if not already present
    const safeSql = /^\s*SELECT\s+TOP\s+\d+/i.test(sql)
      ? sql
      : sql.replace(/^\s*SELECT\s+/i, `SELECT TOP ${MAX_ROWS} `);

    // Cache check
    const cacheKey = buildCacheKey(`run-sql:${safeSql}`, { start_date, end_date });
    const cached = getCache<ReportOutput>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cache_hit: true,
        execution_ms: Date.now() - start,
      });
    }

    // Demo mode
    if (!process.env.SQL_CONNECTION_STRING) {
      const demo = buildDemoResult(safeSql, report_name ?? "Custom Query", start_date, end_date);
      return NextResponse.json({
        ...demo,
        demo_mode: true,
        cache_hit: false,
        execution_ms: Date.now() - start,
      });
    }

    const data = await executeQuery(safeSql, {
      StartDate: start_date,
      EndDate: end_date,
    });

    const report = formatReport(
      report_name ?? "Custom Query",
      { date_range: { start_date, end_date } },
      data as Record<string, unknown>[],
      "custom",
      safeSql
    );

    setCache(cacheKey, report);

    return NextResponse.json({
      ...report,
      cache_hit: false,
      execution_ms: Date.now() - start,
      report_id: report_id ?? null,
    });
  } catch (err) {
    console.error("[v0] /api/run-sql error:", err);
    const message = err instanceof Error ? err.message : "Execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildDemoResult(
  sql: string,
  name: string,
  startDate: string,
  endDate: string
): ReportOutput {
  const days = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  );
  const weeks = Math.max(1, Math.floor(days / 7));
  const branches = ["Hospice OC", "Home Health", "Hospice GI", "Hospice IRC", "Palliative Care"];
  const kpiHint = sql.toLowerCase().includes("li_amount") ? "revenue" : "admissions";

  const data: Record<string, unknown>[] = [];
  for (const branch of branches) {
    for (let w = 1; w <= weeks; w++) {
      const val =
        kpiHint === "revenue"
          ? Math.round(50000 + Math.random() * 80000)
          : Math.round(5 + Math.random() * 30);
      data.push({ branch_name: branch, week_number: w, [kpiHint]: val });
    }
  }

  return formatReport(
    name,
    { date_range: { start_date: startDate, end_date: endDate } },
    data,
    kpiHint,
    sql
  );
}
