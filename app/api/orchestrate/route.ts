/**
 * POST /api/orchestrate  →  GATEWAY ADAPTER
 *
 * The multi-agent orchestration pipeline now routes through QueryGateway.
 * source="natural_language" — all 9 stages enforced.
 * OrchestrationResult shape preserved for callers.
 */

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";

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

  try {
    const result = await runQueryGateway({
      query,
      source: "natural_language",
      startDate,
      endDate,
      branchCode,
      role,
      planOnly: !execute,
    });

    // Map GatewayResult back to legacy OrchestrationResult shape
    return NextResponse.json({
      query,
      plan: {
        sql: result.sql,
        explanation: result.explanation,
        tables_used: result.lineage.tablesUsed,
        filters_applied: result.lineage.filtersApplied,
        kpi_detected: result.intent.requiredKpis[0] ?? result.intent.type,
        strategy: "sql",
        confidence_score: result.confidence,
      },
      validation: result.validation,
      execution: result.execution
        ? {
            ok: true,
            rows: result.execution.rows,
            rowCount: result.execution.rowCount,
            executionMs: result.execution.executionMs,
            truncated: result.execution.truncated,
          }
        : execute
          ? { ok: false, error: "Execution blocked by validation or no DB configured" }
          : null,
      intent: result.intent,
      semanticContext: result.semanticContext,
      approvedPattern: result.approvedPattern,
      pipeline: result.pipeline,
      lineage: result.lineage,
      governance: result.governance,
      demoMode: result.demoMode,
      elapsedMs: result.elapsedMs,
      requestId: result.requestId,
    });
  } catch (err) {
    console.error("[Gateway→orchestrate] error:", err);
    return NextResponse.json(
      { error: "Orchestration failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
