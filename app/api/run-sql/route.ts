/**
 * POST /api/run-sql
 * SQL Execution Agent endpoint.
 * Accepts a pre-validated SQL string + date params, enforces read-only rules,
 * caps results at MAX_ROWS, and times out at 30 seconds.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { validateQuery } from "@/lib/services/queryGuard";
import { executeQuery, isDbConfigured, BackendUnreachableError } from "@/lib/services/db";
import { formatReport } from "@/lib/services/formatter";
import { parameterizeDates } from "@/lib/services/dateParams";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import { correctQueryOnce } from "@/lib/services/queryCorrectionService";
import { isAiConfigured } from "@/lib/ai/gateway";
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

    // Link the date pickers to the query: rewrite any hardcoded date-range
    // literals (e.g. BETWEEN CONVERT(date, '2017-03-02') AND ...) back into the
    // @StartDate / @EndDate parameters that are bound below. Without this the
    // date filters are silently ignored whenever the SQL embeds literal dates.
    const { sql: paramSql, replaced: dateParamsApplied } = parameterizeDates(sql);

    // Security validation — enforced unconditionally
    const validation = validateQuery(paramSql);
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
    const safeSql = /^\s*SELECT\s+TOP\s+\d+/i.test(paramSql)
      ? paramSql
      : paramSql.replace(/^\s*SELECT\s+/i, `SELECT TOP ${MAX_ROWS} `);

    // Cache check
    const cacheKey = buildCacheKey(`run-sql:${safeSql}`, { start_date, end_date });
    const cached = getCache<ReportOutput>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cache_hit: true,
        execution_ms: Date.now() - start,
        date_params_applied: dateParamsApplied,
        executed_sql: paramSql,
      });
    }

    // Demo mode — no DB configured
    if (!isDbConfigured()) {
      const demo = buildDemoResult(safeSql, report_name ?? "Custom Query", start_date, end_date);
      return NextResponse.json({
        ...demo,
        demo_mode: true,
        cache_hit: false,
        execution_ms: Date.now() - start,
        date_params_applied: dateParamsApplied,
        executed_sql: paramSql,
      });
    }

    let finalSql = safeSql;
    let correctionApplied = false;
    let correctionAttempts: number | undefined;

    let data: unknown[];
    try {
      data = await executeQuery(finalSql, {
        StartDate: start_date,
        EndDate: end_date,
      });
    } catch (execErr) {
      // Self-healing: if execution fails and AI is available, attempt correction
      const execErrMsg = execErr instanceof Error ? execErr.message : String(execErr);

      if (isAiConfigured() && body.original_prompt) {
        console.error("[v0] Execution error — attempting AI correction:", execErrMsg);
        const correction = await correctQueryOnce({
          originalPrompt: body.original_prompt,
          failedSQL: finalSql,
          errorMessage: execErrMsg,
          startDate: start_date,
          endDate: end_date,
          branchCode: body.branch_code,
        });

        if (correction.plan && correction.plan.sql) {
          finalSql = correction.plan.sql;
          correctionApplied = true;
          correctionAttempts = 1;
          // Retry execution with corrected SQL
          data = await executeQuery(finalSql, {
            StartDate: start_date,
            EndDate: end_date,
          });
        } else {
          throw execErr; // Correction failed — propagate original error
        }
      } else {
        throw execErr;
      }
    }

    const report = formatReport(
      report_name ?? "Custom Query",
      { date_range: { start_date, end_date } },
      data as Record<string, unknown>[],
      "custom",
      finalSql
    );

    setCache(cacheKey, report);

    return NextResponse.json({
      ...report,
      cache_hit: false,
      execution_ms: Date.now() - start,
      report_id: report_id ?? null,
      date_params_applied: dateParamsApplied,
      executed_sql: correctionApplied ? finalSql : paramSql,
      correction_applied: correctionApplied,
      correction_attempts: correctionAttempts ?? 0,
    });
  } catch (err) {
    console.error("[db] /api/run-sql error:", err);
    // Backend connectivity problems get a clear, actionable message + 503.
    if (err instanceof BackendUnreachableError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          hint: "Start the VM backend service and point ngrok at it (ngrok http <backend-port>), then retry.",
        },
        { status: 503 }
      );
    }
    // Never expose raw DB error messages to the client
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
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
