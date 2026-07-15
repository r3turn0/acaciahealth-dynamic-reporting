/**
 * lib/ai/vectorSearch.ts
 *
 * In-process vector search using cosine similarity on cached text embeddings.
 *
 * Architecture:
 *  - Embeddings are generated server-side via the AI Gateway embed() call.
 *  - The corpus is built once from: schema (metadata.json) + saved reports + fix history.
 *  - Results are ranked by cosine similarity + recency boost + type weight.
 *  - No external vector DB required — the corpus fits comfortably in process memory
 *    for a healthcare analytics system with hundreds of tables and thousands of
 *    query history entries.
 *
 * Hybrid ranking: cosine similarity * typeWeight + recencyBoost + keywordBonus
 */

import { embed, embedMany } from "ai";
import { readFileSync } from "fs";
import { join } from "path";

// ── Corpus document ───────────────────────────────────────────────────────────

export type CorpusDocType = "schema" | "column" | "relationship" | "report" | "history" | "fix";

export interface CorpusDoc {
  id: string;
  type: CorpusDocType;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO
  embedding?: number[];
}

// ── In-process corpus cache ───────────────────────────────────────────────────

interface CorpusCache {
  docs: CorpusDoc[];
  builtAt: number;
}

let _cache: CorpusCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// ── Embedding model ───────────────────────────────────────────────────────────

// text-embedding-3-small is cheap and accurate for schema/SQL text
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

async function embedText(text: string): Promise<number[]> {
  try {
    const result = await embed({
      model: EMBEDDING_MODEL,
      value: text,
    });
    return result.embedding;
  } catch {
    // If embedding fails (e.g. no AI_GATEWAY_API_KEY), return empty vector
    return [];
  }
}

async function embedMany_(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const result = await embedMany({
      model: EMBEDDING_MODEL,
      values: texts,
    });
    return result.embeddings;
  } catch {
    return texts.map(() => []);
  }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Keyword bonus (fast fallback signal) ─────────────────────────────────────

function keywordBonus(query: string, content: string): number {
  const qTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const cLower = content.toLowerCase();
  const matches = qTokens.filter((t) => t.length > 2 && cLower.includes(t));
  return Math.min(matches.length * 0.02, 0.1); // cap at +0.10
}

// ── Corpus builder ─────────────────────────────────────────────────────────────

function buildCorpusTexts(
  savedReports: Array<{ id: string; name: string; userQuery: string; sql: string; columns: string[]; createdAt: string; vectorSources?: string[] }>,
  fixLog: Array<{ id: string; originalSQL: string; fixedSQL: string; error: string; userIntent: string; timestamp: string }>,
): { doc: CorpusDoc; text: string }[] {
  const items: { doc: CorpusDoc; text: string }[] = [];

  // 1. Schema from metadata.json
  let metadata: { tables?: unknown[] } = { tables: [] };
  try {
    const raw = readFileSync(join(process.cwd(), "public", "metadata.json"), "utf-8");
    metadata = JSON.parse(raw);
  } catch {
    // metadata.json not available
  }

  if (Array.isArray(metadata.tables)) {
    for (const t of metadata.tables) {
      const table = t as {
        schema?: string;
        table?: string;
        name?: string;
        columns?: Array<{ name?: string; data_type?: string; type?: string }>;
        foreign_keys?: Array<{ from?: { schema?: string; table?: string; columns?: string[] }; to?: { schema?: string; table?: string; columns?: string[] } }>;
      };

      const tableFull = table.schema
        ? `${table.schema}.${table.table}`
        : table.name ?? table.table ?? "";

      // Table-level doc
      const colNames = (table.columns ?? []).map((c) => c.name).filter(Boolean).join(", ");
      const tableText = `Table: ${tableFull}, columns: ${colNames}`;
      items.push({
        doc: {
          id: `schema:${tableFull}`,
          type: "schema",
          content: tableText,
          metadata: { table: tableFull },
          createdAt: new Date(0).toISOString(),
        },
        text: tableText,
      });

      // Column-level docs
      for (const col of table.columns ?? []) {
        if (!col.name) continue;
        const colText = `Column: ${tableFull}.${col.name} (${col.data_type ?? col.type ?? "unknown"})`;
        items.push({
          doc: {
            id: `col:${tableFull}.${col.name}`,
            type: "column",
            content: colText,
            metadata: { table: tableFull, column: col.name, dataType: col.data_type ?? col.type },
            createdAt: new Date(0).toISOString(),
          },
          text: colText,
        });
      }

      // Relationship docs
      for (const fk of table.foreign_keys ?? []) {
        if (!fk.from || !fk.to) continue;
        const from = `${fk.from.schema}.${fk.from.table}(${(fk.from.columns ?? []).join(",")})`;
        const to = `${fk.to.schema}.${fk.to.table}(${(fk.to.columns ?? []).join(",")})`;
        const relText = `Relationship: ${from} joins ${to}`;
        items.push({
          doc: {
            id: `rel:${from}->${to}`,
            type: "relationship",
            content: relText,
            metadata: { from, to },
            createdAt: new Date(0).toISOString(),
          },
          text: relText,
        });
      }
    }
  }

  // 2. Saved reports
  for (const r of savedReports) {
    const text = `Report: "${r.name}" — user query: "${r.userQuery}" — columns: ${r.columns.join(", ")} — SQL: ${r.sql.slice(0, 200)}`;
    items.push({
      doc: {
        id: `report:${r.id}`,
        type: "report",
        content: text,
        metadata: { reportId: r.id, reportName: r.name, userQuery: r.userQuery },
        createdAt: r.createdAt,
      },
      text,
    });
  }

  // 3. Fix history
  for (const f of fixLog) {
    const text = `Fix history: user asked "${f.userIntent}" — error: "${f.error.slice(0, 100)}" — fixed SQL: ${f.fixedSQL.slice(0, 200)}`;
    items.push({
      doc: {
        id: `fix:${f.id}`,
        type: "fix",
        content: text,
        metadata: { userIntent: f.userIntent, originalSQL: f.originalSQL, fixedSQL: f.fixedSQL },
        createdAt: f.timestamp,
      },
      text,
    });
  }

  return items;
}

