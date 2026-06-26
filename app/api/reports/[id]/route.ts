/**
 * GET    /api/reports/[id]  — get single report
 * PATCH  /api/reports/[id]  — update report fields
 * DELETE /api/reports/[id]  — delete report
 */

import { NextRequest, NextResponse } from "next/server";
import { getReport, updateReport, deleteReport } from "@/lib/agents/reportRegistry";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const updated = updateReport(id, body);
  if (!updated) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = deleteReport(id);
  if (!deleted) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
