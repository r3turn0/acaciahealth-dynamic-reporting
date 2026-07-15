/**
 * lib/db/setupVectors.ts
 *
 * One-shot setup: creates the pgvector extension + vectors and reports tables.
 *
 * Run once after pointing DATABASE_URL at your Postgres instance:
 *
 *   node --env-file-if-exists=.env.local -e "require('./lib/db/setupVectors').setup()"
 *
 * Or via the npm script:
 *   npm run setup:vectors
 *
 * This is idempotent — safe to run multiple times.
 */

import { getPgVectorPool } from "./pgvectorClient";

export async function setup() {
  const pool = getPgVectorPool();
  const client = await pool.connect();

  try {
    console.log("[setup:vectors] Enabling pgvector extension...");
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    console.log("[setup:vectors] Creating vectors table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS vectors (
        id        SERIAL PRIMARY KEY,
        content   TEXT        NOT NULL,
        type      TEXT        NOT NULL,
        embedding VECTOR(1536),
        metadata  JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    console.log("[setup:vectors] Creating reports table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT        NOT NULL,
        sql        TEXT        NOT NULL,
        query      TEXT        NOT NULL,
        columns    TEXT[]      NOT NULL DEFAULT '{}',
        row_count  INTEGER     NOT NULL DEFAULT 0,
        embedding  VECTOR(1536),
        metadata   JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    console.log("[setup:vectors] Creating HNSW indexes for fast ANN search...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS vectors_embedding_idx
        ON vectors USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS reports_embedding_idx
        ON reports USING hnsw (embedding vector_cosine_ops)
    `);

    console.log("[setup:vectors] Setup complete.");
  } finally {
    client.release();
  }
}

// Allow running directly via: node lib/db/setupVectors.js
if (require.main === module) {
  setup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[setup:vectors] Failed:", err);
      process.exit(1);
    });
}
