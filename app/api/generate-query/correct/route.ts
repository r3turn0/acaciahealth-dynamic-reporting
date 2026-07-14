/**
 * POST /api/generate-query/correct
 *
 * Self-Healing Query Correction Endpoint
 *
 * Accepts a failed SQL query + execution error message and runs the
 * correction loop (up to 3 AI-assisted attempts) to produce a fixed query.
 *
 * Request body:
 * {
 *   originalPrompt: string,
 *   failedSQL:      string,
 *   errorMessage:   string,
 *   startDate:      string (YYYY-MM-DD),
 *   endDate:        string (YYYY-MM-DD),
 *   branchCode?:    string
 * }
 *
 * Response:
 * {
 *   correctedPlan:  AiQueryResult | null,
 *   attempts:       CorrectionAttempt[],
 *   totalAttempts:  number,
 *   succeeded:      boolean,
 *   finalError:     string | null,
 *   elapsed_ms:     number
 * }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  correctQuery,
  MAX_CORRECTION_ATTEMPTS,
  type CorrectionInput,
} from "@/lib/services/queryCorrectionService";
import { isAiConfigured } from "@/lib/ai/gateway";

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { originalPrompt, failedSQL, errorMessage, startDate, endDate, branchCode } = body as CorrectionInput & {
      startDate?: string;
      endDate?: string;
    };

    // Input validation
    if (!originalPrompt || typeof originalPrompt !== "string") {
      return NextResponse.json({ error: "originalPrompt is required" }, { status: 400 });
    }
    if (!failedSQL || typeof failedSQL !== "string") {
      return NextResponse.json({ error: "failedSQL is required" }, { status: 400 });
    }
    if (!errorMessage || typeof errorMessage !== "string") {
      return NextResponse.json({ error: "errorMessage is required" }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }

    if (!isAiConfigured()) {
      return NextResponse.json(
        {
          error: "AI is not configured — correction loop unavailable",
          hint: "Set AI_GATEWAY_API_KEY or AZURE_OPENAI_API_KEY to enable self-healing queries.",
        },
        { status: 503 }
      );
    }

    const result = await correctQuery({
      originalPrompt,
      failedSQL,
      errorMessage,
      startDate,
      endDate,
      branchCode,
    });

    return NextResponse.json({
      ...result,
      maxAttempts: MAX_CORRECTION_ATTEMPTS,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    console.error("[v0] /api/generate-query/correct error:", err);
    return NextResponse.json({ error: "Correction loop failed" }, { status: 500 });
  }
}
