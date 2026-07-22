/**
 * GET  /api/gateway/patterns  — list all learned patterns
 * POST /api/gateway/patterns  — promote a pattern to approved status
 *
 * Governance endpoint: human approval required before a learned pattern
 * becomes an approved pattern. The ContinuousImprovementAgent surfaces
 * candidates; a human (admin/analyst) approves them here.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getLearnedPatterns, promoteLearningPattern } from "@/lib/gateway/QueryGateway";

export async function GET() {
  const patterns = getLearnedPatterns();
  return NextResponse.json({
    patterns,
    count: patterns.length,
    approvedCount: patterns.filter((p) => p.accepted).length,
    pendingCount: patterns.filter((p) => !p.accepted).length,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patternId } = body as { patternId: string };

    if (!patternId) {
      return NextResponse.json({ error: "patternId is required" }, { status: 400 });
    }

    const promoted = promoteLearningPattern(patternId);
    if (!promoted) {
      return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
    }

    return NextResponse.json({
      promoted: true,
      patternId,
      ts: new Date().toISOString(),
      message: "Pattern approved — now eligible for reuse via ApprovedPatternAgent",
    });
  } catch (err) {
    console.error("[QueryGateway] /api/gateway/patterns error:", err);
    return NextResponse.json({ error: "Pattern promotion failed" }, { status: 500 });
  }
}
