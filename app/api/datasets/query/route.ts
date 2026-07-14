/**
 * POST /api/datasets/query
 *
 * Execute a SELECT query against the READ-ONLY MSSQL data source via
 * datasetService.  Supports optional in-memory filtering and aggregation.
 *
 * Body:
 *   sql          string   — SELECT statement (required)
 *   startDate    string   — ISO date for @StartDate (required)
 *   endDate      string   — ISO date for @EndDate (required)
 *   filters?     FilterCondition[]
 *   aggregate?   AggregationConfig
 *   format?      "json" | "csv"   — default json
 *
 * Enforcement:
 *   ReadOnlyDataClient will reject any non-SELECT query before it reaches
 *   the wire, so this route is safe to expose to authenticated users.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  fetchRawData,
  applyFilters,
  aggregateData,
  toCSV,
  toJSON,
  type QueryDefinition,
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
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    const def: QueryDefinition = {
      sql,
      startDate: String(startDate),
      endDate: String(endDate),
    };

    let result = await fetchRawData(def);

    // Optional in-memory filtering
    if (Array.isArray(filters) && filters.length > 0) {
      result = {
        ...result,
        rows: applyFilters(result.rows, filters as FilterCondition[]),
      };
      result.rowCount = result.rows.length;
    }

    // Optional in-memory aggregation
    if (
      aggregate &&
      (Array.isArray(aggregate.groupBy) || Array.isArray(aggregate.metrics))
    ) {
      result = {
        ...result,
        rows: aggregateData(result.rows, aggregate as AggregationConfig),
        rowCount: result.rows.length,
      };
    }

    const executionMs = Date.now() - start;

    if (format === "csv") {
      return new NextResponse(toCSV(result.rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="dataset_${new Date().toISOString().slice(0, 10)}.csv"`,
          "X-Row-Count": String(result.rowCount),
          "X-Execution-Ms": String(executionMs),
        },
      });
    }

    return NextResponse.json({
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      executionMs,
      truncated: result.truncated,
      demoMode: result.demoMode,
    });
  } catch (err) {
    if (err instanceof ReadOnlyViolationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 403 }
      );
    }
    if (err instanceof BackendUnreachableError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          hint: "Configure MSSQL credentials (DB_HOST, DB_NAME, DB_USER, DB_PASS) and ensure the server is reachable.",
        },
        { status: 503 }
      );
    }
    console.error("[v0] POST /api/datasets/query error:", err);
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}
