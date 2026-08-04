/**
 * lib/services/queryHistoryStore.ts
 *
 * Durable Query History and Learned Mappings Store
 *
 * Implements Phases 8-10 of the Intelligent Database Inference Framework:
 *   Phase 8  — Failure Analysis Engine  (classify, store, analyze failures)
 *   Phase 9  — Historical Retry Intelligence  (normalized SQL hash deduplication)
 *   Phase 10 — Learning Memory  (learned term→table mappings, success rates)
 *
 * Storage strategy:
 *   Primary  → AppDataClient (Postgres when POSTGRES_APP_DB_URL is set)
 *   Fallback → in-process Map store (zero-config dev / demo mode)
 *
 * The schemas precisely match the DDL specified in the framework spec:
 *   query_history   — every attempt, retry version, outcome, remediation
 *   learned_mappings — user_term → actual_object with confidence scoring
 *
 * IMPORTANT: This store is SERVER-SIDE only. Never import from a client component.
 */

import * as appClient from "@/lib/db/appClient";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FailureClass =
  | "TABLE_NOT_FOUND"
  | "COLUMN_NOT_FOUND"
  | "JOIN_FAILURE"
  | "FILTER_ERROR"
  | "TYPE_MISMATCH"
  | "PERMISSION_ERROR"
  | "TIMEOUT"
  | "SYNTAX_ERROR"
  | "AGGREGATION_ERROR"
  | "UNKNOWN";

export type QueryStatus = "success" | "failure" | "retry" | "aborted";

export interface QueryHistoryEntry {
  id: string;
  created_at: string;
  user_request: string;
  query_text: string;
  status: QueryStatus;
  retry_version: number;
  failure_reason: FailureClass | null;
  remediation_strategy: string | null;
  error_message: string | null;
  execution_ms: number;
  schema_hash: string;
  /** Denormalized: the final successful SQL after all retries (null until success) */
  final_success_query: string | null;
  /** Serialized learned_mappings snapshot at time of this attempt */
  learned_mappings_snapshot: string | null;
}

export interface LearnedMapping {
  id: string;
  user_term: string;
  actual_object: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  last_used: string;
}

export interface RetryAttempt {
  retry_version: number;
  query_text: string;
  normalized_hash: string;
  status: QueryStatus;
  failure_reason: FailureClass | null;
  error_message: string | null;
  remediation_strategy: string | null;
  execution_ms: number;
}