// ── Type weights for hybrid ranking ──────────────────────────────────────────

const TYPE_WEIGHTS: Record<CorpusDocType, number> = {
  report: 1.20,   // reports are highest-signal: real user intent + real SQL
  fix: 1.15,      // fixes encode known errors + corrections
  schema: 1.00,
  column: 0.95,
  relationship: 1.05,
  history: 0.90,
};

function recencyBoost(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 1) return 0.05;
  if (ageDays < 7) return 0.03;
  if (ageDays < 30) return 0.01;
  return 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

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
  savedReports?: Array<{ id: string; name: string; userQuery: string; sql: string; columns: string[]; createdAt: string; vectorSources?: string[] }>;
  fixLog?: Array<{ id: string; originalSQL: string; fixedSQL: string; error: string; userIntent: string; timestamp: string }>;
}

/**
 * Search the corpus for documents most relevant to the query.
 * Builds and caches embeddings for all corpus documents, then ranks by
 * hybrid cosine + keyword + recency + type-weight score.
 */
export async function vectorSearch(opts: VectorSearchOptions): Promise<VectorSearchResult[]> {
  const {
    query,
    topK = 8,
    types,
    savedReports = [],
    fixLog = [],
  } = opts;

  // Build corpus
  const items = buildCorpusTexts(savedReports, fixLog);

  // Filter by requested types
  const filtered = types
    ? items.filter((i) => types.includes(i.doc.type))
    : items;

  if (filtered.length === 0) return [];

  // Embed all corpus docs that don't have an embedding yet, in batch
  const needsEmbed = filtered.filter((i) => !i.doc.embedding);
  if (needsEmbed.length > 0) {
    const embeddings = await embedMany_(needsEmbed.map((i) => i.text));
    for (let j = 0; j < needsEmbed.length; j++) {
      needsEmbed[j].doc.embedding = embeddings[j];
    }
  }

  // Embed the query
  const queryEmbedding = await embedText(query);

  // Score
  const scored = filtered.map((item) => {
    const sim = cosine(queryEmbedding, item.doc.embedding ?? []);
    const typeW = TYPE_WEIGHTS[item.doc.type] ?? 1.0;
    const recency = recencyBoost(item.doc.createdAt);
    const keyword = keywordBonus(query, item.doc.content);
    const score = sim * typeW + recency + keyword;

    return {
      type: item.doc.type,
      content: item.doc.content,
      score,
      metadata: item.doc.metadata,
    };
  });

  // Sort descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

/**
 * Format vector search results into an injectable context block for an AI prompt.
 */
export function formatVectorContext(results: VectorSearchResult[]): string {
  if (results.length === 0) return "No relevant context found.";

  return results
    .map((r, i) => `[${i + 1}] (${r.type}, score=${r.score.toFixed(2)}) ${r.content}`)
    .join("\n");
}
