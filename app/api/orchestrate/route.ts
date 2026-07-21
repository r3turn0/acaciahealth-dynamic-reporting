/**
 * POST /api/orchestrate
 *
 * Single endpoint for the full multi-agent pipeline:
 * semantic → planner → validator → executor → healer → presentation
 *
 * Request:
 *   query      — natural language question
 *   startDate  — ISO date string
 *   endDate    — ISO date string
 *   branchCode — optional branch filter
 *   role       — "admin" | "analyst" | "viewer"
 *   execute    — boolean: if true, run the SQL against the DB (default true)
 *
 * Response: OrchestrationResult
 */

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/agents/orchestrator";
import { isDbConfigured, executeQueryWithParams } from "@/lib/services/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    query     = "",
    startDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString().split("T")[0],
    endDate   = new Date().toISOString().split("T")[0],
    branchCode,
    role      = "analyst",
    execute   = true,
  } = body as {
    query:      string;
    startDate?: string;
    endDate?:   string;
    branchCode?: string;
    role?:      "admin" | "analyst" | "viewer";
    execute?:   boolean;
  };

  if (!query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // Build executor function only when DB is configured and caller wants execution
  const executeSQL =
    execute && isDbConfigured()
      ? async (sql: string) => {
          try {
            const params = [
              { name: "StartDate", value: startDate },
              { name: "EndDate",   value: endDate },
            ];
            const result = await executeQueryWithParams(sql, params);
            return {
              ok:   true,
              rows: result as Record<string, unknown>[],
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: msg, dbErrorLogs: msg };
          }
        }
      : undefined;

  try {
    const result = await orchestrate({
      query,
      startDate,
      endDate,
      branchCode,
      role,
      executeSQL,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[orchestrate] Unhandled error:", err);
    return NextResponse.json(
      { error: "Orchestration failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
