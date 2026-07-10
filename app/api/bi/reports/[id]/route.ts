/**
 * GET    /api/bi/reports/:id           — fetch one report
 * PATCH  /api/bi/reports/:id           — update a report config
 * POST   /api/bi/reports/:id?duplicate — duplicate a report
 * DELETE /api/bi/reports/:id           — remove a report
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deleteReport,
  duplicateReport,
  getReport,
  updateReport,
} from "@/lib/bi/reportingService";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (req.nextUrl.searchParams.has("duplicate")) {
    const copy = duplicateReport(id);
    if (!copy) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(copy, { status: 201 });
  }
  return NextResponse.json({ error: "Unsupported operation" }, { status: 400 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = updateReport(id, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[v0] PATCH /api/bi/reports/[id] error:", err);
    return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteReport(id);
  return NextResponse.json({ ok });
}
