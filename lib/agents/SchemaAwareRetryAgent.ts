/**
 * lib/agents/SchemaAwareRetryAgent.ts
 *
 * Phase 9 — Historical Retry Intelligence
 *
 * When a SQL query fails execution, this agent:
 *   1. Classifies the failure (Phase 8: Failure Analysis Engine)
 *   2. Checks history to ensure the retry SQL is NOT logically identical
 *      to any prior attempt (Golden Rule: never retry the same query twice)
 *   3. Builds a schema-aware, metadata-aware, history-aware remediation strategy
 *   4. Calls the AI to generate a corrected SQL that is structurally different
 *   5. Validates the corrected SQL via queryGuard
 *   6. Records every attempt and learned mappings (Phase 10)
 *
 * Anti-loop safeguards are mandatory:
 *   - Abort if SQL is identical (same normalized hash)
 *   - Abort if logically equivalent after stripping whitespace/aliases
 *   - Abort if retry strategy is unchanged
 *   - Abort if same failure repeats without remediation
 *
 * Maximum retries: configurable, default MAX_RETRIES = 3
 */

import { generateText } from "ai";
import { getModel, isAiConfigured } from "@/lib/ai/gateway";
import { validateQuery } from "@/lib/services/queryGuard";
import { parameterizeDates } from "@/lib/services/dateParams";
import {
  classifyFailure,
  buildRemediationStrategy,
  hashSql,
  isSqlDuplicate,
  getAttemptsForRequest,
  recordQueryAttempt,
  upsertLearnedMapping,
  learnFromSuccess,
  learnFromFailure,
  suggestMappingsForError,
  getLearnedMappings,
  type RetryAttempt,
  type FailureClass,
  type QueryHistoryEntry,
} from "@/lib/services/queryHistoryStore";
import { inferQueryContext } from "@/lib/agents/schemaAgent";
import {
  buildCompactCorrectionPrompt,
} from "@/lib/ai/insightAgentPrompt";
import type { KnowledgeGraphContext } from "@/lib/ai/insightAgentPrompt";

// ── Config ────────────────────────────────────────────────────────────────────

export const MAX_RETRIES = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryInput {
  userRequest: string;
  startDate: string;
  endDate: string;
  branchCode?: string;
  failedSql: string;
  errorMessage: string;
  /** History entry id for the original attempt (to update on success) */
  originalHistoryId?: string;
}

export interface RetryAttemptResult {
  attemptNumber: number;
  correctedSql: string;
  normalizedHash: string;
  explanation: string;
  failureClass: FailureClass;
  remediationStrategy: string;
  validationErrors: string[];
  elapsed_ms: number;
  success: boolean;
  abortReason?: string;
}

export interface RetryResult {
  correctedSql: string | null;
  explanation: string;
  attempts: RetryAttemptResult[];
  totalAttempts: number;
  succeeded: boolean;
  finalError: string | null;
  /** The failure classification of the original error */
  failureClass: FailureClass;
  learnedMappingsUsed: Array<{ term: string; suggestion: string; confidence: number }>;
}

// ── System prompt for schema-aware correction ─────────────────────────────────

function buildRetrySystemPrompt(
  contextSummary: string,
  learnedMappingSummary: string
): string {
  return [
    "You are a T-SQL query correction specialist for AcaciaHealth Dynamic Reporting.",
    "The database is a MSSQL Server data warehouse. It is READ-ONLY — only SELECT queries are permitted.",
    "",
    "CORRECTION RULES:",
    "1. Every corrected SQL must be STRUCTURALLY DIFFERENT from the failed SQL.",
    "   — Try a different table, different join path, different filter logic, or different aggregation.",
    "2. Always include: SELECT TOP 10000, WHERE with @StartDate and @EndDate, no SELECT *.",
    "3. Use WITH (NOLOCK) on large tables.",
    "4. RTRIM() on all varchar branch code comparisons.",
    "5. Never use UPDATE, DELETE, INSERT, DROP, TRUNCATE, CREATE, EXEC, ALTER.",
    "",
    "SCHEMA CONTEXT (use ONLY these approved tables):",
    contextSummary,
    "",
    learnedMappingSummary ? `LEARNED MAPPINGS (high-confidence term → table resolutions from history):\n${learnedMappingSummary}\n` : "",
    "FAILURE REMEDIATION STRATEGIES:",
    "- TABLE_NOT_FOUND: Replace with the correct table from the schema above. Check learned mappings.",
    "- COLUMN_NOT_FOUND: Replace with the correct column name. Check column list above.",
    "- JOIN_FAILURE: Fix join condition; ensure RTRIM() on varchar keys.",
    "- TYPE_MISMATCH: Add CAST/CONVERT. Check date vs nvarchar columns.",
    "- AGGREGATION_ERROR: Ensure all non-aggregated SELECT cols appear in GROUP BY.",
    "- SYNTAX_ERROR: Fix T-SQL syntax; validate bracket/quote matching.",
    "",
    "Return ONLY a JSON object with this exact shape:",
    '{ "sql": "...", "explanation": "...", "confidence": 0.0-1.0, "changed_element": "table|join|filter|column|aggregation" }',
    "No markdown. No code fences. No extra text.",
  ].join("\n");
}

