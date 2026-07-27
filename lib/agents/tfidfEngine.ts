// ─────────────────────────────────────────────────────────────────────────────
// Hybrid Search Engine  (keyword + semantic TF-IDF + synonym expansion)
//
// Scoring weights (spec-mandated):
//   exact_match          100  (normalised to 1.0)
//   synonym_match         85  (0.85)
//   semantic_similarity   75  (0.75 * cosine, 0–1)
//   report_usage          20  (0.20, applied externally by queryLearner)
//   dataset_popularity    10  (0.10, applied externally by queryLearner)
//
// All weights are additive per asset; final score is clamped to [0, 1].
// ─────────────────────────────────────────────────────────────────────────────

import type { SchemaModel, Table } from "@/lib/schema/types";
import type { TagStore }           from "@/lib/agents/tableTagger";
import thesaurus                   from "@/lib/config/healthcareThesaurus.json";

// ── Weight constants (spec §Relevance Ranking) ────────────────────────────────

const W_EXACT    = 1.00;   // exact term match in any metadata field
const W_SYNONYM  = 0.85;   // match via healthcare synonym dictionary
const W_SEMANTIC = 0.75;   // TF-IDF cosine similarity (multiplied by raw score)

// ── Healthcare synonym map ────────────────────────────────────────────────────
// Canonical term → all equivalent user-facing terms (for query expansion).
// These drive synonym_match scoring and query expansion before TF-IDF.

const SYNONYM_MAP: Record<string, string[]> = {
  // Census / occupancy cluster
  census:              ["adc", "average daily census", "avg daily census", "daily census",
                        "occupied beds", "occupancy", "occupancy rate", "resident count",
                        "patient count", "bed occupancy", "census count", "census metrics",
                        "facility census", "census last quarter", "census by month",
                        "monthly census", "monthly occupancy", "census development"],
  adc:                 ["census", "average daily census", "daily census", "occupancy",
                        "occupied beds", "resident count"],
  occupancy:           ["census", "adc", "average daily census", "occupied beds",
                        "occupancy rate", "bed occupancy"],
  "occupied beds":     ["census", "adc", "occupancy", "bed count"],
  // Admissions cluster
  admissions:          ["intake", "soc", "start of care", "enrollment", "admit",
                        "new patient", "new admission", "admission rate", "admissions by facility"],
  discharges:          ["discharge", "exits", "transfers", "live discharge",
                        "discharge trends", "discharge rate"],
  "discharge trends":  ["discharges", "discharge rate", "exits", "transfers"],
  // Demographics cluster
  demographics:        ["resident demographics", "patient demographics", "demographic analysis",
                        "age", "gender", "race", "ethnicity", "zip", "diagnosis mix"],
  "resident demographics": ["demographics", "patient demographics", "demographic analysis"],
  "patient demographics":  ["demographics", "resident demographics", "demographic analysis"],
  // Facility cluster
  facility:            ["building", "community", "branch", "location", "site", "campus"],
  "facility census":   ["census", "adc", "occupancy", "facility occupancy"],
  "facility census by month": ["monthly census", "census by month", "monthly occupancy"],
  // Revenue / billing cluster
  revenue:             ["billing", "charges", "reimbursement", "net revenue", "gross revenue"],
  billing:             ["revenue", "claims", "invoices", "reimbursement"],
  // Staff / clinical cluster
  staff:               ["employees", "clinicians", "nurses", "caregivers", "workforce"],
  visits:              ["encounters", "patient visits", "clinical visits", "service visits"],
  // Service lines
  "service lines":     ["disciplines", "sn", "pt", "ot", "hha", "hospice", "home health"],
  hospice:             ["hospice care", "end of life", "palliative", "comfort care"],
  "home health":       ["homehealth", "home care", "skilled home care"],
};

// Reverse index: synonym → canonical terms that reference it
const REVERSE_SYNONYM: Record<string, string[]> = {};
for (const [canonical, synonyms] of Object.entries(SYNONYM_MAP)) {
  for (const syn of synonyms) {
    if (!REVERSE_SYNONYM[syn]) REVERSE_SYNONYM[syn] = [];
    REVERSE_SYNONYM[syn].push(canonical);
  }
}

// ── Healthcare stop-words ─────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","of","in","on","at","to","for","with","by","from","and","or",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can",
  "it","its","this","that","these","those","all","any","each","every","no",
  "not","but","if","as","so","then","than","also","into","out","up","down",
  "over","under","between","about","after","before","during","through","per",
  "tbl","table","col","column","id","code","name","date","type","flag","num",
  "amt","val","txt","desc","ind","dt","tm","ts","seq","nr","nb","ref",
]);

