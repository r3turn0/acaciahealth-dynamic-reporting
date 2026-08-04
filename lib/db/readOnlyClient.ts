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

import { validateReadOnlySql } from "@/lib/services/queryGuard";
import {
  executeQuery,
  executeQueryWithParams,
  executeMultiQuery,
  executeMultiQueryWithParams,
  executeRawQuery,
  executeRawMultiQuery,
  checkConnection,
  isDbConfigured,
  BackendUnreachableError,
  type QueryParams,
  type NamedParam,
  type QueryResultSet,
} from "@/lib/services/db";

// ── Re-export error class so callers don't need two imports ─────────────────
export { BackendUnreachableError };
export type { QueryResultSet };

// ── Query guard ─────────────────────────────────────────────────────────────

export class ReadOnlyViolationError extends Error {
  readonly code = "READ_ONLY_VIOLATION";
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(`ReadOnlyDataClient rejected SQL: ${reasons.join("; ")}. Use a single parameterized SELECT or read-only CTE instead.`);
    this.name = "ReadOnlyViolationError";
    this.reasons = reasons;
  }
}

export function assertReadOnly(sql: string): void {
  const result = validateReadOnlySql(sql);
  if (!result.valid) throw new ReadOnlyViolationError(result.errors);
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

/** Run one read-only command and return every dataset it produces. */
export async function queryMultiple(sql: string, params: QueryParams, signal?: AbortSignal) {
  assertReadOnly(sql);
  return executeMultiQuery(sql, params, signal);
}

/** Run one arbitrary-parameter read-only command and return every dataset. */
export async function queryMultipleWithParams(sql: string, inputs: NamedParam[]) {
  assertReadOnly(sql);
  return executeMultiQueryWithParams(sql, inputs);
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

/** Run a hardcoded read-only introspection batch and consume every dataset. */
export async function introspectMultiple(sql: string) {
  assertReadOnly(sql);
  return executeRawMultiQuery(sql);
}
