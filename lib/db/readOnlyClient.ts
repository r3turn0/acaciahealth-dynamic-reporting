/**
 * ReadOnlyDataClient
 *
 * Wraps the MSSQL connection pool from lib/services/db.ts and enforces that
 * ONLY SELECT statements are executed.  INSERT / UPDATE / DELETE / DROP /
 * ALTER / TRUNCATE / EXEC / EXECUTE are all rejected before they ever reach
 * the wire.
 *
 * This is the ONLY way application code should query the analytics / EMR
 * data warehouse.  Never import lib/services/db.ts directly in a feature that
 * could write.
 */

import {
  executeQuery,
  executeQueryWithParams,
  executeRawQuery,
  checkConnection,
  isDbConfigured,
  BackendUnreachableError,
  type QueryParams,
  type NamedParam,
} from "@/lib/services/db";

// ── Re-export error class so callers don't need two imports ─────────────────
export { BackendUnreachableError };

// ── Query guard ─────────────────────────────────────────────────────────────

const WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC(?:UTE)?|CREATE|GRANT|REVOKE|MERGE)\b/i;

/**
 * Throws ReadOnlyViolationError when the SQL contains a write keyword.
 * Called before every query method.
 */
export class ReadOnlyViolationError extends Error {
  readonly code = "READ_ONLY_VIOLATION";
  constructor(keyword: string) {
    super(
      `ReadOnlyDataClient: "${keyword}" is not allowed. Only SELECT queries may be executed against the analytics data source.`
    );
    this.name = "ReadOnlyViolationError";
  }
}

function assertReadOnly(sql: string): void {
  const match = sql.match(WRITE_PATTERN);
  if (match) throw new ReadOnlyViolationError(match[0].toUpperCase());

  // Must start with SELECT (or WITH for CTEs / subqueries)
  const trimmed = sql.trimStart().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    throw new ReadOnlyViolationError("non-SELECT statement");
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** True when the MSSQL data source credentials are configured. */
export const isConfigured = isDbConfigured;

/** Verify the connection is reachable. */
export const ping = checkConnection;

/**
 * Run a SELECT query with @StartDate / @EndDate parameters.
 * Throws ReadOnlyViolationError if the SQL contains any write operation.
 */
export async function query(
  sql: string,
  params: QueryParams
): Promise<Record<string, unknown>[]> {
  assertReadOnly(sql);
  return executeQuery(sql, params);
}

/**
 * Run a SELECT query with arbitrary named parameters.
 * Throws ReadOnlyViolationError if the SQL contains any write operation.
 */
export async function queryWithParams(
  sql: string,
  inputs: NamedParam[]
): Promise<Record<string, unknown>[]> {
  assertReadOnly(sql);
  return executeQueryWithParams(sql, inputs);
}

/**
 * Run a schema-introspection query (no user params).
 * Only safe, hardcoded SQL should ever be passed here.
 */
export async function introspect(
  sql: string
): Promise<Record<string, unknown>[]> {
  assertReadOnly(sql);
  return executeRawQuery(sql);
}