// ── Tokeniser ─────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, " ")
    .split(/[\s_\-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Query expansion ───────────────────────────────────────────────────────────
// Given a raw query, returns expanded tokens + matched synonym groups.

export interface QueryExpansion {
  originalTokens: string[];
  expandedTokens: string[];
  matchedSynonymGroups: { canonical: string; synonyms: string[] }[];
}

export function expandQuery(query: string): QueryExpansion {
  const originalTokens = tokenise(query);
  const expandedSet    = new Set(originalTokens);
  const matchedGroups: { canonical: string; synonyms: string[] }[] = [];

  const lowerQuery = query.toLowerCase().trim();

  // Check multi-word synonyms first (longer matches win)
  const allPhrases = [
    ...Object.keys(SYNONYM_MAP),
    ...Object.keys(REVERSE_SYNONYM),
  ].sort((a, b) => b.length - a.length); // longest first

  const consumedRanges: [number, number][] = [];

  for (const phrase of allPhrases) {
    const idx = lowerQuery.indexOf(phrase);
    if (idx === -1) continue;

    // Ensure word boundaries
    const before = idx === 0 || /\W/.test(lowerQuery[idx - 1]);
    const after  = idx + phrase.length >= lowerQuery.length || /\W/.test(lowerQuery[idx + phrase.length]);
    if (!before || !after) continue;

    // Avoid overlapping with already-consumed ranges
    const overlaps = consumedRanges.some(([s, e]) => idx < e && idx + phrase.length > s);
    if (overlaps) continue;

    consumedRanges.push([idx, idx + phrase.length]);

    const synonyms = SYNONYM_MAP[phrase] ?? REVERSE_SYNONYM[phrase] ?? [];
    for (const syn of synonyms) {
      for (const tok of tokenise(syn)) expandedSet.add(tok);
    }
    if (synonyms.length > 0) {
      const canonical = SYNONYM_MAP[phrase] ? phrase : (REVERSE_SYNONYM[phrase]?.[0] ?? phrase);
      matchedGroups.push({ canonical, synonyms: synonyms.slice(0, 6) });
    }
  }

  // Also add thesaurus synonyms
  const tags = thesaurus.tags as Record<string, { terms: string[] }>;
  for (const tok of originalTokens) {
    for (const [, entry] of Object.entries(tags)) {
      if (entry.terms.some((t) => t === tok || t.includes(tok) || tok.includes(t))) {
        for (const term of entry.terms.slice(0, 10)) {
          for (const t of tokenise(term)) expandedSet.add(t);
        }
      }
    }
  }

  return {
    originalTokens,
    expandedTokens: [...expandedSet],
    matchedSynonymGroups: matchedGroups,
  };
}

// ── Corpus builder ────────────────────────────────────────────────────────────

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

  // Boost with thesaurus terms for this table's auto-tags
  const tagEntry = store?.[table.id];
  if (tagEntry) {
    const tags = thesaurus.tags as Record<string, { terms: string[] }>;
    for (const tagId of tagEntry.tags) {
      if (tags[tagId]) {
        parts.push(...tags[tagId].terms.slice(0, 20));
      }
    }
  }

  // Expand corpus using synonym map (table name / column names as canonical lookups)
  const tableTokens = tokenise(table.name);
  for (const tok of tableTokens) {
    const expansions = SYNONYM_MAP[tok] ?? REVERSE_SYNONYM[tok] ?? [];
    for (const syn of expansions) {
      parts.push(syn);
    }
  }

  return tokenise(parts.join(" "));
}

// ── TF-IDF index ──────────────────────────────────────────────────────────────

export interface TFIDFIndex {
  tableIds:    string[];
  /** tableIdx → (term → tf-idf weight) */
  vectors:     Map<string, number>[];
  /** term → idf */
  idf:         Map<string, number>;
  /** tableId → raw field strings for exact-match and highlight */
  rawFields:   Record<string, string[]>;
  builtAt:     number;
}

export function buildTFIDFIndex(
  model: SchemaModel,
  store?: TagStore
): TFIDFIndex {
  const tables  = Object.values(model.tables);
  const tableIds = tables.map((t) => t.id);
  const N        = tables.length;

  // Raw fields per table for highlight / exact-match scoring
  const rawFields: Record<string, string[]> = {};
  for (const t of tables) {
    rawFields[t.id] = [
      t.name,
      t.description ?? "",
      ...t.columns.map((c) => c.displayName),
      ...t.columns.map((c) => c.description ?? ""),
    ].filter(Boolean);
  }

  const tfMaps: Map<string, number>[] = tables.map((table) => {
    const tokens = buildCorpus(table, store);
    const tf     = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    const len = tokens.length || 1;
    for (const [k, v] of tf) tf.set(k, v / len);
    return tf;
  });

  const df = new Map<string, number>();
  for (const tf of tfMaps) {
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  const vectors: Map<string, number>[] = tfMaps.map((tf) => {
    const vec = new Map<string, number>();
    for (const [term, tfVal] of tf) vec.set(term, tfVal * (idf.get(term) ?? 1));
    return vec;
  });

  return { tableIds, vectors, idf, rawFields, builtAt: Date.now() };
}

// ── Exact-match scorer ────────────────────────────────────────────────────────

function exactMatchScore(fields: string[], queryTokens: string[]): number {
  if (!fields.length || !queryTokens.length) return 0;
  const joined = fields.join(" ").toLowerCase();
  let hits = 0;
  for (const tok of queryTokens) {
    const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(joined)) hits++;
  }
  return hits / queryTokens.length; // 0–1
}

// ── Synonym-match scorer ──────────────────────────────────────────────────────

function synonymMatchScore(fields: string[], expansion: QueryExpansion): number {
  if (!fields.length || !expansion.matchedSynonymGroups.length) return 0;
  const joined = fields.join(" ").toLowerCase();
  let maxHit = 0;
  for (const { synonyms } of expansion.matchedSynonymGroups) {
    const synTokens = synonyms.flatMap((s) => tokenise(s));
    const hits = synTokens.filter((t) => joined.includes(t)).length;
    if (hits > 0) maxHit = Math.max(maxHit, hits / synTokens.length);
  }
  return maxHit;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, w] of a) {
    normA += w * w;
    dot   += w * (b.get(term) ?? 0);
  }
  for (const w of b.values()) normB += w * w;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function queryVector(query: string, idf: Map<string, number>): Map<string, number> {
  const tokens = tokenise(query);
  const tf     = new Map<string, number>();
  for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
  const len = tokens.length || 1;
  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const idfVal = idf.get(term) ?? Math.log(2) + 1;
    vec.set(term, (count / len) * idfVal);
  }
  return vec;
}

