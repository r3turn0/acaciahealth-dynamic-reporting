/**
 * POST /api/generate-sql  →  GATEWAY ADAPTER
 *
 * Vector-augmented NL → SQL. Now routes through QueryGateway (planOnly=true)
 * to enforce all 9 pipeline stages. Response shape preserved for callers.
 * source="natural_language" — full intent, semantic search, and validation enforced.
 */

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userQuery = "", savedReports: _savedReports = [], fixLog: _fixLog = [] } = body as {
    userQuery: string;
    savedReports?: unknown[];
    fixLog?: unknown[];
  };

  if (!userQuery.trim()) {
    return NextResponse.json({ error: "userQuery is required" }, { status: 400 });
  }

  try {
    // Default date range: last 30 days (callers can override)
    const endDate   = body.endDate   ?? new Date().toISOString().split("T")[0];
    const startDate = body.startDate ?? new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];

    const result = await runQueryGateway({
      query: userQuery,
      source: "natural_language",
      startDate,
      endDate,
      planOnly: true,
    });

    const confidence = result.confidence;
    const needsFix = confidence < 0.7 || !result.validation.valid;

    return NextResponse.json({
      sql: result.sql,
      explanation: result.explanation,
      confidence,
      sourcesUsed: result.semanticContext.approvedMetadataSources,
      tablesReferenced: result.lineage.tablesUsed,
      needsFix,
      meta: {
        model: result.pipeline.find((s) => s.stage === "SQLGeneratorAgent")?.status === "ok" ? "gateway" : "heuristic",
        fallback: result.pipeline.find((s) => s.stage === "SQLGeneratorAgent")?.status === "fallback",
      },
      gateway: {
        requestId: result.requestId,
        pipeline: result.pipeline,
        validation: result.validation,
        intent: result.intent,
        lineage: result.lineage,
      },
    });
  } catch (err) {
    console.error("[Gateway→generate-sql] error:", err);
    return NextResponse.json({ error: "SQL generation failed" }, { status: 500 });
  }
}
