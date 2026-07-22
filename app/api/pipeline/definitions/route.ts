/**
 * /api/pipeline/definitions
 *
 * CRUD for Pipeline Definitions.
 *
 * GET    /api/pipeline/definitions        — list all pipelines
 * GET    /api/pipeline/definitions?id=X   — get one pipeline
 * POST   /api/pipeline/definitions        — create / upsert a pipeline
 * PATCH  /api/pipeline/definitions        — partial update (body: { id, ...patch })
 * DELETE /api/pipeline/definitions?id=X  — delete a pipeline
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pipelineEngine, type PipelineDefinition } from "@/lib/orchestrator/PipelineEngine";
import "@/lib/orchestrator/PipelineEngine"; // ensure seeded

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const def = pipelineEngine.getPipeline(id);
    if (!def) return NextResponse.json({ error: `Pipeline "${id}" not found` }, { status: 404 });
    return NextResponse.json({ pipeline: def });
  }

  const pipelines = pipelineEngine.listPipelines();
  return NextResponse.json({
    pipelines,
    count:        pipelines.length,
    enabledCount: pipelines.filter((p) => p.enabled).length,
    defaultId:    pipelineEngine.getDefault()?.id ?? null,
    generatedAt:  new Date().toISOString(),
  });
}

// ── POST ——— create / upsert ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, name, description, version, steps, isDefault, enabled, tags, timeoutMs, createdBy } = body;

  if (!id || !name || !Array.isArray(steps)) {
    return NextResponse.json({ error: "id, name, and steps are required" }, { status: 400 });
  }

  const saved = pipelineEngine.savePipeline({
    id:          String(id),
    name:        String(name),
    description: String(description ?? ""),
    version:     String(version ?? "1.0.0"),
    steps:       steps as PipelineDefinition["steps"],
    isDefault:   Boolean(isDefault ?? false),
    enabled:     enabled !== false,
    tags:        Array.isArray(tags) ? (tags as string[]) : [],
    timeoutMs:   Number(timeoutMs ?? 180000),
    createdBy:   String(createdBy ?? "api"),
  });

  // Validate
  const validation = pipelineEngine.validate(saved);

  return NextResponse.json({ pipeline: saved, validation }, { status: 201 });
}

// ── PATCH ——— partial update ──────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updated = pipelineEngine.updatePipeline(String(id), patch as Partial<PipelineDefinition>);
  if (!updated) return NextResponse.json({ error: `Pipeline "${id}" not found` }, { status: 404 });

  const validation = pipelineEngine.validate(updated);
  return NextResponse.json({ pipeline: updated, validation });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });

  const removed = pipelineEngine.deletePipeline(id);
  if (!removed) return NextResponse.json({ error: `Pipeline "${id}" not found` }, { status: 404 });

  return NextResponse.json({ removed: true, id });
}
