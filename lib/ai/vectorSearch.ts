/**
 * lib/ai/vectorSearch.ts
 *
 * Vector similarity search.
 *
 * PRIMARY PATH — pgvector (Postgres):
 *   When DATABASE_URL is set, embeddings are stored in and queried from the
 *   `vectors` and `reports` tables using the pgvector `<=>` cosine distance
 *   operator with an HNSW index for sub-millisecond ANN search.
 *
 * FALLBACK PATH — in-process cosine similarity:
 *   When DATABASE_URL is absent, the corpus is built in-process from
 *   metadata.json + the passed savedReports / fixLog arrays and ranked
 *   by hybrid cosine + recency + keyword + type-weight scoring.
 *   This keeps the system fully functional in local dev without Postgres.
 *
 * Corpus document types seeded into the vectors table:
 *   schema       — table-level description ("Table: X, columns: …")
 *   column       — column-level ("Column: X.Y (type)")
 *   relationship — FK relationships ("Relationship: A joins B")
 *   report       — saved user reports (also in the reports table)
 *   fix          — AI repair history entries
 *   history      — past successful queries
 */

import { embedText, embedTexts, pgVectorLiteral } from "./embeddings";
import { getPgVectorPool, isPgVectorConfigured } from "@/lib/db/pgvectorClient";
import { readFileSync } from "fs";
import { join } from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CorpusDocType = "schema" | "column" | "relationship" | "report" | "history" | "fix";

