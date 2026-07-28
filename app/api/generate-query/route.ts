/**
 * POST /api/generate-query  →  GATEWAY ADAPTER
 *
 * NL → SQL query planning is now routed through QueryGateway with planOnly=true
 * to return a validated plan without executing — preserving the existing
 * QueryPlan response shape for callers that subsequently call /api/run-sql.
 *
 * source="natural_language" enforces full intent → semantic → pattern → generate → validate pipeline.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import type { QueryPlan } from "@/lib/agents/queryPlanner";

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { prompt, start_date, end_date, branch_code, role } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!start_date || !end_date) {
      return NextResponse.json({ error: "start_date and end_date are required" }, { status: 400 });
    }

    const result = await runQueryGateway({
      query: prompt,
      source: "natural_language",
      startDate: start_date,
      endDate: end_date,
      branchCode: branch_code,
      role: role ?? "analyst",
      planOnly: true, // Generate + validate plan — do not execute yet
    });

    if (!result.validation.valid) {
      return NextResponse.json(
        {
          error: "Generated SQL failed security validation",
          details: result.validation.errors,
          plan: buildPlan(result),
          gateway: { requestId: result.requestId, pipeline: result.pipeline },
        },
        { status: 422 }
      );
    }

    const plan = buildPlan(result);

    return NextResponse.json({
      ...plan,
      cache_hit: false,
      elapsed_ms: Date.now() - start,
      ai_powered: result.pipeline.find((s) => s.stage === "SQLGeneratorAgent")?.status === "ok",
      // Phase 9: expose retry intelligence to the client
      retry_info: result.retryInfo ?? null,
      history_id: result.historyId ?? null,
      gateway: {
        requestId: result.requestId,
        confidence: result.confidence,
        pipeline: result.pipeline,
        intent: result.intent,
        semanticContext: result.semanticContext,
        approvedPattern: result.approvedPattern,
        validation: result.validation,
        lineage: result.lineage,
        governance: result.governance,
      },
    });
  } catch (err) {
    console.error("[Gateway→generate-query] error:", err);
    return NextResponse.json({ error: "Query generation failed" }, { status: 500 });
  }
}

function buildPlan(result: Awaited<ReturnType<typeof import("@/lib/gateway/QueryGateway").runQueryGateway>>): QueryPlan & { confidence_score: number } {
  return {
    sql: result.sql,
    explanation: result.explanation,
    tables_used: result.lineage.tablesUsed,
    filters_applied: result.lineage.filtersApplied,
    kpi_detected: result.intent.requiredKpis[0] ?? result.intent.type,
    strategy: "sql",
    api_fallback_reason: null,
    cost_warning: null,
    optimized_suggestion: null,
    confidence_score: result.confidence,
  };
}
