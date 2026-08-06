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
  getSimilarHistoricalRepairs,
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
  duplicateRejected?: boolean;
  runtimeError?: string;
  abortReason?: string;
}

export type RuntimeVerificationResult<TExecution> =
  | { ok: true; execution: TExecution }
  | { ok: false; error: string };

export type RuntimeVerifier<TExecution> = (sql: string) => Promise<RuntimeVerificationResult<TExecution>>;

export interface RetryResult<TExecution = never> {
  correctedSql: string | null;
  explanation: string;
  attempts: RetryAttemptResult[];
  totalAttempts: number;
  succeeded: boolean;
  finalError: string | null;
  /** The failure classification of the original error */
  failureClass: FailureClass;
  learnedMappingsUsed: Array<{ term: string; suggestion: string; confidence: number }>;
  verifiedExecution: TExecution | null;
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
    learnedMappingSummary ? `LEARNED MAPPINGS AND PRIOR REPAIRS:\n${learnedMappingSummary}\n` : "",
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

const STRATEGY_LADDERS: Record<FailureClass, [string, string, string]> = {
  TABLE_NOT_FOUND: ["Apply direct schema and learned-mapping substitution", "Use an alternate governed table or join path", "Decompose into a simpler query using only verified tables"],
  COLUMN_NOT_FOUND: ["Apply direct column substitution from schema metadata", "Use an equivalent column from an alternate governed table", "Remove the unsupported projection and simplify the aggregation"],
  JOIN_FAILURE: ["Correct the join keys using registered relationships", "Choose an alternate governed join path", "Decompose the query to avoid the failing join"],
  FILTER_ERROR: ["Correct filter types, parameters, and NULL handling", "Move filtering to an alternate valid column or table", "Simplify filters to the required date window only"],
  TYPE_MISMATCH: ["Apply the precise CAST or CONVERT required by schema types", "Use an alternate type-compatible source column", "Decompose conversions into a guarded CTE"],
  PERMISSION_ERROR: ["Replace inaccessible objects with approved read-only sources", "Use an alternate governed source path", "Simplify to accessible catalog objects only"],
  TIMEOUT: ["Add TOP, date bounds, and selective predicates", "Use a narrower join path with pre-aggregation", "Decompose the query into a minimal bounded aggregate"],
  SYNTAX_ERROR: ["Correct the specific T-SQL syntax error", "Rewrite the affected clause using a different T-SQL construct", "Rebuild as a minimal SELECT with simple CTEs"],
  AGGREGATION_ERROR: ["Correct GROUP BY and aggregate references", "Pre-aggregate in a CTE before joining", "Simplify to one bounded aggregation level"],
  UNKNOWN: ["Apply a direct correction grounded in schema metadata", "Try an alternate governed table and join path", "Rebuild as a minimal read-only query"],
};

export function buildProgressiveRemediationStrategy(
  failureClass: FailureClass,
  attemptNumber: number,
  errorMessage: string,
  learnedMappings: Parameters<typeof buildRemediationStrategy>[2]
): string {
  const base = buildRemediationStrategy(failureClass, errorMessage, learnedMappings);
  const step = STRATEGY_LADDERS[failureClass][Math.min(attemptNumber - 1, 2)];
  return `Attempt ${attemptNumber}: ${step}. ${base}`;
}

function buildRetryUserPrompt(
  input: RetryInput,
  failedSql: string,
  errorMessage: string,
  attemptNumber: number,
  remediationStrategy: string,
  priorHashes: Set<string>,
  priorStrategies: string[]
): string {
  return [
    `Original user request: "${input.userRequest}"`,
    `Date range: ${input.startDate} to ${input.endDate}`,
    input.branchCode ? `Branch filter: ${input.branchCode}` : "",
    `Attempt number: ${attemptNumber}`,
    ``,
    `FAILED SQL:`,
    "```sql",
    failedSql,
    "```",
    ``,
    `LATEST ERROR: ${errorMessage}`,
    ``,
    `Remediation strategy: ${remediationStrategy}`,
    priorStrategies.length > 0 ? `PRIOR STRATEGIES (do not repeat): ${priorStrategies.join(" | ")}` : "",
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

export async function retryWithSchemaIntelligence<TExecution = never>(
  input: RetryInput,
  verifyCandidate?: RuntimeVerifier<TExecution>
): Promise<RetryResult<TExecution>> {
  const attempts: RetryAttemptResult[] = [];
  const failureClass = classifyFailure(input.errorMessage);

  // Fetch prior attempts to build known hash set
  const [priorAttempts, historicalRepairs] = await Promise.all([
    getAttemptsForRequest(input.userRequest),
    getSimilarHistoricalRepairs(input.userRequest, failureClass),
  ]);
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
  const mappingSummary = mappingSuggestions.length > 0
    ? mappingSuggestions.map((s) => `  "${s.term}" → "${s.suggestion}" (confidence: ${(s.confidence * 100).toFixed(0)}%)`).join("\n")
    : allMappings.filter((m) => m.confidence >= 0.7).slice(0, 5).map((m) => `  "${m.user_term}" → "${m.actual_object}" (confidence: ${(m.confidence * 100).toFixed(0)}%)`).join("\n");
  const repairSummary = historicalRepairs.map((repair) => [
    `  Similar request (${(repair.similarity * 100).toFixed(0)}%): ${repair.user_request}`,
    repair.remediation_strategy ? `  Prior strategy: ${repair.remediation_strategy}` : "",
    `  Successful correction: ${repair.corrected_sql}`,
  ].filter(Boolean).join("\n")).join("\n");
  const learnedMappingSummary = [mappingSummary, repairSummary].filter(Boolean).join("\n");

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
  const priorStrategies: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();

    const remediationStrategy = buildProgressiveRemediationStrategy(
      failureClass,
      attempt,
      currentError,
      allMappings
    );
    priorStrategies.push(remediationStrategy);

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
          retryHistory: [
            ...priorAttempts.map((a: QueryHistoryEntry) => ({
              userRequest: a.user_request,
              failureReason: a.failure_reason ?? undefined,
              fixStrategy: a.remediation_strategy ?? undefined,
            })),
            ...historicalRepairs.map((repair) => ({
              userRequest: repair.user_request,
              failureReason: repair.failure_reason ?? undefined,
              fixStrategy: [repair.remediation_strategy, `Successful SQL: ${repair.corrected_sql}`].filter(Boolean).join("; "),
            })),
          ],
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
        prompt: buildRetryUserPrompt(
          input,
          currentSql,
          currentError,
          attempt,
          remediationStrategy,
          triedHashes,
          priorStrategies.slice(0, -1)
        ),
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
    if (triedHashes.has(newHash) || isSqlDuplicate(correctedSql, currentSql)) {
      const duplicateMessage = `Candidate rejected: SQL hash ${newHash} was already tried or unchanged from the latest failed SQL.`;
      attempts.push({
        attemptNumber: attempt,
        correctedSql,
        normalizedHash: newHash,
        explanation: duplicateMessage,
        failureClass,
        remediationStrategy,
        validationErrors: [duplicateMessage],
        elapsed_ms,
        success: false,
        duplicateRejected: true,
      });

      await recordQueryAttempt({
        user_request: input.userRequest,
        query_text: correctedSql,
        status: "retry",
        retry_version: attempt,
        failure_reason: failureClass,
        remediation_strategy: remediationStrategy,
        error_message: duplicateMessage,
        execution_ms: elapsed_ms,
        schema_hash: newHash,
        final_success_query: null,
        learned_mappings_snapshot: null,
      });

      currentError = duplicateMessage;
      continue;
    }

    // Add to tried hashes
    triedHashes.add(newHash);

    // ── Validate corrected SQL ─────────���───────────────────────────────────────
    const validation = validateQuery(correctedSql);
    let verifiedExecution: TExecution | null = null;
    let runtimeError: string | undefined;
    if (validation.valid && verifyCandidate) {
      try {
        const verification = await verifyCandidate(correctedSql);
        if (verification.ok) verifiedExecution = verification.execution;
        else runtimeError = verification.error;
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "QueryGatewayTimeoutError")) throw error;
        runtimeError = error instanceof Error ? error.message : String(error);
      }
    }
    const candidateSucceeded = validation.valid && !runtimeError;
    const candidateErrors = runtimeError ? [`Runtime verification failed: ${runtimeError}`] : validation.errors;

    const attemptResult: RetryAttemptResult = {
      attemptNumber: attempt,
      correctedSql,
      normalizedHash: newHash,
      explanation,
      failureClass,
      remediationStrategy,
      validationErrors: candidateErrors,
      elapsed_ms: Date.now() - t0,
      success: candidateSucceeded,
      runtimeError,
    };

    attempts.push(attemptResult);

    // Record in history store
    await recordQueryAttempt({
      user_request: input.userRequest,
      query_text: correctedSql,
      status: candidateSucceeded ? "success" : "retry",
      retry_version: attempt,
      failure_reason: candidateSucceeded ? null : failureClass,
      remediation_strategy: remediationStrategy,
      error_message: candidateSucceeded ? null : candidateErrors.join("; "),
      execution_ms: Date.now() - t0,
      schema_hash: newHash,
      final_success_query: candidateSucceeded ? correctedSql : null,
      learned_mappings_snapshot: JSON.stringify(
        allMappings.slice(0, 20).reduce((acc, m) => {
          acc[m.user_term] = m.actual_object;
          return acc;
        }, {} as Record<string, string>)
      ),
    });

    if (candidateSucceeded) {
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
        verifiedExecution,
      };
    }

    // Feed the latest static or runtime failure into the next, different strategy.
    currentSql = correctedSql;
    currentError = runtimeError
      ? `Runtime failed on attempt ${attempt}: ${runtimeError}`
      : `Validation failed on attempt ${attempt}: ${validation.errors.join("; ")}`;

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
    verifiedExecution: null,
  };
}
