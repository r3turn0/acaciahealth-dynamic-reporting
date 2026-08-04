/**
 * GET    /api/agents/kpi-definitions          — list all KPI definitions
 * GET    /api/agents/kpi-definitions?q=<str>  — search KPI definitions
 * POST   /api/agents/kpi-definitions          — create a new KPI definition
 * PUT    /api/agents/kpi-definitions          — update an existing KPI definition
 * DELETE /api/agents/kpi-definitions?name=<>  — delete a KPI definition
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { kpiDefinitionAgent, type CreateKPIInput, type UpdateKPIInput } from "@/lib/agents/KPIDefinitionAgent";

// Ensure VectorEmbeddingAgent is registered (used by KPIDefinitionAgent for indexing)
import "@/lib/agents/VectorEmbeddingAgent";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q")?.trim();

  if (q) {
    const results = kpiDefinitionAgent.search(q);
    return NextResponse.json({ kpis: results, count: results.length, query: q });
  }

  const { kpis, count } = kpiDefinitionAgent.list();
  return NextResponse.json({ kpis, count, generatedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateKPIInput;
    const kpi = kpiDefinitionAgent.create(body);
    return NextResponse.json({ kpi, success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateKPIInput;
    const kpi = kpiDefinitionAgent.update(body);
    return NextResponse.json({ kpi, success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "name query param is required" }, { status: 400 });
  }
  const deleted = kpiDefinitionAgent.delete(name);
  if (!deleted) {
    return NextResponse.json({ error: `KPI "${name}" not found` }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, name });
}
