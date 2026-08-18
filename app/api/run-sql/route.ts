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
import type { SqlExecutionErrorPayload } from "@/lib/sql/executionError";

function sqlFailure(status: number, payload: SqlExecutionErrorPayload, headers?: HeadersInit) {
  return NextResponse.json(payload, { status, headers });
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  let releaseSlot: (() => void) | undefined;
  let queueMs = 0;

  try {
    const raw = await req.json();
    const parsed = RunSqlBodySchema.safeParse(raw);
    if (!parsed.success) {
      return sqlFailure(400, {
        error: "Invalid SQL execution request.",
        code: "INVALID_REQUEST",
        category: "request",
        retryable: false,
        recovery: ["edit_sql"],
        details: parsed.error.flatten().fieldErrors,
      });
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
      return sqlFailure(422, {
        error: "Query failed read-only security validation.",
        code: "SECURITY_VALIDATION_FAILED",
        category: "validation",
        retryable: false,
        recovery: ["edit_sql", "fix_query"],
        details: result.validation.errors,
        diagnostics: { requestId: result.requestId, validationErrors: result.validation.errors, pipeline: result.pipeline },
      });
    }

    const execution = result.execution;
    if (!execution) {
      return sqlFailure(422, {
        error: "The query could not be executed. Review or repair the SQL before retrying.",
        code: "EXECUTION_FAILED",
        category: "execution",
        retryable: false,
        recovery: ["fix_query", "edit_sql"],
        diagnostics: { requestId: result.requestId, pipeline: result.pipeline },
      });
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
    if (err instanceof SyntaxError) {
      return sqlFailure(400, {
        error: "Invalid JSON request body.", code: "INVALID_REQUEST",
        category: "request", retryable: false, recovery: ["edit_sql"],
      });
    }
    if (err instanceof QueryCapacityError) {
      return sqlFailure(429, {
        error: "Reporting capacity is busy. Wait briefly and retry.", code: "QUERY_CAPACITY_FULL",
        category: "capacity", retryable: true, recovery: ["retry"],
      }, { "Retry-After": "2" });
    }
    console.error("[Gateway→run-sql] error:", err);
    if (err instanceof QueryGatewayTimeoutError) {
      return sqlFailure(504, {
        error: "Query execution timed out. Narrow the date range or simplify the query.", code: "QUERY_TIMEOUT",
        category: "timeout", retryable: true, recovery: ["narrow_date_range", "retry"],
      });
    }
    if (isAbortError(err)) {
      return sqlFailure(408, {
        error: "Query execution was cancelled.", code: "REQUEST_CANCELLED",
        category: "cancelled", retryable: true, recovery: ["retry"],
      });
    }
    if (err instanceof BackendUnreachableError) {
      return sqlFailure(503, {
        error: "The reporting database is temporarily unreachable. Try again shortly.", code: "BACKEND_UNREACHABLE",
        category: "backend", retryable: true, recovery: ["retry"],
      });
    }
    return sqlFailure(500, {
      error: "Query execution failed. Please review the SQL and retry.", code: "EXECUTION_FAILED",
      category: "execution", retryable: false, recovery: ["fix_query", "edit_sql"],
    });
  } finally {
    releaseSlot?.();
  }
}
