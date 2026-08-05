/**
 * /lib/services/db.ts
 *
 * Server-side data access — DIRECT connection to SQL Server via the `mssql`
 * (tedious) driver.
 *
 *   Browser → Next.js (Vercel API Routes ONLY) → SQL Server (via connection string)
 *
 * Credentials live only in server-side env vars and never reach the browser.
 * All queries are parameterized — user input is bound, never interpolated.
 *
 * Configuration (server-side env vars, in precedence order):
 *   1. DATABASE_URL           mssql://user:pass@host:port/database  (ignored if placeholder)
 *   2. DB_HOST / DB_NAME / DB_USER / DB_PASS  (+ optional DB_PORT, default 1433)
 *   3. SQL_CONNECTION_STRING  raw ADO-style connection string
 *
 *   DB_ENCRYPT="false"      disable TLS (default: enabled)
 *   DB_TRUST_CERT="false"   enforce strict cert validation (default: trust self-signed)
 */

import sql from "mssql";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryParams {
  StartDate: string;
  EndDate: string;
  BranchCode?: string;
}

/** A single named bind parameter. `type` is an optional SQL type hint
 *  (e.g. "date", "nvarchar", "int") used to bind the value precisely. */
export interface NamedParam {
  name: string;
  value: unknown;
  type?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
// Hard ceiling: if the entire connect-with-retry sequence hasn't resolved in
// this many ms, abort and throw BackendUnreachableError immediately.
const CONNECT_TIMEOUT_MS = 5_000;
// Avoid making every tab wait through the same failed network handshake when a
// local/private SQL Server cannot be reached from the preview environment.
const FAILURE_COOLDOWN_MS = 30_000;

// Connection error codes that are safe to retry (transient network/handshake).
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ESOCKET",
  "ECONNCLOSED",
  "ENOTOPEN",
  "ELOGIN",
]);

// ── Errors ────────────────────────────────────────────────────────────────────

/** Thrown when the database cannot be reached at all (DNS failure, refused,
 *  timeout). Kept named `BackendUnreachableError` for existing import compatibility. */
export class BackendUnreachableError extends Error {
  readonly code = "BACKEND_UNREACHABLE";
  constructor(message: string) {
    super(message);
    this.name = "BackendUnreachableError";
  }
}

// ── Pool singleton (survives Next.js hot-reload) ────────────────────────────────

const globalForDb = globalThis as unknown as {
  __mssql_pool?: sql.ConnectionPool;
  __mssql_connecting?: Promise<sql.ConnectionPool>;
  __mssql_unavailableUntil?: number;
  __mssql_lastError?: string;
};

// ── Config ──────────────────────────────────────────────────────────────────────

const PLACEHOLDER_HOSTS = new Set(["host", "hostname", "your-host", "example.com", "changeme", ""]);
const PLACEHOLDER_DBS = new Set(["db", "database", "your-database", "changeme", ""]);

/** Parse a possibly-corrupted DB_PORT. Falls back to 1433 for junk values. */
function resolvePort(): number {
  const raw = process.env.DB_PORT;
  if (!raw) return 1433;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    console.warn(`[db] Ignoring invalid DB_PORT ("${raw.slice(0, 12)}…"), defaulting to 1433`);
    return 1433;
  }
  return n;
}

function commonOptions() {
  return {
    encrypt: process.env.DB_ENCRYPT !== "false",
    // On-prem SQL Servers commonly use a self-signed cert. Trust by default;
    // set DB_TRUST_CERT="false" to enforce strict validation.
    trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
    enableArithAbort: true,
  };
}

function poolSettings() {
  return { max: 10, min: 0, idleTimeoutMillis: 30_000 };
}

/** Build an mssql config from env, or return null if nothing usable is set. */
function buildConfig(): sql.config | string | null {
  // 1. DATABASE_URL (unless it's an unfilled placeholder)
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      const host = url.hostname.toLowerCase();
      const dbName = url.pathname.replace(/^\//, "");
      if (!PLACEHOLDER_HOSTS.has(host) && !PLACEHOLDER_DBS.has(dbName.toLowerCase())) {
        return {
          server: url.hostname,
          port: url.port ? parseInt(url.port, 10) : 1433,
          database: dbName,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          options: {
            ...commonOptions(),
            trustServerCertificate:
              url.searchParams.get("trustServerCertificate") === "true" ||
              process.env.DB_TRUST_CERT !== "false",
          },
          pool: poolSettings(),
          requestTimeout: 30_000,
          connectionTimeout: CONNECT_TIMEOUT_MS,
        };
      }
      console.warn(
        `[db] Ignoring DATABASE_URL placeholder (host="${url.hostname}", db="${dbName}"). Using DB_* vars.`
      );
    } catch (e) {
      console.error("[db] Failed to parse DATABASE_URL:", (e as Error).message);
    }
  }

  // 2. Individual DB_* vars
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  if (host && database && user && password) {
    return {
      server: host,
      port: resolvePort(),
      database,
      user,
      password,
      options: { ...commonOptions() },
      pool: poolSettings(),
      requestTimeout: 30_000,
      connectionTimeout: CONNECT_TIMEOUT_MS,
    };
  }

  // 3. Raw connection string
  if (process.env.SQL_CONNECTION_STRING) {
    return process.env.SQL_CONNECTION_STRING;
  }

  return null;
}

