/**
 * POST /api/gateway/feedback
 *
 * Capture user feedback for a completed gateway result.
 * Accepted feedback causes the result to be promoted in the LearningRepository.
 *
 * Body:
 * {
 *   requestId:  string   — the GatewayResult.requestId to rate
 *   rating:     number   — 1–5 (5 = perfect, 1 = incorrect)
 *   accepted:   boolean  — user accepted the result
 *   userEdits?: string   — corrected SQL if user modified it
 *   comment?:  string
 * }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { acceptGatewayResult, getAuditLog } from "@/lib/gateway/QueryGateway";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestId, rating, accepted, userEdits, comment } = body as {
      requestId: string;
      rating: number;
      accepted: boolean;
      userEdits?: string;
      comment?: string;
    };

    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating must be 1–5" }, { status: 400 });
    }

    if (accepted) {
      acceptGatewayResult(requestId, rating);
    }

    return NextResponse.json({
      recorded: true,
      requestId,
      rating,
      accepted,
      hasEdits: !!userEdits,
      ts: new Date().toISOString(),
      message: accepted && rating >= 4
        ? "Result accepted — query promoted to learning repository"
        : "Feedback recorded",
    });
  } catch (err) {
    console.error("[QueryGateway] /api/gateway/feedback error:", err);
    return NextResponse.json({ error: "Feedback recording failed" }, { status: 500 });
  }
}

/**
 * GET /api/gateway/feedback
 * Returns recent audit log entries.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const log = getAuditLog(Math.min(limit, 200));
  return NextResponse.json({ log, count: log.length });
}
