/**
 * GET    /api/reports/[id]  — get single report
 * PATCH  /api/reports/[id]  — update report fields (creates version if sql/note provided)
 * DELETE /api/reports/[id]  — delete report
 *
 * Delegates to reportService (AppDataClient / PostgreSQL).
 * The analytics data source (MSSQL) is never touched here.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getReport,
  updateReport,
  deleteReport,
  pinReport,
  unpinReport,
} from "@/lib/services/reportService";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const updated = await updateReport(id, {
    name: body.name,
    description: body.description,
    sql: body.sql,
    kpi: body.kpi,
    tags: body.tags,
    visibility: body.visibility,
    status: body.status,
    versionNote: body.versionNote,
    updated_by: body.updated_by ?? "analyst",
  });
  if (!updated) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  // Handle pin status change if provided
  if (typeof body.pinned === "boolean") {
    if (body.pinned) {
      await pinReport(id, body.updated_by ?? "analyst");
    } else {
      await unpinReport(id);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // Clean up pin before deleting
  await unpinReport(id);
  const deleted = await deleteReport(id);
  if (!deleted) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
