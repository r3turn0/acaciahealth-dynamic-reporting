/**
 * POST /api/datasets/query  →  GATEWAY ADAPTER
 *
 * Dataset query execution is now routed through QueryGateway (source="ad_hoc").
 * All 9 pipeline stages enforced. Optional in-memory filtering/aggregation
 * applied on the gateway execution result, preserving the original API surface.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import {
  applyFilters,
  aggregateData,
  toCSV,
  type FilterCondition,
  type AggregationConfig,
} from "@/lib/services/datasetService";
import { ReadOnlyViolationError } from "@/lib/db/readOnlyClient";
import { BackendUnreachableError } from "@/lib/services/db";

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { sql, startDate, endDate, filters, aggregate, format } = body;

    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "sql is required" }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }

    const result = await runQueryGateway({
      query: sql,
      source: "ad_hoc",
      rawSql: sql,
      startDate: String(startDate),
      endDate: String(endDate),
      signal: req.signal,
    });

    if (!result.validation.valid) {
      return NextResponse.json(
        { error: result.validation.errors[0], code: "GATEWAY_VALIDATION_FAILED" },
        { status: 403 }
      );
    }

    let rows = (result.execution?.rows ?? []) as Record<string, unknown>[];
    const columns = result.execution?.columns ?? [];

    // Optional in-memory filtering
    if (Array.isArray(filters) && filters.length > 0) {
      rows = applyFilters(rows, filters as FilterCondition[]);
    }

    // Optional in-memory aggregation
    if (aggregate && (Array.isArray(aggregate.groupBy) || Array.isArray(aggregate.metrics))) {
      rows = aggregateData(rows, aggregate as AggregationConfig);
    }

    const executionMs = Date.now() - start;

    if (format === "csv") {
      return new NextResponse(toCSV(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="dataset_${new Date().toISOString().slice(0, 10)}.csv"`,
          "X-Row-Count": String(rows.length),
          "X-Execution-Ms": String(executionMs),
        },
      });
    }

    const requestedLimit = Number(body.limit);
    const payloadLimit = Number.isInteger(requestedLimit)
      ? Math.min(10_000, Math.max(1, requestedLimit))
      : 2_000;
    const responseRows = rows.slice(0, payloadLimit);

    return NextResponse.json({
      rows: responseRows,
      columns,
      rowCount: rows.length,
      returnedRowCount: responseRows.length,
      executionMs,
      truncated: Boolean(result.execution?.truncated || rows.length > responseRows.length),
      demoMode: result.demoMode,
      gateway: {
        requestId: result.requestId,
        pipeline: result.pipeline,
        validation: result.validation,
        lineage: result.lineage,
        governance: result.governance,
      },
    });
  } catch (err) {
    if (req.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      return new NextResponse(null, { status: 499, statusText: "Client Closed Request" });
    }
    if (err instanceof ReadOnlyViolationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    }
    if (err instanceof BackendUnreachableError) {
      return NextResponse.json(
        { error: err.message, code: err.code, hint: "Configure MSSQL credentials and ensure the server is reachable." },
        { status: 503 }
      );
    }
    console.error("[Gateway→datasets/query] error:", err);
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}
