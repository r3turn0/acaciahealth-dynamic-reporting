/**
 * GET    /api/bi/datasets/:id  — fetch one dataset
 * PATCH  /api/bi/datasets/:id  — update schema/sample (optional version bump)
 * DELETE /api/bi/datasets/:id  — remove a dataset
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteDataset, getDataset, updateDataset } from "@/lib/bi/datasetService";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = getDataset(id);
  if (!dataset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(dataset);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = updateDataset(id, {
      name: body.name,
      fields: body.fields,
      relationships: body.relationships,
      sampleData: body.sampleData,
      bumpVersion: body.bumpVersion,
      note: body.note,
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[v0] PATCH /api/bi/datasets/[id] error:", err);
    return NextResponse.json({ error: "Failed to update dataset" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteDataset(id);
  return NextResponse.json({ ok });
}
