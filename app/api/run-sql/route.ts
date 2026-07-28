/**
 * POST /api/run-sql  →  GATEWAY ADAPTER
 *
 * This route is now a thin adapter. All SQL execution is routed through
 * QueryGateway — the single permitted SQL execution entry point.
 *
 * Legacy callers (SQL Editor, Report Studio, Report Runner) pass:
 *   sql, start_date, end_date, report_name, report_id, original_prompt
 *
 * The gateway treats this as source="sql_editor" and enforces all 9 stages.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import { parameterizeDates } from "@/lib/services/dateParams";
import { BackendUnreachableError } from "@/lib/services/db";

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { sql, start_date, end_date, report_name, report_id, original_prompt } = body;

    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "sql is required" }, { status: 400 });
    }
    if (!start_date || !end_date) {
      return NextResponse.json({ error: "start_date and end_date are required" }, { status: 400 });
    }

    // Normalize date params before passing to gateway
    const { sql: normalizedSql, replaced: dateParamsApplied } = parameterizeDates(sql);

    const result = await runQueryGateway({
      query: original_prompt ?? normalizedSql,
      source: "sql_editor",
      rawSql: normalizedSql,
      startDate: start_date,
      endDate: end_date,
      reportName: report_name,
    });

    if (!result.validation.valid) {
      return NextResponse.json(
        { error: "Query failed security validation", details: result.validation.errors },
        { status: 422 }
      );
    }

    const execution = result.execution;
    const rows = execution?.rows ?? [];

    return NextResponse.json({
      rows,
      columns: execution?.columns ?? [],
      rowCount: execution?.rowCount ?? 0,
      cache_hit: false,
      execution_ms: execution?.executionMs ?? Date.now() - start,
      report_id: report_id ?? null,
      date_params_applied: dateParamsApplied,
      executed_sql: result.sql,
      demo_mode: result.demoMode,
      // Phase 9: expose retry intelligence to the client
      retry_info: result.retryInfo ?? null,
      history_id: result.historyId ?? null,
      gateway: {
        requestId: result.requestId,
        confidence: result.confidence,
        pipeline: result.pipeline,
        validation: result.validation,
        lineage: result.lineage,
        governance: result.governance,
      },
    });
  } catch (err) {
    console.error("[Gateway→run-sql] error:", err);
    if (err instanceof BackendUnreachableError) {
      return NextResponse.json(
        { error: err.message, code: err.code, hint: "Start the VM backend service and retry." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}
