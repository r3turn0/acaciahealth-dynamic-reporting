/**
 * GET  /api/reports       — list all saved reports
 * POST /api/reports       — create a new saved report
 *
 * Delegates to reportService (in-memory fallback when no DB is configured).
 * The analytics data source (MSSQL) is never touched here.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listReports, createReport } from "@/lib/services/reportService";

export async function GET() {
  try {
    const reports = await listReports();
    return NextResponse.json({ reports, count: reports.length });
  } catch (err) {
    console.error("[v0] GET /api/reports error:", err);
    return NextResponse.json({ error: "Failed to list reports" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, prompt, sql, kpi, tags, visibility, created_by } = body;

    if (!name || !sql) {
      return NextResponse.json(
        { error: "name and sql are required" },
        { status: 400 }
      );
    }

    const report = await createReport({
      name,
      description: description ?? "",
      prompt: prompt ?? "",
      sql,
      kpi: kpi ?? "custom",
      tags: Array.isArray(tags) ? tags : [],
      visibility: visibility ?? "team",
      created_by: created_by ?? "analyst",
    });

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error("[v0] POST /api/reports error:", err);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
