/**
 * GET  /api/bi/datasets   — list all dataset schemas
 * POST /api/bi/datasets   — create a dataset schema
 */

import { NextRequest, NextResponse } from "next/server";
import { createDataset, listDatasets } from "@/lib/bi/datasetService";

export async function GET() {
  return NextResponse.json({ datasets: listDatasets() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.name || !Array.isArray(body?.fields) || body.fields.length === 0) {
      return NextResponse.json(
        { error: "name and a non-empty fields array are required" },
        { status: 400 }
      );
    }
    const dataset = createDataset({
      name: String(body.name),
      fields: body.fields,
      relationships: body.relationships ?? [],
      sampleData: body.sampleData ?? [],
      source: body.source ?? "manual",
    });
    return NextResponse.json(dataset, { status: 201 });
  } catch (err) {
    console.error("[v0] POST /api/bi/datasets error:", err);
    return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });
  }
}
