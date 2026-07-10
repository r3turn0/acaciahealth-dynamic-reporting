/**
 * GET  /api/bi/reports          — list saved KPI reports (optional ?datasetId=)
 * POST /api/bi/reports          — create a KPI report config
 */

import { NextRequest, NextResponse } from "next/server";
import { createReport, listReports } from "@/lib/bi/reportingService";

export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId") ?? undefined;
  return NextResponse.json({ reports: listReports(datasetId) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.name || !body?.datasetId) {
      return NextResponse.json(
        { error: "name and datasetId are required" },
        { status: 400 }
      );
    }
    const report = createReport({
      name: String(body.name),
      datasetId: String(body.datasetId),
      metrics: body.metrics ?? [],
      dimensions: body.dimensions ?? [],
      filters: body.filters ?? [],
      chart: body.chart ?? "bar",
      createdBy: body.createdBy,
    });
    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error("[v0] POST /api/bi/reports error:", err);
    return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
  }
}
