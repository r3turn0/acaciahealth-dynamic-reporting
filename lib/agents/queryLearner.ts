// ─────────────────────────────────────────────────────────────────────────────
// Adaptive Query Learner
//
// Records which tables and tags a user selects after each search. Maintains a
// frequency map in sessionStorage so the TF-IDF search can boost frequently
// used tables for anticipatory suggestions.
//
// Fully client-side, zero network calls. The learner feeds back into the
// semantic search engine as a score multiplier.
// ─────────────────────────────────────────────────────────────────────────────

import { suggestTagsForQuery } from "@/lib/agents/tableTagger";

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "acacia_query_learner_v2";
const MAX_ENTRIES = 500;

// ── Data model ────────────────────────────────────────────────────────────────

export interface LearnerEntry {
  query: string;
  resolvedTableIds: string[];
  resolvedTags: string[];
  kpi?: string;
  ts: number; // unix ms
}

export interface LearnerState {
  entries: LearnerEntry[];
  /** tableId → total selection count */
  tableFrequency: Record<string, number>;
  /** tagId → total selection count */
  tagFrequency: Record<string, number>;
  /** Inferred vocabulary: term → count (from user query tokens) */
  vocabulary: Record<string, number>;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function load(): LearnerState {
  if (typeof window === "undefined") return empty();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LearnerState) : empty();
  } catch {
    return empty();
  }
}

function save(state: LearnerState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota — evict oldest 100 entries and retry
    state.entries = state.entries.slice(-400);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* give up */ }
  }
}

function empty(): LearnerState {
  return { entries: [], tableFrequency: {}, tagFrequency: {}, vocabulary: {} };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record that the user submitted a query and the engine resolved it to a set
 * of tables + tags. Call this every time the user runs a report or picks a
 * search result.
 */
export function recordQuery(
  query: string,
  resolvedTableIds: string[],
  resolvedTags: string[],
  kpi?: string
): void {
  const state = load();

  // Update frequency maps
  for (const id of resolvedTableIds) {
    state.tableFrequency[id] = (state.tableFrequency[id] ?? 0) + 1;
  }
  for (const tag of resolvedTags) {
    state.tagFrequency[tag] = (state.tagFrequency[tag] ?? 0) + 1;
  }

  // Update vocabulary from query tokens
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  for (const tok of tokens) {
    state.vocabulary[tok] = (state.vocabulary[tok] ?? 0) + 1;
  }

  // Append entry
  state.entries.push({ query, resolvedTableIds, resolvedTags, kpi, ts: Date.now() });
  // LRU eviction
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES);
  }

  save(state);
}

/**
 * Return a boost factor (1.0–2.0) for each tableId based on historical usage.
 * Frequently chosen tables are boosted to surface higher in search results.
 */
export function getTableBoosts(tableIds: string[]): Record<string, number> {
  const state = load();
  const boosts: Record<string, number> = {};
  const maxFreq = Math.max(...Object.values(state.tableFrequency), 1);

  for (const id of tableIds) {
    const freq = state.tableFrequency[id] ?? 0;
    // Linear interpolation: 0 freq → 1.0 boost, maxFreq → 2.0 boost
    boosts[id] = 1 + freq / maxFreq;
  }
  return boosts;
}

/**
 * Return anticipatory table suggestions based purely on past query patterns.
 * Useful for "suggested tables" before the user types anything.
 */
export function getTopTables(limit = 8): string[] {
  const state = load();
  return Object.entries(state.tableFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Return the most frequently used tags — drives the "Suggested filters" UI.
 */
export function getTopTags(limit = 6): string[] {
  const state = load();
  return Object.entries(state.tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Given a partial query, return tag categories the learner predicts the user
 * will need based on vocabulary overlap with historical queries.
 */
export function predictTags(partialQuery: string): string[] {
  // First check thesaurus directly
  const thesaurusTags = suggestTagsForQuery(partialQuery);

  // Then blend with the learner's vocabulary-weighted tag frequency
  const state = load();
  const tokens = partialQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const tagScores: Record<string, number> = {};
  for (const entry of state.entries) {
    // Score how similar this historical entry is to the current query
    const overlap = tokens.filter((tok) => entry.query.toLowerCase().includes(tok)).length;
    if (overlap === 0) continue;
    for (const tag of entry.resolvedTags) {
      tagScores[tag] = (tagScores[tag] ?? 0) + overlap;
    }
  }

  // Merge: thesaurus tags first (direct signal), then learner-predicted tags
  const learnerTags = Object.entries(tagScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);

  return Array.from(new Set([...thesaurusTags.slice(0, 3), ...learnerTags]));
}

/**
 * Return recent query strings for autocomplete/history.
 */
export function getQueryHistory(limit = 10): string[] {
  const state = load();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...state.entries].reverse()) {
    if (!seen.has(e.query)) {
      seen.add(e.query);
      out.push(e.query);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Full state access — used by the Tags panel to display learning stats.
 */
export function getLearnerStats(): Pick<LearnerState, "tableFrequency" | "tagFrequency" | "vocabulary"> & { totalQueries: number } {
  const state = load();
  return {
    tableFrequency: state.tableFrequency,
    tagFrequency: state.tagFrequency,
    vocabulary: state.vocabulary,
    totalQueries: state.entries.length,
  };
}

/** Clear all learned data (GDPR / reset). */
export function clearLearnerData(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