// ── Highlight helper ──────────────────────────────────────────────────────────
// Returns segments of a string with matched terms flagged.

export interface HighlightSegment {
  text:       string;
  highlight:  boolean;
}

export function highlightText(
  text: string,
  queryTokens: string[]
): HighlightSegment[] {
  if (!text || !queryTokens.length) return [{ text, highlight: false }];

  // Build a single regex for all tokens
  const pattern = queryTokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(${pattern})`, "gi");

  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), highlight: false });
    segments.push({ text: match[0], highlight: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), highlight: false });
  return segments;
}

// ── Public search result ──────────────────────────────────────────────────────

export interface SearchResult {
  tableId:              string;
  /** Final composite score 0–1 */
  confidenceScore:      number;
  /** Breakdown of scoring components */
  scoreBreakdown: {
    exactMatch:         number;  // 0–1, weight W_EXACT
    synonymMatch:       number;  // 0–1, weight W_SYNONYM
    semanticSimilarity: number;  // 0–1, weight W_SEMANTIC
    learnerBoost:       number;  // multiplicative, applied externally
  };
  matchedTerms:         string[];
  matchedSynonyms:      string[];
  /** Pre-computed highlights for the table name */
  nameHighlight:        HighlightSegment[];
  /** Which thesaurus tags matched */
  matchedTags:          string[];
  /** Relationship-aware: related tables inferred from the query */
  relatedTableIds:      string[];
}

// ── Main hybrid search ────────────────────────────────────────────────────────

export function hybridSearch(
  query:   string,
  index:   TFIDFIndex,
  model?:  SchemaModel,
  limit    = 20
): SearchResult[] {
  const expansion = expandQuery(query);
  const { expandedTokens, originalTokens, matchedSynonymGroups } = expansion;

  // Build expanded query vector using original + expanded tokens
  const expandedQueryStr = expandedTokens.join(" ");
  const qVec = queryVector(expandedQueryStr, index.idf);

  const results: SearchResult[] = [];

  for (let i = 0; i < index.tableIds.length; i++) {
    const tableId  = index.tableIds[i];
    const docVec   = index.vectors[i];
    const fields   = index.rawFields[tableId] ?? [];

    const exactScore   = exactMatchScore(fields, originalTokens) * W_EXACT;
    const synonymScore = synonymMatchScore(fields, expansion) * W_SYNONYM;
    const semanticRaw  = cosineSimilarity(qVec, docVec);
    const semanticScore = semanticRaw * W_SEMANTIC;

    const rawScore = Math.min(1, exactScore + synonymScore + semanticScore);
    if (rawScore < 0.01) continue;

    const matchedTerms   = originalTokens.filter((t) => docVec.has(t));
    const matchedSynonyms: string[] = [];
    for (const { canonical, synonyms } of matchedSynonymGroups) {
      if (fields.some((f) => f.toLowerCase().includes(canonical))) {
        matchedSynonyms.push(...synonyms.slice(0, 3));
      }
    }

    // Relationship-aware: find related tables using the model graph
    const relatedTableIds: string[] = [];
    if (model) {
      const edges = model.graph.edges.filter(
        (e) => e.from === tableId || e.to === tableId
      );
      for (const e of edges) {
        const related = e.from === tableId ? e.to : e.from;
        if (!relatedTableIds.includes(related)) relatedTableIds.push(related);
      }
    }

    // Matched thesaurus tags
    const tags = thesaurus.tags as Record<string, { terms: string[] }>;
    const matchedTags: string[] = [];
    for (const [tagId, entry] of Object.entries(tags)) {
      const tagHit = originalTokens.some((t) =>
        entry.terms.some((term) => term.includes(t) || t.includes(term))
      );
      if (tagHit) matchedTags.push(tagId);
    }

    // Table name for highlight
    const tableName = fields[0] ?? tableId;
    const nameHighlight = highlightText(tableName, originalTokens);

    results.push({
      tableId,
      confidenceScore: rawScore,
      scoreBreakdown: {
        exactMatch:         exactScore,
        synonymMatch:       synonymScore,
        semanticSimilarity: semanticScore,
        learnerBoost:       1.0, // applied externally
      },
      matchedTerms,
      matchedSynonyms: Array.from(new Set(matchedSynonyms)),
      nameHighlight,
      matchedTags,
      relatedTableIds,
    });
  }

  return results
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, limit);
}

// ── Legacy function kept for compatibility ────────────────────────────────────

export function semanticSearch(
  query: string,
  index: TFIDFIndex,
  limit = 20
): { tableId: string; score: number; matchedTerms: string[] }[] {
  return hybridSearch(query, index, undefined, limit).map((r) => ({
    tableId:      r.tableId,
    score:        r.confidenceScore,
    matchedTerms: r.matchedTerms,
  }));
}

// ── In-memory index cache ─────────────────────────────────────────────────────

let _index: TFIDFIndex | null = null;

export function getOrBuildIndex(model: SchemaModel, store?: TagStore): TFIDFIndex {
  if (!_index) _index = buildTFIDFIndex(model, store);
  return _index;
}

/** Force a full rebuild on next search — call after new dataset published. */
export function invalidateIndex(): void {
  _index = null;
}

/** Incremental refresh: add/update a single table without full rebuild. */
export function patchIndex(
  tableId:  string,
  model:    SchemaModel,
  store?:   TagStore
): void {
  if (!_index) return; // will rebuild fresh on next search
  const table = model.tables[tableId];
  if (!table) return;

  const idx = _index.tableIds.indexOf(tableId);
  const corpus  = buildCorpus(table, store);
  const tf      = new Map<string, number>();
  for (const tok of corpus) tf.set(tok, (tf.get(tok) ?? 0) + 1);
  const len = corpus.length || 1;
  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const idfVal = _index.idf.get(term) ?? Math.log(2) + 1;
    vec.set(term, (count / len) * idfVal);
  }

  const rawFields = [
    table.name,
    table.description ?? "",
    ...table.columns.map((c) => c.displayName),
  ].filter(Boolean);

  if (idx >= 0) {
    _index.vectors[idx]          = vec;
    _index.rawFields[tableId]    = rawFields;
  } else {
    _index.tableIds.push(tableId);
    _index.vectors.push(vec);
    _index.rawFields[tableId]    = rawFields;
  }
}
