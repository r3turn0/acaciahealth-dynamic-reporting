/**
 * GET  /api/reports       — list all saved reports
 * POST /api/reports       — create a new saved report
 */

import { NextRequest, NextResponse } from "next/server";
import { listReports, saveReport } from "@/lib/agents/reportRegistry";

export async function GET() {
  try {
    const reports = listReports();
    return NextResponse.json({ reports, count: reports.length });
  } catch (err) {
    console.error("[v0] GET /api/reports error:", err);
    return NextResponse.json({ error: "Failed to list reports" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, prompt, sql, kpi, tags, created_by } = body;

    if (!name || !sql) {
      return NextResponse.json(
        { error: "name and sql are required" },
        { status: 400 }
      );
    }

    const report = saveReport({
      name,
      description: description ?? "",
      prompt: prompt ?? "",
      sql,
      kpi: kpi ?? "custom",
      tags: Array.isArray(tags) ? tags : [],
      created_by: created_by ?? "analyst",
    });

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error("[v0] POST /api/reports error:", err);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