export interface QueryRecord {
  user_request: string;
  original_query: string;
  retry_queries: RetryAttempt[];
  errors: string[];
  corrections: string[];
  final_success_query: string | null;
  learned_mappings: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Fingerprinting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic hash fingerprint of the schema for a given SQL.
 * Extracts all table references from the SQL and creates a hash.
 */
export function generateSchemaHash(sql: string): string {
  const tables = [...sql.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
    .map((m) => m[1].toUpperCase().replace(/[\[\]"]/g, ""))
    .sort();
  const raw = tables.join("|") + "|" + sql.length;
  // Simple djb2 hash — no crypto dependency needed
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    hash = hash >>> 0; // Force unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Normalize SQL for duplicate detection:
 *   - collapse whitespace
 *   - lowercase
 *   - strip comments
 *   - normalize aliases (strip AS x patterns)
 *   - remove NOLOCK hints
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")              // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "")      // block comments
    .replace(/\bWITH\s*\(NOLOCK\)/gi, "")  // NOLOCK hints
    .replace(/\bAS\s+\w+\b/gi, "")         // AS alias
    .replace(/\s+/g, " ")                  // collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Generate a hash of normalized SQL for duplicate retry detection.
 */
export function hashSql(sql: string): string {
  const normalized = normalizeSql(sql);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Check if two SQL strings are logically equivalent (same normalized hash).
 */
export function isSqlDuplicate(sqlA: string, sqlB: string): boolean {
  return hashSql(sqlA) === hashSql(sqlB);
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure Classification Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a SQL error message into a FailureClass.
 * Pattern-matched against common MSSQL error message patterns.
 */
export function classifyFailure(errorMessage: string): FailureClass {
  const msg = errorMessage.toLowerCase();

  if (
    /invalid object name|object.*not found|does not exist/.test(msg) &&
    !/column/.test(msg)
  ) return "TABLE_NOT_FOUND";

  if (
    /invalid column name|column.*not found|column.*does not exist|unknown column/.test(msg)
  ) return "COLUMN_NOT_FOUND";

  if (
    /multi-part identifier|the multi-part|ambiguous column|cannot be resolved/.test(msg)
  ) return "JOIN_FAILURE";

  if (
    /conversion failed|cannot convert|implicit conversion|date.*invalid|invalid date/.test(msg)
  ) return "TYPE_MISMATCH";

  if (
    /permission denied|access denied|not authorized|unauthorized/.test(msg)
  ) return "PERMISSION_ERROR";

  if (
    /timeout|query timeout|execution timeout|wait timeout/.test(msg)
  ) return "TIMEOUT";

  if (
    /syntax error|incorrect syntax|unexpected token|parse error/.test(msg)
  ) return "SYNTAX_ERROR";

  if (
    /aggregate|group by|cannot.*aggregate|invalid.*group/.test(msg)
  ) return "AGGREGATION_ERROR";

  if (
    /where.*clause|filter.*invalid|having.*clause/.test(msg)
  ) return "FILTER_ERROR";

  return "UNKNOWN";
}

/**
 * Build a human-readable remediation strategy description for a given failure class.
 */
export function buildRemediationStrategy(
  failureClass: FailureClass,
  errorMessage: string,
  learnedMappings: LearnedMapping[]
): string {
  const strategies: Record<FailureClass, string> = {
    TABLE_NOT_FOUND: "Search aliases and metadata.json for the referenced table; check learned_mappings for synonym resolution",
    COLUMN_NOT_FOUND: "Check column aliases in metadata.json; search sys.columns for the correct column name; check learned_mappings",
    JOIN_FAILURE: "Verify join conditions via schemaConfig.json; check FK paths; ensure RTRIM() on varchar join columns",
    FILTER_ERROR: "Validate WHERE clause data types; ensure @StartDate/@EndDate parameters are present; check NULL handling",
    TYPE_MISMATCH: "Apply CAST/CONVERT to mismatched columns; check date format vs nvarchar/datetime columns",
    PERMISSION_ERROR: "Verify read-only account has SELECT grant on referenced tables; check schema ownership",
    TIMEOUT: "Add TOP clause; add WITH (NOLOCK); add date range filter; consider query decomposition",
    SYNTAX_ERROR: "Fix T-SQL syntax; verify MSSQL-specific syntax (not ANSI SQL); check bracket matching",
    AGGREGATION_ERROR: "Fix GROUP BY to include all non-aggregated SELECT columns; verify COUNT/SUM column references",
    UNKNOWN: "Re-analyze error message; try simplified query; verify table existence via sys.tables",
  };

  // Augment with specific term from error
  const base = strategies[failureClass];

  // Check if any learned mapping could help
  const relevantMappings = learnedMappings.filter((m) =>
    errorMessage.toLowerCase().includes(m.user_term.toLowerCase())
  );
  if (relevantMappings.length > 0) {
    const suggestions = relevantMappings
      .map((m) => `"${m.user_term}" → "${m.actual_object}" (confidence: ${(m.confidence * 100).toFixed(0)}%)`)
      .join("; ");
    return `${base}. Learned mapping suggestions: ${suggestions}`;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Fallback Store
// ─────────────────────────────────────────────────────────────────────────────

const _historyStore: QueryHistoryEntry[] = [];
const _mappingsStore: LearnedMapping[] = [];
const MAX_HISTORY = 5000;
const MAX_MAPPINGS = 2000;

function _genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres Table Setup (auto-creates tables on first use)
// ─────────────────────────────────────────────────────────────────────────────

let _tablesInitialized = false;

async function ensureTables(): Promise<void> {
  if (_tablesInitialized) return;

  const pool = await appClient.getPool();
  if (!pool) {
    _tablesInitialized = true;
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS query_history (
        id                         VARCHAR(64) PRIMARY KEY,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_request               TEXT NOT NULL,
        query_text                 TEXT NOT NULL,
        status                     VARCHAR(20) NOT NULL,
        retry_version              INTEGER NOT NULL DEFAULT 0,
        failure_reason             VARCHAR(64),
        remediation_strategy       TEXT,
        error_message              TEXT,
        execution_ms               BIGINT NOT NULL DEFAULT 0,
        schema_hash                VARCHAR(16),
        final_success_query        TEXT,
        learned_mappings_snapshot  TEXT
      );

      CREATE TABLE IF NOT EXISTS learned_mappings (
        id             VARCHAR(64) PRIMARY KEY,
        user_term      VARCHAR(255) NOT NULL,
        actual_object  VARCHAR(255) NOT NULL,
        confidence     DECIMAL(5,2) NOT NULL DEFAULT 0.5,
        success_count  INTEGER NOT NULL DEFAULT 0,
        failure_count  INTEGER NOT NULL DEFAULT 0,
        last_used      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_term, actual_object)
      );

      CREATE INDEX IF NOT EXISTS idx_query_history_user_request ON query_history (user_request);
      CREATE INDEX IF NOT EXISTS idx_query_history_status ON query_history (status);
      CREATE INDEX IF NOT EXISTS idx_query_history_created_at ON query_history (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learned_mappings_user_term ON learned_mappings (user_term);
    `);
    _tablesInitialized = true;
  } catch (err) {
    // Non-fatal — fall back to in-memory
    console.error("[queryHistoryStore] Table setup failed:", (err as Error).message);
    _tablesInitialized = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query History: CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a query attempt (success, failure, or retry).
 * Returns the persisted entry id.
 */
export async function recordQueryAttempt(
  entry: Omit<QueryHistoryEntry, "id" | "created_at">
): Promise<string> {
  await ensureTables();

  const id = `qh_${_genId()}`;
  const created_at = new Date().toISOString();
  const full: QueryHistoryEntry = { id, created_at, ...entry };

  const pool = await appClient.getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO query_history
           (id, created_at, user_request, query_text, status, retry_version,
            failure_reason, remediation_strategy, error_message, execution_ms,
            schema_hash, final_success_query, learned_mappings_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, created_at, entry.user_request, entry.query_text,
          entry.status, entry.retry_version, entry.failure_reason,
          entry.remediation_strategy, entry.error_message, entry.execution_ms,
          entry.schema_hash, entry.final_success_query,
          entry.learned_mappings_snapshot,
        ]
      );
      return id;
    } catch (err) {
      console.error("[queryHistoryStore] insert query_history failed:", (err as Error).message);
    }
  }

  // In-memory fallback
  _historyStore.push(full);
  if (_historyStore.length > MAX_HISTORY) _historyStore.splice(0, _historyStore.length - MAX_HISTORY);
  return id;
}

/**
 * Mark an existing query history entry as the final success.
 */
export async function markQuerySuccess(
  id: string,
  finalSql: string,
  executionMs: number
): Promise<void> {
  await ensureTables();

  const pool = await appClient.getPool();
  if (pool) {
    try {
      await pool.query(
        `UPDATE query_history
            SET status = 'success', final_success_query = $1, execution_ms = $2
          WHERE id = $3`,
        [finalSql, executionMs, id]
      );
      return;
    } catch (err) {
      console.error("[queryHistoryStore] markQuerySuccess failed:", (err as Error).message);
    }
  }

  const entry = _historyStore.find((e) => e.id === id);
  if (entry) {
    entry.status = "success";
    entry.final_success_query = finalSql;
    entry.execution_ms = executionMs;
  }
}

/**
 * Retrieve query history entries.
 * Supports both simple (limit, status) and paginated (options object) call forms.
 *
 *   getQueryHistory(50)                       — latest 50 entries
 *   getQueryHistory({ limit, offset, status, search })  — paginated + filtered
 */
export async function getQueryHistory(
  limitOrOptions?: number | { limit?: number; offset?: number; status?: QueryStatus; search?: string }
): Promise<QueryHistoryEntry[]> {
  const options: { limit: number; offset: number; status?: QueryStatus; search?: string } =
    typeof limitOrOptions === "number"
      ? { limit: limitOrOptions, offset: 0 }
      : { limit: 50, offset: 0, ...(limitOrOptions ?? {}) };

  const { limit, offset, status, search } = options;

  await ensureTables();

  const pool = await appClient.getPool();
  if (pool) {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      if (status) { conditions.push(`status = $${i++}`); params.push(status); }
      if (search)  { conditions.push(`LOWER(user_request) LIKE $${i++}`); params.push(`%${search.toLowerCase()}%`); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit, offset);
      const sql = `SELECT * FROM query_history ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`;
      const res = await pool.query(sql, params);
      return res.rows as QueryHistoryEntry[];
    } catch (err) {
      console.error("[queryHistoryStore] getQueryHistory failed:", (err as Error).message);
    }
  }

  let results = [..._historyStore].reverse();
  if (status) results = results.filter((e) => e.status === status);
  if (search)  results = results.filter((e) => e.user_request.toLowerCase().includes(search.toLowerCase()));
  return results.slice(offset, offset + limit);
}

/**
 * Retrieve all learned mappings, sorted by confidence descending.
 */
export async function getLearnedMappings(limit = 500): Promise<LearnedMapping[]> {
  await ensureTables();

  const pool = await appClient.getPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT * FROM learned_mappings ORDER BY confidence DESC, success_count DESC LIMIT $1`,
        [limit]
      );
      return res.rows as LearnedMapping[];
    } catch (err) {
      console.error("[queryHistoryStore] getLearnedMappings failed:", (err as Error).message);
    }
  }

  return [..._mappingsStore]
    .sort((a, b) => b.confidence - a.confidence || b.success_count - a.success_count)
    .slice(0, limit);
}

/**
 * Look up the best-confidence learned object for a user term.
 * Returns null if no mapping exists above the confidence threshold.
 */
export async function resolveTerm(
  userTerm: string,
  minConfidence = 0.5
): Promise<string | null> {
  await ensureTables();

  const term = userTerm.toLowerCase().trim();

  const pool = await appClient.getPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT actual_object FROM learned_mappings
          WHERE LOWER(user_term) = $1 AND confidence >= $2
          ORDER BY confidence DESC, success_count DESC
          LIMIT 1`,
        [term, minConfidence]
      );
      return (res.rows[0] as { actual_object: string } | undefined)?.actual_object ?? null;
    } catch (err) {
      console.error("[queryHistoryStore] resolveTerm failed:", (err as Error).message);
    }
  }

  const match = _mappingsStore
    .filter((m) => m.user_term.toLowerCase() === term && m.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return match?.actual_object ?? null;
}

/**
 * Extract user terms from an error message and check learned mappings
 * to suggest alternative table/column names.
 */
export async function suggestMappingsForError(
  errorMessage: string,
  failureClass: FailureClass
): Promise<Array<{ term: string; suggestion: string; confidence: number }>> {
  const mappings = await getLearnedMappings(200);

  // Extract quoted object names from the error (common MSSQL format)
  const quotedTerms = [
    ...errorMessage.matchAll(/'([^']+)'/g),
    ...errorMessage.matchAll(/"([^"]+)"/g),
  ].map((m) => m[1].toLowerCase());

  // Also extract unquoted table/column-like tokens
  const tokenTerms = errorMessage
    .replace(/'[^']*'/g, "")
    .split(/\s+/)
    .filter((t) => /^[a-z_][a-z0-9_]*$/i.test(t) && t.length > 2)
    .map((t) => t.toLowerCase());

  const allTerms = [...new Set([...quotedTerms, ...tokenTerms])];

  const suggestions: Array<{ term: string; suggestion: string; confidence: number }> = [];

  for (const term of allTerms) {
    // Exact match
    const exact = mappings.find((m) => m.user_term.toLowerCase() === term && m.confidence >= 0.5);
    if (exact) {
      suggestions.push({ term, suggestion: exact.actual_object, confidence: exact.confidence });
      continue;
    }

    // Fuzzy substring match
    const fuzzy = mappings.find(
      (m) =>
        (m.user_term.toLowerCase().includes(term) ||
          term.includes(m.user_term.toLowerCase())) &&
        m.confidence >= 0.5
    );
    if (fuzzy) {
      suggestions.push({
        term,
        suggestion: fuzzy.actual_object,
        confidence: fuzzy.confidence * 0.8, // penalize fuzzy match
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/**
 * Extract and auto-learn mappings from a successfully executed SQL query.
 * Identifies table references that appeared in the user's natural language request.
 */
export async function learnFromSuccess(
  userRequest: string,
  successfulSql: string
): Promise<void> {
  // Extract table names from SQL
  const tables = [...successfulSql.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
    .map((m) => m[1].replace(/[\[\]"]/g, "").toUpperCase());

  const reqLower = userRequest.toLowerCase();
  const tokens = reqLower.split(/\W+/).filter((t) => t.length > 2);

  for (const table of tables) {
    const tableLower = table.toLowerCase().replace("_", " ");
    // Check if any token in the user request resembles this table name
    for (const token of tokens) {
      if (
        tableLower.includes(token) ||
        token.includes(tableLower.split("_")[0]) ||
        table.toLowerCase().includes(token)
      ) {
        await upsertLearnedMapping(token, table, "success");
        break;
      }
    }
  }
}

/**
 * Learn from a failure by recording the term→error association.
 * Used to build negative knowledge (what NOT to try for a given term).
 */
export async function learnFromFailure(
  userRequest: string,
  failedSql: string,
  errorMessage: string
): Promise<void> {
  // Extract what was tried from the failed SQL
  const tables = [...failedSql.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
    .map((m) => m[1].replace(/[\[\]"]/g, "").toUpperCase());

  const reqLower = userRequest.toLowerCase();
  const tokens = reqLower.split(/\W+/).filter((t) => t.length > 2);

  for (const table of tables) {
    for (const token of tokens) {
      if (
        table.toLowerCase().includes(token) ||
        token.includes(table.toLowerCase().replace("_", ""))
      ) {
        await upsertLearnedMapping(token, table, "failure");
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Plan Output (required output structure from spec)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryPlanOutput {
  query_plan: {
    intent: string;
    candidate_tables: string[];
    candidate_columns: string[];
    join_strategy: string[];
    filters: string[];
    aggregations: string[];
    confidence: number;
  };
  executed_sql: string;
  validation_results: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  retry_history: RetryAttempt[];
  reasoning_summary: string;
  learned_schema_mappings: Record<string, string>;
}

/**
 * Build the standard required output structure from a completed query operation.
 */
export async function buildQueryPlanOutput(params: {
  intent: string;
  candidateTables: string[];
  candidateColumns: string[];
  joinStrategy: string[];
  filters: string[];
  aggregations: string[];
  confidence: number;
  executedSql: string;
  validationErrors: string[];
  validationWarnings: string[];
  retryAttempts: RetryAttempt[];
  reasoningSummary: string;
}): Promise<QueryPlanOutput> {
  const mappings = await getLearnedMappings(50);
  const learnedSchemaMap: Record<string, string> = {};
  for (const m of mappings) {
    if (m.confidence >= 0.6) {
      learnedSchemaMap[m.user_term] = m.actual_object;
    }
  }

  return {
    query_plan: {
      intent: params.intent,
      candidate_tables: params.candidateTables,
      candidate_columns: params.candidateColumns,
      join_strategy: params.joinStrategy,
      filters: params.filters,
      aggregations: params.aggregations,
      confidence: params.confidence,
    },
    executed_sql: params.executedSql,
    validation_results: {
      valid: params.validationErrors.length === 0,
      errors: params.validationErrors,
      warnings: params.validationWarnings,
    },
    retry_history: params.retryAttempts,
    reasoning_summary: params.reasoningSummary,
    learned_schema_mappings: learnedSchemaMap,
  };
}

// ─────────────────────────────────────────────────────────────��───────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryHistoryStats {
  total_attempts: number;
  success_count: number;
  failure_count: number;
  retry_count: number;
  avg_execution_ms: number;
  failure_breakdown: Record<FailureClass, number>;
  top_learned_mappings: Array<{ user_term: string; actual_object: string; confidence: number }>;
  success_rate: number;
}

export async function getQueryStats(): Promise<QueryHistoryStats> {
  const pool = await appClient.getPool();

  if (pool) {
    try {
      const histRes = await pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failures,
          SUM(CASE WHEN status = 'retry'   THEN 1 ELSE 0 END) AS retries,
          AVG(execution_ms) AS avg_ms,
          failure_reason,
          COUNT(*) AS cnt
        FROM query_history
        GROUP BY failure_reason
      `);

      const mappRes = await pool.query(`
        SELECT user_term, actual_object, confidence
          FROM learned_mappings
         ORDER BY confidence DESC, success_count DESC
         LIMIT 10
      `);

      let total = 0, successes = 0, failures = 0, retries = 0, avg_ms = 0;
      const breakdown: Record<string, number> = {};
      for (const row of histRes.rows as Record<string, unknown>[]) {
        total += Number(row.cnt ?? row.total ?? 0);
        successes += Number(row.successes ?? 0);
        failures += Number(row.failures ?? 0);
        retries += Number(row.retries ?? 0);
        avg_ms = Number(row.avg_ms ?? 0);
        if (row.failure_reason) {
          breakdown[row.failure_reason as string] = (breakdown[row.failure_reason as string] ?? 0) + Number(row.cnt ?? 1);
        }
      }

      return {
        total_attempts: total,
        success_count: successes,
        failure_count: failures,
        retry_count: retries,
        avg_execution_ms: Math.round(avg_ms),
        failure_breakdown: breakdown as Record<FailureClass, number>,
        top_learned_mappings: mappRes.rows as Array<{ user_term: string; actual_object: string; confidence: number }>,
        success_rate: total > 0 ? successes / total : 0,
      };
    } catch (err) {
      console.error("[queryHistoryStore] getQueryStats failed:", (err as Error).message);
    }
  }

  // In-memory fallback
  const breakdown: Record<string, number> = {};
  for (const e of _historyStore) {
    if (e.failure_reason) {
      breakdown[e.failure_reason] = (breakdown[e.failure_reason] ?? 0) + 1;
    }
  }
  const successes = _historyStore.filter((e) => e.status === "success").length;
  const failures  = _historyStore.filter((e) => e.status === "failure").length;
  const retries   = _historyStore.filter((e) => e.status === "retry").length;
  const avg_ms    = _historyStore.length > 0
    ? _historyStore.reduce((s, e) => s + e.execution_ms, 0) / _historyStore.length
    : 0;

  const topMappings = [..._mappingsStore]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((m) => ({ user_term: m.user_term, actual_object: m.actual_object, confidence: m.confidence }));

  return {
    total_attempts: _historyStore.length,
    success_count: successes,
    failure_count: failures,
    retry_count: retries,
    avg_execution_ms: Math.round(avg_ms),
    failure_breakdown: breakdown as Record<FailureClass, number>,
    top_learned_mappings: topMappings,
    success_rate: _historyStore.length > 0 ? successes / _historyStore.length : 0,
  };
}

/** Alias used by API routes. */
export const getQueryHistoryStats = getQueryStats;

export interface QueryMemory {
  id: string;
  normalized_request: string;
  semantic_keywords: string[];
  source_tables: string[];
  versions: Array<{
    version: number;
    sql: string;
    status: QueryStatus;
    failure_reason: FailureClass | null;
    remediation_strategy: string | null;
    execution_ms: number;
    created_at: string;
  }>;
  final_success_query: string | null;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_execution_ms: number;
  last_used_at: string;
}

function normalizeRequest(request: string): string {
  return request.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function requestKeywords(request: string): string[] {
  const stop = new Set(["a", "an", "and", "by", "for", "from", "in", "of", "on", "show", "the", "to", "with"]);
  return [...new Set(normalizeRequest(request).split(" ").filter((token) => token.length > 1 && !stop.has(token)))];
}

export async function getRecentQueryHistory(limit = 500): Promise<QueryHistoryEntry[]> {
  await ensureTables();
  const pool = await appClient.getPool();
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT * FROM query_history ORDER BY created_at DESC LIMIT $1`,
        [Math.max(1, Math.min(limit, 2_000))]
      );
      return result.rows as QueryHistoryEntry[];
    } catch (error) {
      console.error("[queryHistoryStore] getRecentQueryHistory failed:", (error as Error).message);
    }
  }
  return [..._historyStore]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/** Aggregate immutable attempts into explainable, versioned query memories. */
export async function getQueryMemories(limit = 500): Promise<QueryMemory[]> {
  const entries = await getRecentQueryHistory(limit);
  const groups = new Map<string, QueryHistoryEntry[]>();
  for (const entry of entries) {
    const key = normalizeRequest(entry.user_request);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.entries()].map(([normalized_request, attempts]) => {
    const ordered = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const successes = ordered.filter((entry) => entry.status === "success" || Boolean(entry.final_success_query));
    const failures = ordered.filter((entry) => entry.status === "failure");
    const successfulSql = [...ordered].reverse().find((entry) => entry.final_success_query)?.final_success_query
      ?? [...ordered].reverse().find((entry) => entry.status === "success")?.query_text
      ?? null;
    const sourceTables = [...new Set(ordered.flatMap((entry) =>
      [...entry.query_text.matchAll(/(?:FROM|JOIN)\s+([\w.[\]"]+)/gi)]
        .map((match) => match[1].replace(/[\[\]"]/g, "").toUpperCase())
    ))];
    const executionSamples = ordered.filter((entry) => entry.execution_ms > 0);

    return {
      id: `memory_${hashSql(normalized_request)}`,
      normalized_request,
      semantic_keywords: requestKeywords(normalized_request),
      source_tables: sourceTables,
      versions: ordered.map((entry, index) => ({
        version: index + 1,
        sql: entry.query_text,
        status: entry.status,
        failure_reason: entry.failure_reason,
        remediation_strategy: entry.remediation_strategy,
        execution_ms: entry.execution_ms,
        created_at: entry.created_at,
      })),
      final_success_query: successfulSql,
      success_count: successes.length,
      failure_count: failures.length,
      success_rate: ordered.length > 0 ? successes.length / ordered.length : 0,
      avg_execution_ms: executionSamples.length > 0
        ? Math.round(executionSamples.reduce((sum, entry) => sum + entry.execution_ms, 0) / executionSamples.length)
        : 0,
      last_used_at: ordered.at(-1)?.created_at ?? new Date(0).toISOString(),
    };
  });
}

export interface HistoricalRepair {
  user_request: string;
  failed_sql: string;
  corrected_sql: string;
  failure_reason: FailureClass | null;
  remediation_strategy: string | null;
  similarity: number;
}

function keywordSimilarity(left: string, right: string): number {
  const a = new Set(requestKeywords(left));
  const b = new Set(requestKeywords(right));
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

/** Find successful historical corrections for semantically similar failures. */
export async function getSimilarHistoricalRepairs(
  userRequest: string,
  failureReason: FailureClass,
  limit = 3
): Promise<HistoricalRepair[]> {
  const entries = await getRecentQueryHistory(1_000);
  const successful = entries.filter((entry) => entry.final_success_query && entry.status === "success");
  return successful.map((success) => {
    const failed = entries.find((entry) =>
      entry.user_request === success.user_request
      && entry.status === "failure"
      && (!entry.failure_reason || entry.failure_reason === failureReason)
    );
    return {
      user_request: success.user_request,
      failed_sql: failed?.query_text ?? "",
      corrected_sql: success.final_success_query as string,
      failure_reason: failed?.failure_reason ?? failureReason,
      remediation_strategy: success.remediation_strategy ?? failed?.remediation_strategy ?? null,
      similarity: keywordSimilarity(userRequest, success.user_request),
    };
  })
    .filter((repair) => repair.similarity >= 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

/**
 * Retrieve all prior query attempts for a given user request string.
 * Used by SchemaAwareRetryAgent to build the tried-hashes set.
 */
export async function getAttemptsForRequest(userRequest: string): Promise<QueryHistoryEntry[]> {
  await ensureTables();
  const pool = await appClient.getPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT * FROM query_history WHERE LOWER(user_request) = $1 ORDER BY created_at DESC`,
        [userRequest.toLowerCase()]
      );
      return res.rows as QueryHistoryEntry[];
    } catch (err) {
      console.error("[queryHistoryStore] getAttemptsForRequest failed:", (err as Error).message);
    }
  }
  return _historyStore.filter((e) => e.user_request.toLowerCase() === userRequest.toLowerCase());
}

/**
 * Record or update a learned term → object mapping.
 *
 * Call forms:
 *   upsertLearnedMapping(term, object, "success"|"failure")
 *   upsertLearnedMapping(term, object, confidence, "success"|"failure")
 */
export async function upsertLearnedMapping(
  userTerm: string,
  actualObject: string,
  outcomeOrConfidence: "success" | "failure" | number,
  explicitOutcome?: "success" | "failure"
): Promise<LearnedMapping> {
  const outcome: "success" | "failure" =
    typeof outcomeOrConfidence === "string" ? outcomeOrConfidence : (explicitOutcome ?? "success");

  await ensureTables();
  const pool = await appClient.getPool();

  if (pool) {
    try {
      const res = await pool.query(
        `SELECT * FROM learned_mappings WHERE LOWER(user_term) = $1 AND LOWER(actual_object) = $2`,
        [userTerm.toLowerCase(), actualObject.toLowerCase()]
      );
      const existing = res.rows[0] as LearnedMapping | undefined;

      if (existing) {
        const successCount  = outcome === "success" ? (existing.success_count ?? 0) + 1 : (existing.success_count ?? 0);
        const failureCount  = outcome === "failure" ? (existing.failure_count ?? 0) + 1 : (existing.failure_count ?? 0);
        const total         = successCount + failureCount;
        const newConfidence = total > 0 ? parseFloat((successCount / total).toFixed(4)) : existing.confidence;

        const updated = await pool.query(
          `UPDATE learned_mappings
           SET success_count = $1, failure_count = $2, confidence = $3, last_used = NOW()
           WHERE LOWER(user_term) = $4 AND LOWER(actual_object) = $5
           RETURNING *`,
          [successCount, failureCount, newConfidence, userTerm.toLowerCase(), actualObject.toLowerCase()]
        );
        return updated.rows[0] as LearnedMapping;
      } else {
        const confidence = outcome === "success" ? 0.7 : 0.3;
        const inserted = await pool.query(
          `INSERT INTO learned_mappings (user_term, actual_object, confidence, success_count, failure_count, last_used)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [userTerm, actualObject, confidence, outcome === "success" ? 1 : 0, outcome === "failure" ? 1 : 0]
        );
        return inserted.rows[0] as LearnedMapping;
      }
    } catch (err) {
      console.error("[queryHistoryStore] upsertLearnedMapping failed:", (err as Error).message);
    }
  }

  // In-memory fallback
  const existing = _mappingsStore.find(
    (m) => m.user_term.toLowerCase() === userTerm.toLowerCase() && m.actual_object.toLowerCase() === actualObject.toLowerCase()
  );
  if (existing) {
    if (outcome === "success") existing.success_count = (existing.success_count ?? 0) + 1;
    else existing.failure_count = (existing.failure_count ?? 0) + 1;
    const total = (existing.success_count ?? 0) + (existing.failure_count ?? 0);
    existing.confidence = total > 0 ? (existing.success_count ?? 0) / total : existing.confidence;
    existing.last_used  = new Date().toISOString();
    return existing;
  }
  const newMapping: LearnedMapping = {
    id: `lm_${Date.now()}`,
    user_term: userTerm,
    actual_object: actualObject,
    confidence: outcome === "success" ? 0.7 : 0.3,
    success_count: outcome === "success" ? 1 : 0,
    failure_count: outcome === "failure" ? 1 : 0,
    last_used: new Date().toISOString(),
  };
  _mappingsStore.push(newMapping);
  return newMapping;
}

/**
 * Delete a learned mapping by user_term.
 */
export async function deleteLearnedMapping(userTerm: string): Promise<void> {
  await ensureTables();
  const pool = await appClient.getPool();
  if (pool) {
    try {
      await pool.query(`DELETE FROM learned_mappings WHERE LOWER(user_term) = $1`, [userTerm.toLowerCase()]);
      return;
    } catch (err) {
      console.error("[queryHistoryStore] deleteLearnedMapping failed:", (err as Error).message);
    }
  }
  const idx = _mappingsStore.findIndex((m) => m.user_term.toLowerCase() === userTerm.toLowerCase());
  if (idx >= 0) _mappingsStore.splice(idx, 1);
}