export interface VectorSearchResult {
  type: CorpusDocType;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorSearchOptions {
  query: string;
  topK?: number;
  types?: CorpusDocType[];
  savedReports?: SavedReportInput[];
  fixLog?: FixLogInput[];
}

interface SavedReportInput {
  id: string;
  name: string;
  userQuery: string;
  sql: string;
  columns: string[];
  createdAt: string;
  vectorSources?: string[];
}

interface FixLogInput {
  id: string;
  originalSQL: string;
  fixedSQL: string;
  error: string;
  userIntent: string;
  timestamp: string;
}

// ── pgvector search ───────────────────────────────────────────────────────────

async function searchPgVector(opts: VectorSearchOptions): Promise<VectorSearchResult[]> {
  const { query, topK = 8, types } = opts;
  const pool = getPgVectorPool();

  const queryEmbedding = await embedText(query);
  if (queryEmbedding.length === 0) return [];

  const embLiteral = pgVectorLiteral(queryEmbedding);
  const typeFilter = types && types.length > 0 ? `AND type = ANY($2)` : "";
  const params: unknown[] = [embLiteral];
  if (types && types.length > 0) params.push(types);

  // Query both tables: generic vectors + reports
  // Reports get a 1.2x score boost (highest-signal corpus type)
  const rows = await pool.query<{
    content: string;
    type: string;
    similarity: number;
    metadata: Record<string, unknown> | null;
  }>(
    `
    SELECT content, type,
           1 - (embedding <=> $1::vector) AS similarity,
           metadata
    FROM vectors
    WHERE embedding IS NOT NULL
    ${typeFilter}

    UNION ALL

    SELECT
      'Report: "' || name || '" — query: "' || query || '" — sql: ' || LEFT(sql, 200) AS content,
      'report' AS type,
      (1 - (embedding <=> $1::vector)) * 1.2 AS similarity,
      jsonb_build_object('reportId', id::text, 'reportName', name, 'userQuery', query) AS metadata
    FROM reports
    WHERE embedding IS NOT NULL

    ORDER BY similarity DESC
    LIMIT $${params.length + 1}
    `,
    [...params, topK]
  );

  return rows.rows.map((r) => ({
    type: r.type as CorpusDocType,
    content: r.content,
    score: Number(r.similarity),
    metadata: r.metadata ?? {},
  }));
}

// ── In-process fallback (no Postgres) ────────────────────────────────────────

interface FallbackCorpusDoc {
  type: CorpusDocType;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  embedding?: number[];
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA === 0 || magB === 0 ? 0 : dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function keywordBonus(query: string, content: string): number {
  const tokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const lower = content.toLowerCase();
  const hits = tokens.filter((t) => lower.includes(t)).length;
  return Math.min(hits * 0.02, 0.1);
}

function recencyBoost(createdAt: string): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (ageDays < 1) return 0.05;
  if (ageDays < 7) return 0.03;
  if (ageDays < 30) return 0.01;
  return 0;
}

const TYPE_WEIGHTS: Record<CorpusDocType, number> = {
  report: 1.20,
  fix: 1.15,
  relationship: 1.05,
  schema: 1.00,
  column: 0.95,
  history: 0.90,
};

function buildFallbackCorpus(
  savedReports: SavedReportInput[],
  fixLog: FixLogInput[]
): { doc: FallbackCorpusDoc; text: string }[] {
  const items: { doc: FallbackCorpusDoc; text: string }[] = [];

  // Schema from metadata.json
  let metadata: { tables?: unknown[] } = {};
  try {
    const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
    metadata = JSON.parse(raw);
  } catch { /* ok */ }

  if (Array.isArray(metadata.tables)) {
    for (const t of metadata.tables) {
      const table = t as {
        schema?: string; table?: string; name?: string;
        columns?: Array<{ name?: string; data_type?: string; type?: string }>;
        foreign_keys?: Array<{ from?: { schema?: string; table?: string; columns?: string[] }; to?: { schema?: string; table?: string; columns?: string[] } }>;
      };
      const full = table.schema ? `${table.schema}.${table.table}` : (table.name ?? table.table ?? "");
      const cols = (table.columns ?? []).map((c) => c.name).filter(Boolean).join(", ");
      const tableText = `Table: ${full}, columns: ${cols}`;
      items.push({ doc: { type: "schema", content: tableText, metadata: { table: full }, createdAt: new Date(0).toISOString() }, text: tableText });

      for (const col of table.columns ?? []) {
        if (!col.name) continue;
        const colText = `Column: ${full}.${col.name} (${col.data_type ?? col.type ?? "unknown"})`;
        items.push({ doc: { type: "column", content: colText, metadata: { table: full, column: col.name }, createdAt: new Date(0).toISOString() }, text: colText });
      }
      for (const fk of table.foreign_keys ?? []) {
        if (!fk.from || !fk.to) continue;
        const from = `${fk.from.schema}.${fk.from.table}(${(fk.from.columns ?? []).join(",")})`;
        const to = `${fk.to.schema}.${fk.to.table}(${(fk.to.columns ?? []).join(",")})`;
        const relText = `Relationship: ${from} joins ${to}`;
        items.push({ doc: { type: "relationship", content: relText, metadata: { from, to }, createdAt: new Date(0).toISOString() }, text: relText });
      }
    }
  }

  for (const r of savedReports) {
    const text = `Report: "${r.name}" — query: "${r.userQuery}" — columns: ${r.columns.join(", ")} — sql: ${r.sql.slice(0, 200)}`;
    items.push({ doc: { type: "report", content: text, metadata: { reportId: r.id, reportName: r.name }, createdAt: r.createdAt }, text });
  }
  for (const f of fixLog) {
    const text = `Fix: intent "${f.userIntent}" — error: "${f.error.slice(0, 80)}" — fixedSQL: ${f.fixedSQL.slice(0, 200)}`;
    items.push({ doc: { type: "fix", content: text, metadata: { userIntent: f.userIntent, fixedSQL: f.fixedSQL }, createdAt: f.timestamp }, text });
  }

  return items;
}

async function searchInProcess(opts: VectorSearchOptions): Promise<VectorSearchResult[]> {
  const { query, topK = 8, types, savedReports = [], fixLog = [] } = opts;

  const items = buildFallbackCorpus(savedReports, fixLog);
  const filtered = types ? items.filter((i) => types.includes(i.doc.type)) : items;
  if (filtered.length === 0) return [];

  // Batch-embed corpus docs that haven't been embedded yet
  const pending = filtered.filter((i) => !i.doc.embedding);
  if (pending.length > 0) {
    const embeddings = await embedTexts(pending.map((i) => i.text));
    for (let j = 0; j < pending.length; j++) {
      pending[j].doc.embedding = embeddings[j];
    }
  }

  const queryEmbedding = await embedText(query);

  const scored = filtered.map((item) => {
    const sim = cosine(queryEmbedding, item.doc.embedding ?? []);
    const score =
      sim * (TYPE_WEIGHTS[item.doc.type] ?? 1.0) +
      recencyBoost(item.doc.createdAt) +
      keywordBonus(query, item.doc.content);
    return { type: item.doc.type, content: item.doc.content, score, metadata: item.doc.metadata };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most relevant corpus documents for a query.
 * Uses pgvector when DATABASE_URL is configured, falls back to in-process otherwise.
 */
export async function vectorSearch(opts: VectorSearchOptions): Promise<VectorSearchResult[]> {
  if (isPgVectorConfigured()) {
    return searchPgVector(opts);
  }
  return searchInProcess(opts);
}

/**
 * Format results into an injectable context block for AI prompts.
 */
export function formatVectorContext(results: VectorSearchResult[]): string {
  if (results.length === 0) return "No relevant context found.";
  return results
    .map((r, i) => `[${i + 1}] (${r.type}, score=${r.score.toFixed(3)}) ${r.content}`)
    .join("\n");
}

/**
 * Seed the pgvector `vectors` table with schema corpus from metadata.json.
 * Call once after running setupVectors to populate the DB.
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
 */
export async function seedSchemaCorpus(): Promise<{ inserted: number }> {
  if (!isPgVectorConfigured()) {
    return { inserted: 0 };
  }

  const items = buildFallbackCorpus([], []);
  const schemaItems = items.filter((i) => ["schema", "column", "relationship"].includes(i.doc.type));

  if (schemaItems.length === 0) return { inserted: 0 };

  const texts = schemaItems.map((i) => i.text);
  const embeddings = await embedTexts(texts);

  const pool = getPgVectorPool();
  let inserted = 0;

  for (let i = 0; i < schemaItems.length; i++) {
    if (!embeddings[i] || embeddings[i].length === 0) continue;
    const item = schemaItems[i];
    const result = await pool.query(
      `INSERT INTO vectors (content, type, embedding, metadata)
       VALUES ($1, $2, $3::vector, $4)
       ON CONFLICT DO NOTHING`,
      [
        item.doc.content,
        item.doc.type,
        pgVectorLiteral(embeddings[i]),
        JSON.stringify(item.doc.metadata),
      ]
    );
    inserted += result.rowCount ?? 0;
  }

  return { inserted };
}
