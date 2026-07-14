/**
 * lib/services/queryCorrectionService.ts
 *
 * Self-Healing Query Correction Loop
 *
 * When a SQL query fails execution, this service sends the original prompt,
 * the failed SQL, and the MSSQL error message back to the AI model to
 * generate a corrected version.  Up to MAX_ATTEMPTS correction passes are
 * made before giving up.
 *
 * Each attempt:
 *  1. Sends (originalPrompt, failedSQL, errorMessage, attemptNumber) to AI
 *  2. Validates the corrected SQL with queryGuard (read-only safety)
 *  3. Returns the corrected plan with an updated confidence score
 *
 * Separation contract:
 *  - No MSSQL or AppDB access — callers execute the corrected SQL themselves
 *  - Uses the same schema-aware correction prompt template as aiQueryService
 */

import { generateText, Output } from "ai";
import { getModel, isAiConfigured } from "@/lib/ai/gateway";
import {
  buildCorrectionSystemPrompt,
  buildCorrectionUserMessage,
  type CorrectionContext,
} from "@/lib/ai/promptTemplates";
import { validateQuery } from "@/lib/services/queryGuard";
import { parameterizeDates } from "@/lib/services/dateParams";
import { AiQueryResultSchema, type AiQueryResult } from "@/lib/services/aiQueryService";

// ── Config ────────────────────────────────────────────────────────────────────

export const MAX_CORRECTION_ATTEMPTS = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorrectionInput {
  originalPrompt: string;
  startDate: string;
  endDate: string;
  branchCode?: string;
  failedSQL: string;
  errorMessage: string;
}

export interface CorrectionAttempt {
  attemptNumber: number;
  correctedSQL: string;
  explanation: string;
  confidenceScore: number;
  validationErrors: string[];
  elapsed_ms: number;
  success: boolean;
}

export interface CorrectionResult {
  correctedPlan: AiQueryResult | null;
  attempts: CorrectionAttempt[];
  totalAttempts: number;
  succeeded: boolean;
  finalError: string | null;
}

// ── Core correction loop ──────────────────────────────────────────────────────

/**
 * Attempt to correct a failing SQL query up to MAX_CORRECTION_ATTEMPTS times.
 * Returns the first successfully validated corrected plan, or null if all
 * attempts fail.
 */
export async function correctQuery(input: CorrectionInput): Promise<CorrectionResult> {
  if (!isAiConfigured()) {
    return {
      correctedPlan: null,
      attempts: [],
      totalAttempts: 0,
      succeeded: false,
      finalError: "AI not configured — correction loop unavailable",
    };
  }

  const attempts: CorrectionAttempt[] = [];
  let currentSQL = input.failedSQL;
  let currentError = input.errorMessage;

  for (let attempt = 1; attempt <= MAX_CORRECTION_ATTEMPTS; attempt++) {
    const t0 = Date.now();

    const ctx: CorrectionContext = {
      userPrompt: input.originalPrompt,
      startDate: input.startDate,
      endDate: input.endDate,
      branchCode: input.branchCode,
      failedSQL: currentSQL,
      errorMessage: currentError,
      attemptNumber: attempt,
    };

    let corrected: AiQueryResult;

    try {
      const result = await generateText({
        model: getModel("capable"),
        system: buildCorrectionSystemPrompt(),
        prompt: buildCorrectionUserMessage(ctx),
        experimental_output: Output.object({ schema: AiQueryResultSchema }),
        temperature: 0.05, // Very low temperature — we want deterministic fixes
        maxOutputTokens: 2048,
      });

      corrected = result.experimental_output as AiQueryResult;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      attempts.push({
        attemptNumber: attempt,
        correctedSQL: currentSQL,
        explanation: `AI call failed: ${errMsg}`,
        confidenceScore: 0,
        validationErrors: [`AI error: ${errMsg}`],
        elapsed_ms: Date.now() - t0,
        success: false,
      });
      // No point retrying if the AI call itself failed
      break;
    }

    const elapsed_ms = Date.now() - t0;

    // Parameterise dates in the corrected SQL
    const { sql: paramSql } = parameterizeDates(corrected.sql ?? "");
    corrected = { ...corrected, sql: paramSql };

    // Validate the corrected SQL
    const validation = validateQuery(corrected.sql);

    const attemptRecord: CorrectionAttempt = {
      attemptNumber: attempt,
      correctedSQL: corrected.sql,
      explanation: corrected.explanation,
      confidenceScore: corrected.confidenceScore ?? 0,
      validationErrors: validation.errors,
      elapsed_ms,
      success: validation.valid,
    };

    attempts.push(attemptRecord);

    if (validation.valid) {
      return {
        correctedPlan: corrected,
        attempts,
        totalAttempts: attempt,
        succeeded: true,
        finalError: null,
      };
    }

    // Feed the validation errors back as the new "error" for the next attempt
    currentSQL = corrected.sql;
    currentError = `Validation errors on attempt ${attempt}: ${validation.errors.join("; ")}`;
  }

  // All attempts exhausted
  return {
    correctedPlan: null,
    attempts,
    totalAttempts: attempts.length,
    succeeded: false,
    finalError: `Query correction failed after ${attempts.length} attempt(s). Last error: ${currentError}`,
  };
}

/**
 * Lightweight helper: run a single correction pass (attempt = 1).
 * Useful when the caller wants a single self-heal without the full loop.
 */
export async function correctQueryOnce(
  input: CorrectionInput
): Promise<{ plan: AiQueryResult | null; error: string | null }> {
  const result = await correctQuery({ ...input });
  if (result.succeeded && result.correctedPlan) {
    return { plan: result.correctedPlan, error: null };
  }
  return { plan: null, error: result.finalError };
}
