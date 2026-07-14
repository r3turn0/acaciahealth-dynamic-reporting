/**
 * AppDataClient
 *
 * READ/WRITE client for the application database (PostgreSQL).
 * Stores: reports, KPI definitions, dataset snapshots, dashboard pins,
 * execution history, version history, and user configurations.
 *
 * When POSTGRES_APP_DB_URL is not set the client falls back to the in-process
 * in-memory store (Map-based) that is already used by the existing registry
 * modules — ensuring zero-config operation in development / demo mode.
 *
 * Separation contract
 * -------------------
 *   ReadOnlyDataClient  → MSSQL analytics data warehouse (SELECT only)
 *   AppDataClient       → PostgreSQL application database  (full CRUD)
 *
 * NEVER import ReadOnlyDataClient from here, and NEVER import AppDataClient
 * from a service that queries the analytics data source.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AppRecord {
  [key: string]: unknown;
}

export interface QueryResult<T = AppRecord> {
  rows: T[];
  rowCount: number;
}

// ── In-process fallback store ─────────────────────────────────────────────────
// Used when POSTGRES_APP_DB_URL is not configured.  Namespaced by table name.

const memStore = new Map<string, Map<string, AppRecord>>();

function getTable(table: string): Map<string, AppRecord> {
  if (!memStore.has(table)) memStore.set(table, new Map());
  return memStore.get(table)!;
}

// ── Postgres pool (lazy) ───────────────────────────────────────────────────────

let _pgPool: import("pg").Pool | null = null;

async function getPgPool(): Promise<import("pg").Pool | null> {
  const url = process.env.POSTGRES_APP_DB_URL;
  if (!url) return null;

  if (_pgPool) return _pgPool;

  try {
    // pg is an optional peer dep — only required when POSTGRES_APP_DB_URL is set.
    const { Pool } = await import("pg");
    _pgPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
    _pgPool.on("error", (err) => console.error("[appdb] Pool error:", err.message));
    return _pgPool;
  } catch (err) {
    console.error("[appdb] pg not available:", (err as Error).message);
    return null;
  }
}

// ── True when a real Postgres connection is configured ────────────────────────

export async function isAppDbConfigured(): Promise<boolean> {
  const pool = await getPgPool();
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ── Generic CRUD operations ──────────────────────────────────────────────────
//
// These use the same calling convention regardless of whether the real Postgres
// pool is active or the in-process fallback is used.

/**
 * Insert a row into `table`.  The record must include an "id" field.
 */
export async function insert<T extends AppRecord>(
  table: string,
  record: T
): Promise<T> {
  const pool = await getPgPool();
  if (pool) {
    const keys = Object.keys(record);
    const values = Object.values(record);
    const cols = keys.map((k) => `"${k}"`).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
    const res = await pool.query(sql, values);
    return res.rows[0] as T;
  }
  // In-memory fallback
  getTable(table).set(String(record.id), record);
  return record;
}

/**
 * Update a row in `table` by id.  Merges `patch` into the existing record.
 */
export async function update<T extends AppRecord>(
  table: string,
  id: string,
  patch: Partial<T>
): Promise<T | null> {
  const pool = await getPgPool();
  if (pool) {
    const keys = Object.keys(patch);
    if (keys.length === 0) return null;
    const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = [...Object.values(patch), id];
    const sql = `UPDATE ${table} SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
    const res = await pool.query(sql, values);
    return (res.rows[0] as T) ?? null;
  }
  // In-memory fallback
  const tbl = getTable(table);
  const existing = tbl.get(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch } as T;
  tbl.set(id, merged);
  return merged;
}

/**
 * Delete a row from `table` by id.  Returns true if a row was removed.
 */
export async function remove(table: string, id: string): Promise<boolean> {
  const pool = await getPgPool();
  if (pool) {
    const res = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
  return getTable(table).delete(id);
}

/**
 * Fetch a single row from `table` by id.
 */
export async function findById<T extends AppRecord>(
  table: string,
  id: string
): Promise<T | null> {
  const pool = await getPgPool();
  if (pool) {
    const res = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return (res.rows[0] as T) ?? null;
  }
  return (getTable(table).get(id) as T) ?? null;
}

/**
 * List all rows from `table`, optionally filtered by a single equality condition.
 * Ordered by `orderBy` descending (default: "created_date").
 */
export async function list<T extends AppRecord>(
  table: string,
  options?: {
    where?: { column: string; value: unknown };
    orderBy?: string;
    limit?: number;
  }
): Promise<T[]> {
  const pool = await getPgPool();
  if (pool) {
    let sql = `SELECT * FROM ${table}`;
    const values: unknown[] = [];
    if (options?.where) {
      sql += ` WHERE "${options.where.column}" = $1`;
      values.push(options.where.value);
    }
    sql += ` ORDER BY "${options?.orderBy ?? "created_date"}" DESC`;
    if (options?.limit) sql += ` LIMIT ${options.limit}`;
    const res = await pool.query(sql, values);
    return res.rows as T[];
  }

  // In-memory fallback
  let rows = Array.from(getTable(table).values()) as T[];
  if (options?.where) {
    rows = rows.filter((r) => r[options.where!.column] === options.where!.value);
  }
  const orderKey = options?.orderBy ?? "created_date";
  rows.sort((a, b) =>
    String(b[orderKey] ?? "").localeCompare(String(a[orderKey] ?? ""))
  );
  if (options?.limit) rows = rows.slice(0, options.limit);
  return rows;
}

/**
 * Run a raw SQL query against the app DB (Postgres only).
 * Falls back to an empty result when using in-memory mode.
 */
export async function rawQuery<T = AppRecord>(
  sql: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const pool = await getPgPool();
  if (pool) {
    const res = await pool.query(sql, values);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  }
  return { rows: [], rowCount: 0 };
}

/**
 * Expose the underlying pool for callers that need transaction support.
 * Returns null when running in in-memory mode.
 */
export async function getPool(): Promise<import("pg").Pool | null> {
  return getPgPool();
}
