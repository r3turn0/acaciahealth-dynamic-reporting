/**
 * POST /api/agents/kpi-engine
 * Execute a KPI query via KPIEngineAgent (live SQL + AI insights).
 *
 * Body:
 * {
 *   kpiName?:    string   — look up in KPI registry / kpiConfig
 *   formulaSql?: string   — direct SQL override
 *   datasetId?:  string
 *   userQuery?:  string
 *   startDate?:  string (YYYY-MM-DD)
 *   endDate?:    string (YYYY-MM-DD)
 *   branchCode?: string
 * }
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { kpiEngineAgent, type KPIEngineInput } from "@/lib/agents/KPIEngineAgent";

// Ensure all agents register themselves
import "@/lib/agents/KPIDefinitionAgent";
import "@/lib/agents/VectorEmbeddingAgent";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as KPIEngineInput;

    if (!body.kpiName && !body.formulaSql) {
      return NextResponse.json(
        { error: "Either kpiName or formulaSql is required" },
        { status: 400 }
      );
    }

    const result = await kpiEngineAgent.run(body);
    return NextResponse.json({ ...result, success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
