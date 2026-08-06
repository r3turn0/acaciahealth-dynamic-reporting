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
  MAX_RETRIES,
  retryWithSchemaIntelligence,
} from "@/lib/agents/SchemaAwareRetryAgent";
import { isAiConfigured } from "@/lib/ai/gateway";
import { queryMultiple } from "@/lib/db/readOnlyClient";
import type { CorrectionInput } from "@/lib/services/queryCorrectionService";

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

    const result = await retryWithSchemaIntelligence(
      {
        userRequest: originalPrompt,
        failedSql: failedSQL,
        errorMessage,
        startDate,
        endDate,
        branchCode,
      },
      async (candidateSql) => {
        try {
          const execution = await queryMultiple(
            candidateSql,
            { StartDate: startDate, EndDate: endDate, BranchCode: branchCode },
            req.signal
          );
          return { ok: true as const, execution };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );

    const correctedPlan = result.succeeded && result.correctedSql
      ? {
          sql: result.correctedSql,
          explanation: result.explanation,
          tables_used: [...result.correctedSql.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
            .map((match) => match[1].replace(/[\[\]"]/g, "")),
          filters_applied: [`Date range: ${startDate} to ${endDate}`, ...(branchCode ? [`Branch: ${branchCode}`] : [])],
          kpi_detected: null,
          strategy: "sql" as const,
          api_fallback_reason: null,
          cost_warning: null,
          optimized_suggestion: null,
          confidenceScore: 1,
        }
      : null;

    return NextResponse.json({
      correctedPlan,
      attempts: result.attempts,
      totalAttempts: result.totalAttempts,
      succeeded: result.succeeded,
      finalError: result.finalError,
      maxAttempts: MAX_RETRIES,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    console.error("[v0] /api/generate-query/correct error:", err);
    return NextResponse.json({ error: "Correction loop failed" }, { status: 500 });
  }
}
