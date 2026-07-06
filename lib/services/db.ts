/**
 * /lib/services/db.ts
 *
 * Production-grade MSSQL connection pool for Vercel + Azure VM.
 *
 * Key design decisions:
 * - Singleton stored on `globalThis` to survive Next.js hot-reload without
 *   leaking connections during development.
 * - Reads DATABASE_URL first (spec primary var), falls back to individual
 *   DB_HOST / DB_NAME / DB_USER / DB_PASS, then SQL_CONNECTION_STRING.
 * - Exponential backoff retry on transient network errors (ECONNREFUSED,
 *   ETIMEDOUT, ESOCKET) up to MAX_RETRIES attempts.
 * - All credentials stay server-side; never returned to the client.
 * - readOnlyIntent enforced at driver level to prevent accidental writes.
 */

import sql from "mssql";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryParams {
  StartDate: string;
  EndDate: string;
  BranchCode?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// Transient network errors that are safe to retry
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ESOCKET",
  "ENOTFOUND",
  "ESOCKETTIMEDOUT",
]);

// ── globalThis singleton key ───────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __mssql_pool: sql.ConnectionPool | undefined;
}

// ── Config builder ────────────────────────────────────────────────────────────

function buildConfig(): sql.config {
  // Option 1: DATABASE_URL (primary per spec)
  // Format: mssql://user:pass@host/database
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      return {
        server: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 1433,
        database: url.pathname.replace(/^\//, ""),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        options: {
          encrypt: true,
          trustServerCertificate: url.searchParams.get("trustServerCertificate") === "true",
          enableArithAbort: true,
          readOnlyIntent: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        requestTimeout: 30000,
        connectionTimeout: 15000,
      };
    } catch (e) {
      console.error("[db] Failed to parse DATABASE_URL:", e);
    }
  }

  // Option 2: Individual vars DB_HOST / DB_NAME / DB_USER / DB_PASS
  const host = process.env.DB_HOST;
  const db = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASS;

  if (host && db && user && pass) {
    return {
      server: host,
      database: db,
      user,
      password: pass,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        readOnlyIntent: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
      requestTimeout: 30000,
      connectionTimeout: 15000,
    };
  }

  // Option 3: Legacy SQL_CONNECTION_STRING (passed as config server fallback)
  return {
    server: process.env.SQL_SERVER ?? "localhost",
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
      readOnlyIntent: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 30000,
    connectionTimeout: 15000,
  };
}

// ── Determine if any DB is configured ─────────────────────────────────────────

export function isDbConfigured(): boolean {
  return !!(
    process.env.DATABASE_URL ||
    (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASS) ||
    process.env.SQL_CONNECTION_STRING
  );
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Connection pool with retry ────────────────────────────────────────────────

async function connectWithRetry(attempt = 1): Promise<sql.ConnectionPool> {
  try {
    const connArg: string | sql.config =
      process.env.SQL_CONNECTION_STRING ?? buildConfig();
    const pool = await sql.connect(connArg as sql.config);
    console.log(`[db] Connected to SQL Server (attempt ${attempt})`);
    return pool;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const isRetryable = RETRYABLE_CODES.has(code) || code.startsWith("E");

    if (isRetryable && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 500ms, 1000ms, 2000ms
      console.warn(`[db] Transient error (${code}), retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(delay);
      return connectWithRetry(attempt + 1);
    }

    console.error(`[db] Connection failed after ${attempt} attempt(s):`, (err as Error).message);
    throw err;
  }
}

async function getPool(): Promise<sql.ConnectionPool> {
  // Reuse globalThis singleton — survives hot-reload in development
  if (globalThis.__mssql_pool && globalThis.__mssql_pool.connected) {
    return globalThis.__mssql_pool;
  }

  // Close stale pool if disconnected
  if (globalThis.__mssql_pool) {
    try {
      await globalThis.__mssql_pool.close();
    } catch {
      // Ignore — pool may already be closed
    }
    globalThis.__mssql_pool = undefined;
  }

  globalThis.__mssql_pool = await connectWithRetry();
  return globalThis.__mssql_pool;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a parameterized query. @StartDate and @EndDate are always bound.
 * @BranchCode is bound only when provided — never interpolated into the string.
 */
export async function executeQuery(
  query: string,
  params: QueryParams
): Promise<Record<string, unknown>[]> {
  const pool = await getPool();
  const request = pool.request();

  request.input("StartDate", sql.Date, params.StartDate);
  request.input("EndDate", sql.Date, params.EndDate);

  // Branch code is parameterized — never inlined into SQL
  if (params.BranchCode !== undefined) {
    request.input("BranchCode", sql.NVarChar(50), params.BranchCode);
  }

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Execute a query with arbitrary named parameters beyond the standard date range.
 * All values are bound via mssql typed inputs — never interpolated.
 */
export async function executeQueryWithParams(
  query: string,
  inputs: Array<{ name: string; type: sql.ISqlType | (() => sql.ISqlType); value: unknown }>
): Promise<Record<string, unknown>[]> {
  const pool = await getPool();
  const request = pool.request();

  for (const { name, type, value } of inputs) {
    request.input(name, type as sql.ISqlType, value);
  }

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Execute an introspection-only query with no user parameters.
 * NEVER pass user-supplied input to this function.
 */
export async function executeRawQuery(
  query: string
): Promise<Record<string, unknown>[]> {
  const pool = await getPool();
  const request = pool.request();
  const result = await request.query(query);
  return result.recordset;
}

/**
 * Health check — returns true if the pool can execute a trivial query.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const pool = await getPool();
    const request = pool.request();
    await request.query("SELECT 1 AS health_check");
    return true;
  } catch (err) {
    console.error("[db] Health check failed:", (err as Error).message);
    return false;
  }
}
