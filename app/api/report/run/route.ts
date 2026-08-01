/**
 * POST /api/report/run  →  GATEWAY ADAPTER
 *
 * Report execution is now routed through QueryGateway — the single permitted
 * SQL execution entry point. Legacy report runner payload is translated to
 * a GatewayRequest with source="report_builder".
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import { formatReport } from "@/lib/services/formatter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { report_name, prompt, filters } = body;

    if (!report_name || typeof report_name !== "string") {
      return NextResponse.json({ error: "report_name is required" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!filters?.date_range?.start_date || !filters?.date_range?.end_date) {
      return NextResponse.json(
        { error: "filters.date_range with start_date and end_date is required" },
        { status: 400 }
      );
    }

    const result = await runQueryGateway({
      query: prompt,
      source: "report_builder",
      startDate: filters.date_range.start_date,
      endDate: filters.date_range.end_date,
      branchCode: filters.branch_code,
      reportName: report_name,
      signal: req.signal,
    });

    if (!result.validation.valid) {
      return NextResponse.json(
        { error: "Query validation failed", details: result.validation.errors },
        { status: 422 }
      );
    }

    const rows = result.execution?.rows ?? [];
    const report = formatReport(
      report_name,
      filters,
      rows as Record<string, unknown>[],
      result.intent.requiredKpis[0] ?? "custom",
      result.sql
    );

    return NextResponse.json({
      ...report,
      demo_mode: result.demoMode,
      cache_hit: false,
      gateway: {
        requestId: result.requestId,
        confidence: result.confidence,
        pipeline: result.pipeline,
        intent: result.intent,
        lineage: result.lineage,
        governance: result.governance,
      },
    });
  } catch (err) {
    if (req.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    console.error("[Gateway→report/run] error:", err);
    return NextResponse.json({ error: "Report execution failed" }, { status: 500 });
  }
}
