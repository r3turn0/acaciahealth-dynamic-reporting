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
import {
  isAbortError,
  QueryGatewayTimeoutError,
  runQueryGateway,
} from "@/lib/gateway/QueryGateway";
import { parameterizeDates } from "@/lib/services/dateParams";
import { analyzeSqlGovernance } from "@/lib/services/kpiClassification";
import { BackendUnreachableError } from "@/lib/services/db";
import { RunSqlBodySchema } from "@/lib/validation/apiSchemas";
import { acquireQuerySlot, QueryCapacityError } from "@/lib/server/queryConcurrency";

export async function POST(req: NextRequest) {
  const start = Date.now();
  let releaseSlot: (() => void) | undefined;
  let queueMs = 0;

  try {
    const raw = await req.json();
    const parsed = RunSqlBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { sql, start_date, end_date, report_name, report_id, original_prompt } = parsed.data;
    const queueStartedAt = Date.now();
    releaseSlot = await acquireQuerySlot(req.signal);
    queueMs = Date.now() - queueStartedAt;

    // Normalize date params before passing to gateway
    const { sql: normalizedSql, replaced: dateParamsApplied } = parameterizeDates(sql);

    const result = await runQueryGateway({
      query: original_prompt ?? normalizedSql,
      source: "sql_editor",
      rawSql: normalizedSql,
      startDate: start_date,
      endDate: end_date,
      reportName: report_name,
      signal: req.signal,
    });

    if (!result.validation.valid) {
      return NextResponse.json(
        { error: "Query failed security validation", details: result.validation.errors },
        { status: 422 }
      );
    }

    const execution = result.execution;
    if (!execution) {
      return NextResponse.json(
        {
          error: "The query could not be executed. Review the SQL and try again.",
          code: "EXECUTION_FAILED",
          gateway: { requestId: result.requestId, pipeline: result.pipeline },
        },
        { status: 422 }
      );
    }
    const rows = execution.rows;
    const sqlGovernance = analyzeSqlGovernance(result.sql ?? normalizedSql);
    const governedResultSets = execution.resultSets.map((resultSet, index) => {
      const statement = sqlGovernance.statements[index];
      const statementNumber = index + 1;
      const lineage = sqlGovernance.lineage.filter((edge) => edge.statement === statementNumber);
      const verification = sqlGovernance.verificationPlans.find((plan) => plan.statement === statementNumber);
      const statementClassifications = statement ? analyzeSqlGovernance(statement.sql).classifications : [];
      return {
        ...resultSet,
        governance: {
          statement: statementNumber,
          lineage,
          classifications: statementClassifications,
          verification: verification ?? null,
          confidence: statementClassifications[0]?.confidence ?? 0,
          status: verification?.supported ? "supported" : statementClassifications.length ? "partial" : "metadata-only",
        },
      };
    });

    return NextResponse.json({
      rows,
      columns: execution?.columns ?? [],
      rowCount: execution?.rowCount ?? 0,
      resultSets: governedResultSets,
      resultSetCount: governedResultSets.length,
      cache_hit: false,
      execution_ms: execution?.executionMs ?? Date.now() - start,
      queue_ms: queueMs,
      total_ms: Date.now() - start,
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
        kpiClassification: sqlGovernance.classifications,
        statementLineage: sqlGovernance.lineage,
        verificationPlans: sqlGovernance.verificationPlans,
        validationEvidence: sqlGovernance.validation,
      },
    });
  } catch (err) {
    if (err instanceof QueryCapacityError) {
      return NextResponse.json(
        { error: "Reporting capacity is busy. Wait briefly and retry.", code: "QUERY_CAPACITY_FULL", retry_after_ms: 1500 },
        { status: 429, headers: { "Retry-After": "2" } }
      );
    }
    console.error("[Gateway→run-sql] error:", err);
    if (err instanceof QueryGatewayTimeoutError) {
      return NextResponse.json(
        { error: "Query execution timed out. Narrow the date range or simplify the query.", code: err.code },
        { status: 504 }
      );
    }
    if (isAbortError(err)) {
      return NextResponse.json(
        { error: "Query execution was cancelled.", code: "REQUEST_CANCELLED" },
        { status: 408 }
      );
    }
    if (err instanceof BackendUnreachableError) {
      return NextResponse.json(
        { error: "The reporting database is temporarily unreachable. Try again shortly.", code: err.code },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Query execution failed. Please review the SQL and retry.", code: "EXECUTION_FAILED" },
      { status: 500 }
    );
  } finally {
    releaseSlot?.();
  }
}