function buildRetryUserPrompt(input: RetryInput, attemptNumber: number, remediationStrategy: string, priorHashes: Set<string>): string {
  return [
    `Original user request: "${input.userRequest}"`,
    `Date range: ${input.startDate} to ${input.endDate}`,
    input.branchCode ? `Branch filter: ${input.branchCode}` : "",
    `Attempt number: ${attemptNumber}`,
    ``,
    `FAILED SQL:`,
    "```sql",
    input.failedSql,
    "```",
    ``,
    `ERROR: ${input.errorMessage}`,
    ``,
    `Remediation strategy: ${remediationStrategy}`,
    ``,
    priorHashes.size > 0
      ? `PRIOR ATTEMPT HASHES (your corrected SQL must NOT produce any of these hashes): ${[...priorHashes].join(", ")}`
      : "",
    ``,
    `Generate a corrected T-SQL query that is STRUCTURALLY DIFFERENT from the failed one.`,
    `The "changed_element" field must describe which part you changed (table, join, filter, column, or aggregation).`,
  ].filter(Boolean).join("\n");
}

// ── Main retry loop ───────────────────────────────────────────────────────────

export async function retryWithSchemaIntelligence(
  input: RetryInput
): Promise<RetryResult> {
  const attempts: RetryAttemptResult[] = [];
  const failureClass = classifyFailure(input.errorMessage);

  // Fetch prior attempts to build known hash set
  const priorAttempts = await getAttemptsForRequest(input.userRequest);
  const triedHashes = new Set<string>(priorAttempts.map((a: QueryHistoryEntry) => hashSql(a.query_text)));
  triedHashes.add(hashSql(input.failedSql)); // Include the current failure

  // Record the original failure
  await learnFromFailure(input.userRequest, input.failedSql, input.errorMessage);

  // Resolve schema context for this user request
  const contextResult = await inferQueryContext(input.userRequest).catch(() => null);
  const contextSummary = contextResult
    ? [
        `Top candidate tables: ${contextResult.resolvedTables.slice(0, 5).map((t) => `${t.table_name} (confidence: ${(t.table_confidence * 100).toFixed(0)}%)`).join(", ")}`,
        `Detected business terms: ${contextResult.businessTerms.join(", ") || "none"}`,
        `Known join paths: ${contextResult.joinPaths.slice(0, 3).join("; ") || "none"}`,
      ].join("\n")
    : "Use schemaConfig.json (CLIENT_EPISODES_ALL, BRANCHES, BILLING.LINE_ITEMS, CARE_TYPES, SERVICE_LINES)";

  // Get learned mappings for suggestions
  const allMappings = await getLearnedMappings(100);
  const mappingSuggestions = await suggestMappingsForError(input.errorMessage, failureClass);
  const learnedMappingSummary = mappingSuggestions.length > 0
    ? mappingSuggestions.map((s) => `  "${s.term}" → "${s.suggestion}" (confidence: ${(s.confidence * 100).toFixed(0)}%)`).join("\n")
    : allMappings.filter((m) => m.confidence >= 0.7).slice(0, 5).map((m) => `  "${m.user_term}" → "${m.actual_object}" (confidence: ${(m.confidence * 100).toFixed(0)}%)`).join("\n");

  // Build KG context for correction prompt injection
  const kgContext: KnowledgeGraphContext | undefined = contextResult ? {
    resolvedTables: contextResult.resolvedTables,
    resolvedColumns: contextResult.resolvedColumns,
    businessTerms: contextResult.businessTerms,
    joinPaths: contextResult.joinPaths,
    confidence: contextResult.confidence,
    learnedMappings: mappingSuggestions.map((s) => ({
      term: s.term,
      suggestion: s.suggestion,
      confidence: s.confidence,
    })),
  } : undefined;

  // Pre-load schema/kpi/semantic configs for correction prompt
  const [schemaConfig, kpiConfig, semanticLayer] = await Promise.all([
    import("@/lib/config/schemaConfig.json").then((m) => JSON.stringify(m.default, null, 2)).catch(() => "{}"),
    import("@/lib/config/kpiConfig.json").then((m) => JSON.stringify(m.default, null, 2)).catch(() => "{}"),
    import("@/lib/config/semanticLayer.json").then((m) => JSON.stringify(m.default, null, 2)).catch(() => "{}"),
  ]);

  let currentSql = input.failedSql;
  let currentError = input.errorMessage;
  let lastRemediationStrategy = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();

    // Build remediation strategy for this attempt
    const remediationStrategy = buildRemediationStrategy(failureClass, currentError, allMappings);

    // Anti-loop: abort if strategy is unchanged and we've already tried
    if (attempt > 1 && remediationStrategy === lastRemediationStrategy) {
      const abortMsg = `Retry aborted: same remediation strategy as attempt ${attempt - 1} with no structural change`;
      attempts.push({
        attemptNumber: attempt,
        correctedSql: currentSql,
        normalizedHash: hashSql(currentSql),
        explanation: abortMsg,
        failureClass,
        remediationStrategy,
        validationErrors: [abortMsg],
        elapsed_ms: Date.now() - t0,
        success: false,
        abortReason: abortMsg,
      });
      break;
    }
    lastRemediationStrategy = remediationStrategy;

    // AI not configured — cannot generate corrected SQL
    if (!isAiConfigured()) {
      const abortMsg = "AI not configured — schema-aware retry unavailable";
      attempts.push({
        attemptNumber: attempt,
        correctedSql: currentSql,
        normalizedHash: hashSql(currentSql),
        explanation: abortMsg,
        failureClass,
        remediationStrategy,
        validationErrors: [abortMsg],
        elapsed_ms: Date.now() - t0,
        success: false,
        abortReason: abortMsg,
      });
      break;
    }

    let correctedSql = "";
    let explanation = "";
    let confidence = 0;

    try {
      const { systemPrompt, apcsMetrics } = buildCompactCorrectionPrompt(
        schemaConfig,
        kpiConfig,
        semanticLayer,
        kgContext,
        {
          failureClass: failureClass as string,
          remediationStrategy,
          previousAttempts: attempt - 1,
        },
        {
          querySignature: input.userRequest,
          retryHistory: priorAttempts.map((a: QueryHistoryEntry) => ({
            userRequest: a.user_request,
            failureReason: a.failure_reason ?? undefined,
            fixStrategy:   a.remediation_strategy ?? undefined,
          })),
        }
      );

      // Log APCS savings for observability
      if (apcsMetrics.compressed) {
        console.log(
          `[SchemaAwareRetryAgent] APCS: ${apcsMetrics.originalTokens}t → ${apcsMetrics.compactedTokens}t ` +
          `(-${apcsMetrics.reductionPct}%) layers=[${apcsMetrics.layersApplied.join(",")}]`
        );
      }

      const { text } = await generateText({
        model: getModel("capable"),
        system: systemPrompt,
        prompt: buildRetryUserPrompt(input, attempt, remediationStrategy, triedHashes),
        maxOutputTokens: 1024,
        temperature: 0.1 + attempt * 0.05, // Slightly higher temp on later attempts for diversity
      });

      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as {
        sql: string;
        explanation: string;
        confidence: number;
        changed_element: string;
      };

      correctedSql = parsed.sql ?? "";
      explanation = parsed.explanation ?? "";
      confidence = parsed.confidence ?? 0.7;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const abortMsg = `AI call failed on attempt ${attempt}: ${errMsg}`;
      attempts.push({
        attemptNumber: attempt,
        correctedSql: currentSql,
        normalizedHash: hashSql(currentSql),
        explanation: abortMsg,
        failureClass,
        remediationStrategy,
        validationErrors: [`AI error: ${errMsg}`],
        elapsed_ms: Date.now() - t0,
        success: false,
        abortReason: abortMsg,
      });
      break;
    }

    // Parameterize dates in corrected SQL
    const { sql: paramSql } = parameterizeDates(correctedSql);
    correctedSql = paramSql;

    const newHash = hashSql(correctedSql);
    const elapsed_ms = Date.now() - t0;

    // ── Anti-loop: duplicate detection ─────────────────────────────────────────
    if (triedHashes.has(newHash) || isSqlDuplicate(correctedSql, input.failedSql)) {
      const abortMsg = `Retry aborted: SQL hash ${newHash} was already tried. Structurally identical to a prior attempt.`;
      attempts.push({
        attemptNumber: attempt,
        correctedSql,
        normalizedHash: newHash,
        explanation: abortMsg,
        failureClass,
        remediationStrategy,
        validationErrors: [abortMsg],
        elapsed_ms,
        success: false,
        abortReason: abortMsg,
      });

      // Record in history
      await recordQueryAttempt({
        user_request: input.userRequest,
        query_text: correctedSql,
        status: "aborted",
        retry_version: attempt,
        failure_reason: failureClass,
        remediation_strategy: remediationStrategy,
        error_message: abortMsg,
        execution_ms: elapsed_ms,
        schema_hash: hashSql(correctedSql),
        final_success_query: null,
        learned_mappings_snapshot: null,
      });

      break; // Stop — we have no new strategies
    }

    // Add to tried hashes
    triedHashes.add(newHash);

    // ── Validate corrected SQL ─────────────────────────────────────────────────
    const validation = validateQuery(correctedSql);

    const attemptResult: RetryAttemptResult = {
      attemptNumber: attempt,
      correctedSql,
      normalizedHash: newHash,
      explanation,
      failureClass,
      remediationStrategy,
      validationErrors: validation.errors,
      elapsed_ms,
      success: validation.valid,
    };

    attempts.push(attemptResult);

    // Record in history store
    await recordQueryAttempt({
      user_request: input.userRequest,
      query_text: correctedSql,
      status: validation.valid ? "success" : "retry",
      retry_version: attempt,
      failure_reason: validation.valid ? null : failureClass,
      remediation_strategy: remediationStrategy,
      error_message: validation.valid ? null : validation.errors.join("; "),
      execution_ms: elapsed_ms,
      schema_hash: newHash,
      final_success_query: validation.valid ? correctedSql : null,
      learned_mappings_snapshot: JSON.stringify(
        allMappings.slice(0, 20).reduce((acc, m) => {
          acc[m.user_term] = m.actual_object;
          return acc;
        }, {} as Record<string, string>)
      ),
    });

    if (validation.valid) {
      // Learn from success
      await learnFromSuccess(input.userRequest, correctedSql);

      // Update learned mappings for terms that mapped to tables in the corrected SQL
      const correctedTables = [...correctedSql.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
        .map((m) => m[1].replace(/[\[\]"]/g, "").toUpperCase());
      for (const table of correctedTables) {
        await upsertLearnedMapping(table.toLowerCase(), table, "success");
      }

      return {
        correctedSql,
        explanation,
        attempts,
        totalAttempts: attempt,
        succeeded: true,
        finalError: null,
        failureClass,
        learnedMappingsUsed: mappingSuggestions,
      };
    }

    // Feed validation errors back as new error for next attempt
    currentSql = correctedSql;
    currentError = `Validation failed on attempt ${attempt}: ${validation.errors.join("; ")}`;

    // Learn from this failure too
    await learnFromFailure(input.userRequest, correctedSql, currentError);
  }

  return {
    correctedSql: null,
    explanation: `Schema-aware retry failed after ${attempts.length} attempt(s)`,
    attempts,
    totalAttempts: attempts.length,
    succeeded: false,
    finalError: `Query correction exhausted ${attempts.length} attempt(s). Last failure: ${currentError}`,
    failureClass,
    learnedMappingsUsed: mappingSuggestions,
  };
}
