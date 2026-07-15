/**
 * lib/services/aiQueryService.ts
 *
 * AI Query Service — Natural Language → validated T-SQL
 *
 * This is the single authoritative entry point for AI-powered query generation.
 * It uses schema-aware prompt templates, structured output via Zod, and returns
 * a QueryPlan with a confidence score.
 *
 * Separation contract:
 *  - ONLY calls the AI gateway (no MSSQL or AppDB touches here)
 *  - Validation (queryGuard) is called here so callers get a clean result
 *  - Callers are responsible for execution (run-sql route)
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, isAiConfigured } from "@/lib/ai/gateway";
import {
  buildSQLSystemPrompt,
  buildSQLUserMessage,
  type PromptContext,
} from "@/lib/ai/promptTemplates";
import { validateQuery } from "@/lib/services/queryGuard";
import { parameterizeDates } from "@/lib/services/dateParams";

// ── Output schema (extends QueryPlan with confidenceScore) ────────────────────

export const AiQueryResultSchema = z.object({
  sql: z.string().describe("Complete, parameterized T-SQL SELECT query"),
  explanation: z.string().describe("Plain-English explanation of what the query returns"),
  tables_used: z.array(z.string()).describe("Physical table names in FROM/JOIN clauses"),
  filters_applied: z.array(z.string()).describe("Human-readable filter descriptions"),
  kpi_detected: z.string().nullable().describe("KPI category detected, or null"),
  strategy: z.enum(["sql", "api_fallback"]).describe("Execution strategy"),
  api_fallback_reason: z.string().nullable(),
  cost_warning: z.string().nullable(),
  optimized_suggestion: z.string().nullable(),
  confidenceScore: z
    .number()
    .min(0)
    .max(1)
    .describe("0.0–1.0 confidence that the SQL correctly answers the request"),
});

export type AiQueryResult = z.infer<typeof AiQueryResultSchema>;

export interface AiQueryServiceResult {
  plan: AiQueryResult;
  /** true when the result came from the AI model (vs. a pre-validation rejection) */
  aiUsed: boolean;
  /** Validation errors from queryGuard, empty on success */
  validationErrors: string[];
  /** ms taken for the AI call */
  elapsed_ms: number;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate a SQL query plan from a natural-language prompt.
 * Returns a validated AiQueryResult plus metadata.
 * Throws only on unrecoverable errors — callers should handle gracefully.
 */
export async function generateAiQuery(
  ctx: PromptContext
): Promise<AiQueryServiceResult> {
  if (!isAiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const t0 = Date.now();

  const result = await generateText({
    model: getModel("capable"),
    system: buildSQLSystemPrompt(),
    prompt: buildSQLUserMessage(ctx),
    experimental_output: Output.object({ schema: AiQueryResultSchema }),
    temperature: 0.1,
    maxOutputTokens: 2048,
  });

  const raw = result.experimental_output as AiQueryResult;
  const elapsed_ms = Date.now() - t0;

  // Parameterise any hardcoded dates
  const { sql: paramSql } = parameterizeDates(raw.sql ?? "");
  const plan: AiQueryResult = { ...raw, sql: paramSql };

  if (plan.optimized_suggestion) {
    const { sql: paramOpt } = parameterizeDates(plan.optimized_suggestion);
    plan.optimized_suggestion = paramOpt;
  }

  // Validate
  const validation = validateQuery(plan.sql);

  return {
    plan,
    aiUsed: true,
    validationErrors: validation.errors,
    elapsed_ms,
  };
}