/** True when database credentials are configured. */
export function isDbConfigured(): boolean {
  return buildConfig() !== null;
}

// ── Connection with retry ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(attempt = 1): Promise<sql.ConnectionPool> {
  const config = buildConfig();
  if (!config) {
    throw new BackendUnreachableError(
      "Database is not configured. Set DB_HOST/DB_NAME/DB_USER/DB_PASS (or DATABASE_URL)."
    );
  }
  const pool = new sql.ConnectionPool(config as sql.config);
  pool.on("error", (err) => {
    if (globalForDb.__mssql_pool === pool) {
      globalForDb.__mssql_pool = undefined;
      globalForDb.__mssql_unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
      globalForDb.__mssql_lastError = err.message;
      console.error("[db] Active pool became unavailable:", err.message);
    }
  });
  try {
    await pool.connect();
    return pool;
  } catch (err) {
    await pool.close().catch(() => undefined);
    const code = (err as { code?: string }).code ?? "";
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    const retryable = RETRYABLE_CODES.has(code) || message.includes("timed out") || message.includes("timeout");
    if (retryable && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[db] Connection attempt ${attempt}/${MAX_RETRIES} failed; retrying in ${delay}ms.`);
      await sleep(delay);
      return connectWithRetry(attempt + 1);
    }
    throw err;
  }
}

/** Get (or lazily create) the shared connection pool. */
async function getPool(): Promise<sql.ConnectionPool> {
  const existing = globalForDb.__mssql_pool;
  if (existing?.connected) return existing;

  const unavailableUntil = globalForDb.__mssql_unavailableUntil ?? 0;
  if (Date.now() < unavailableUntil) {
    throw new BackendUnreachableError(
      globalForDb.__mssql_lastError ?? "SQL Server is temporarily unreachable."
    );
  }

  // Coalesce concurrent connection attempts. The driver owns the timeout so
  // there is no abandoned connect promise that can emit a late pool error.
  if (!globalForDb.__mssql_connecting) {
    globalForDb.__mssql_connecting = connectWithRetry()
      .then((pool) => {
        globalForDb.__mssql_pool = pool;
        globalForDb.__mssql_unavailableUntil = undefined;
        globalForDb.__mssql_lastError = undefined;
        return pool;
      })
      .catch((err) => {
        globalForDb.__mssql_pool = undefined;
        const code = (err as { code?: string }).code ?? "";
        const message = err instanceof Error ? err.message : "SQL Server is unreachable.";
        globalForDb.__mssql_unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
        globalForDb.__mssql_lastError = message;
        // DNS/refused/timeout → surface a clear "unreachable" error.
        if (
          err instanceof BackendUnreachableError ||
          ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET"].includes(code)
        ) {
          throw err instanceof BackendUnreachableError
            ? err
            : new BackendUnreachableError(
                `Cannot reach SQL Server (${code}). Verify the host is correct and reachable from where the app runs.`
              );
        }
        throw err;
      })
      .finally(() => {
        // Always clear the in-flight promise so subsequent requests don't
        // wait on a permanently-failed connection attempt.
        globalForDb.__mssql_connecting = undefined;
      });
  }
  return globalForDb.__mssql_connecting;
}

// ── Parameter binding ─────────────────────────────────────────────────────────

function bindParam(request: sql.Request, p: NamedParam): void {
  const t = (p.type ?? "").toLowerCase();
  switch (t) {
    case "date":
    case "datetime": {
      const d = p.value instanceof Date ? p.value : new Date(String(p.value));
      request.input(p.name, sql.DateTime2, isNaN(d.getTime()) ? null : d);
      break;
    }
    case "int":
    case "integer":
      request.input(p.name, sql.Int, p.value == null ? null : Number(p.value));
      break;
    case "float":
    case "decimal":
    case "money":
      request.input(p.name, sql.Float, p.value == null ? null : Number(p.value));
      break;
    case "bit":
    case "boolean":
      request.input(p.name, sql.Bit, p.value == null ? null : Boolean(p.value));
      break;
    case "nvarchar":
    case "varchar":
    case "string":
      request.input(p.name, sql.NVarChar, p.value == null ? null : String(p.value));
      break;
    default:
      // Let mssql infer the type from the JS value.
      request.input(p.name, p.value as never);
  }
}

// ── Core query runner ─────────────────────────────────────────────────────────

export interface QueryResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface MultiQueryResult {
  /** Result Set 1, retained for backward-compatible consumers. */
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** Every result set returned by the single SQL command. */
  resultSets: QueryResultSet[];
}

async function runMultiQuery(
  sqlText: string,
  params: NamedParam[],
  signal?: AbortSignal,
): Promise<MultiQueryResult> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const pool = await getPool();
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const request = pool.request();
  request.multiple = true;
  for (const p of params) bindParam(request, p);
  const cancel = () => request.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  let result;
  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    result = await request.query(sqlText);
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  const recordsets = (result.recordsets ?? []) as Record<string, unknown>[][];
  const resultSets = recordsets.map((rows) => ({
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
    rowCount: rows.length,
  }));
  const first = resultSets[0] ?? { columns: [], rows: [], rowCount: 0 };
  return { ...first, resultSets };
}

async function runQuery(
  sqlText: string,
  params: NamedParam[]
): Promise<Record<string, unknown>[]> {
  return (await runMultiQuery(sqlText, params)).rows;
}

// ── Public API (unchanged signatures for existing callers) ──────────────────────

/**
 * Execute a parameterized query. @StartDate and @EndDate are always bound.
 * @BranchCode is bound only when provided — never interpolated into the string.
 */
export async function executeQuery(
  query: string,
  params: QueryParams
): Promise<Record<string, unknown>[]> {
  const named: NamedParam[] = [
    { name: "StartDate", value: params.StartDate, type: "date" },
    { name: "EndDate", value: params.EndDate, type: "date" },
  ];
  if (params.BranchCode !== undefined) {
    named.push({ name: "BranchCode", value: params.BranchCode, type: "nvarchar" });
  }
  return runQuery(query, named);
}

/**
 * Execute a query with arbitrary named parameters beyond the standard date range.
 * All values are bound — never interpolated into the SQL string.
 */
export async function executeQueryWithParams(
  query: string,
  inputs: NamedParam[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return (await runMultiQuery(query, inputs, signal)).rows;
}

/** Execute one parameterized SQL command and consume every returned result set. */
export async function executeMultiQueryWithParams(
  query: string,
  inputs: NamedParam[],
  signal?: AbortSignal,
): Promise<MultiQueryResult> {
  return runMultiQuery(query, inputs, signal);
}

/** Execute one standard date-range command and consume every result set. */
export async function executeMultiQuery(
  query: string,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<MultiQueryResult> {
  const named: NamedParam[] = [
    { name: "StartDate", value: params.StartDate, type: "date" },
    { name: "EndDate", value: params.EndDate, type: "date" },
  ];
  if (params.BranchCode !== undefined) {
    named.push({ name: "BranchCode", value: params.BranchCode, type: "nvarchar" });
  }
  return runMultiQuery(query, named, signal);
}

/**
 * Execute an introspection-only query with no user parameters.
 * NEVER pass user-supplied input to this function.
 */
export async function executeRawQuery(
  query: string
): Promise<Record<string, unknown>[]> {
  return runQuery(query, []);
}

/** Introspection-only multi-result execution. Never pass user input. */
export async function executeRawMultiQuery(query: string): Promise<MultiQueryResult> {
  return runMultiQuery(query, []);
}

/**
 * Health check — returns true if a connection to SQL Server succeeds.
 */
export async function checkConnection(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok");
    return true;
  } catch (err) {
    const pool = globalForDb.__mssql_pool;
    globalForDb.__mssql_pool = undefined;
    if (pool) await pool.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : "SQL Server is unreachable.";
    const alreadyCoolingDown = Date.now() < (globalForDb.__mssql_unavailableUntil ?? 0);
    globalForDb.__mssql_unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
    globalForDb.__mssql_lastError = message;
    if (!alreadyCoolingDown) console.warn(`[db] Database unavailable; pausing health probes for ${FAILURE_COOLDOWN_MS / 1000}s.`);
    return false;
  }
}
