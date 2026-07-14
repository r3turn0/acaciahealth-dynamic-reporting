// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Semantic Search Engine
//
// Builds a TF-IDF index over the schema's table corpus (table name, column
// names, descriptions, FK names, thesaurus terms) and ranks tables against a
// free-text user query using cosine similarity.
//
// No external dependencies — pure TypeScript.
// ─────────────────────────────────────────────────────────────────────────────

import type { SchemaModel, Table } from "@/lib/schema/types";
import type { TagStore } from "@/lib/agents/tableTagger";
import thesaurus from "@/lib/config/healthcareThesaurus.json";

// ── Healthcare stop-words (stripped before indexing) ─────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","of","in","on","at","to","for","with","by","from","and","or",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can",
  "it","its","this","that","these","those","all","any","each","every","no",
  "not","but","if","as","so","then","than","also","into","out","up","down",
  "over","under","between","about","after","before","during","through","per",
  "tbl","table","col","column","id","code","name","date","type","flag","num",
  "amt","val","txt","desc","ind","dt","tm","ts","seq","no","nr","nb","ref",
]);

// ── Tokeniser ─────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, " ")
    .split(/[\s_\-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Corpus builder — includes thesaurus terms for the table's tags ────────────

function buildCorpus(table: Table, store?: TagStore): string[] {
  const parts: string[] = [
    table.name,
    table.schema,
    table.domain,
    table.entityType,
    table.description ?? "",
  ];

  for (const col of table.columns) {
    parts.push(col.name, col.displayName, col.description ?? "");
  }
  for (const fk of table.foreignKeys) {
    parts.push(fk.name, fk.references.table);
  }
  parts.push(...table.meta.indexes, ...table.meta.triggers);

  // Boost with thesaurus terms matching this table's auto-tags
  const tagEntry = store?.[table.id];
  if (tagEntry) {
    const tags = thesaurus.tags as Record<string, { terms: string[] }>;
    for (const tagId of tagEntry.tags) {
      if (tags[tagId]) {
        // Add first 20 thesaurus terms as extra corpus weight (controlled boost)
        parts.push(...tags[tagId].terms.slice(0, 20));
      }
    }
  }

  return tokenise(parts.join(" "));
}

// ── TF-IDF Index ──────────────────────────────────────────────────────────────

export interface TFIDFIndex {
  tableIds: string[];
  /** tableIdx → (term → tf-idf weight) */
  vectors: Map<string, number>[];
  /** term → idf */
  idf: Map<string, number>;
}

export function buildTFIDFIndex(
  model: SchemaModel,
  store?: TagStore
): TFIDFIndex {
  const tables = Object.values(model.tables);
  const tableIds = tables.map((t) => t.id);
  const N = tables.length;

  // Step 1: term frequency per document
  const tfMaps: Map<string, number>[] = tables.map((table) => {
    const tokens = buildCorpus(table, store);
    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    // Normalise TF by document length
    const len = tokens.length || 1;
    for (const [k, v] of tf) {
      tf.set(k, v / len);
    }
    return tf;
  });

  // Step 2: document frequency → IDF
  const df = new Map<string, number>();
  for (const tf of tfMaps) {
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    // Classic IDF with smoothing
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  // Step 3: TF-IDF vectors
  const vectors: Map<string, number>[] = tfMaps.map((tf) => {
    const vec = new Map<string, number>();
    for (const [term, tfVal] of tf) {
      vec.set(term, tfVal * (idf.get(term) ?? 1));
    }
    return vec;
  });

  return { tableIds, vectors, idf };
}

// ── Query vector ──────────────────────────────────────────────────────────────

function queryVector(
  query: string,
  idf: Map<string, number>
): Map<string, number> {
  const tokens = tokenise(query);
  const tf = new Map<string, number>();
  for (const tok of tokens) {
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
  }
  const len = tokens.length || 1;
  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const idfVal = idf.get(term) ?? Math.log((1 + 1) / (0 + 1)) + 1; // unseen term IDF
    vec.set(term, (count / len) * idfVal);
  }
  return vec;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, w] of a) {
    normA += w * w;
    const bw = b.get(term) ?? 0;
    dot += w * bw;
  }
  for (const w of b.values()) {
    normB += w * w;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public search API ─────────────────────────────────────────────────────────

export interface SearchResult {
  tableId: string;
  score: number;       // cosine similarity 0-1
  matchedTerms: string[];
}

/**
 * Rank tables by TF-IDF cosine similarity to the query string.
 * Falls back to the legacy keyword search when index is not available.
 */
export function semanticSearch(
  query: string,
  index: TFIDFIndex,
  limit = 20
): SearchResult[] {
  const qVec = queryVector(query, index.idf);
  const qTerms = new Set(qVec.keys());
  const results: SearchResult[] = [];

  for (let i = 0; i < index.tableIds.length; i++) {
    const tableId = index.tableIds[i];
    const docVec = index.vectors[i];
    const score = cosineSimilarity(qVec, docVec);
    if (score > 0) {
      const matchedTerms = [...qTerms].filter((t) => docVec.has(t));
      results.push({ tableId, score, matchedTerms });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── In-memory index cache (module-level singleton) ────────────────────────────

let _index: TFIDFIndex | null = null;

export function getOrBuildIndex(model: SchemaModel, store?: TagStore): TFIDFIndex {
  if (!_index) {
    _index = buildTFIDFIndex(model, store);
  }
  return _index;
}

export function invalidateIndex() {
  _index = null;
}
