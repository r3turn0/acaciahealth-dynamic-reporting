/**
 * lib/db/pgvectorClient.ts
 *
 * Dedicated Postgres pool for pgvector operations.
 * Separate from the SQL Server (mssql) pool used for healthcare data queries.
 *
 * Requires DATABASE_URL in the environment pointing at a Postgres instance
 * with the pgvector extension enabled.
 *
 * Tables required (run lib/db/setupVectors.ts once):
 *   vectors (id, content, type, embedding vector(1536))
 *   reports (id, name, sql, query, embedding vector(1536), created_at)
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

export function getPgVectorPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Add it to .env.local pointing at a Postgres instance with pgvector."
      );
    }
    _pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
    _pool.on("error", (err) => {
      console.error("[pgvector] pool error:", err.message);
    });
  }
  return _pool;
}

/** True when DATABASE_URL is configured. */
export function isPgVectorConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}
