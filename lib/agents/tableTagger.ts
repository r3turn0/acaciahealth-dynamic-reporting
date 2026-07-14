// ─────────────────────────────────────────────────────────────────────────────
// Table Tagger — Healthcare Semantic Auto-Tagger
//
// Scores every table in a SchemaModel against the healthcareThesaurus, assigns
// tags, and persists user overrides.  Pure TypeScript, zero external deps.
// ─────────────────────────────────────────────────────────────────────────────

import type { Table } from "@/lib/schema/types";
import thesaurus from "@/lib/config/healthcareThesaurus.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TagCategory {
  id: string;
  label: string;
  color: TagColor;
  description: string;
}

export type TagColor =
  | "blue" | "purple" | "green" | "orange" | "teal" | "yellow"
  | "red" | "indigo" | "pink" | "cyan" | "amber" | "slate";

export interface TableTag {
  tableId: string;
  tags: string[];          // tag category ids e.g. ["admissions","billing"]
  confidence: Record<string, number>;  // category → 0-1 confidence score
  autoTags: string[];      // tags assigned automatically
  userTags: string[];      // tags added/removed manually
  lastTagged: string;      // ISO date
}

export type TagStore = Record<string, TableTag>;  // tableId → TableTag

// ── Thesaurus helpers ─────────────────────────────────────────────────────────

type ThesaurusShape = typeof thesaurus;
type TagId = keyof ThesaurusShape["tags"];

const TAG_IDS = Object.keys(thesaurus.tags) as TagId[];

export const TAG_CATEGORIES: TagCategory[] = TAG_IDS.map((id) => ({
  id,
  label: thesaurus.tags[id].label,
  color: thesaurus.tags[id].color as TagColor,
  description: thesaurus.tags[id].description,
}));

// Pre-build a Set of terms per tag for O(1) lookup
const TERM_SETS: Record<TagId, Set<string>> = {} as Record<TagId, Set<string>>;
for (const id of TAG_IDS) {
  TERM_SETS[id] = new Set(thesaurus.tags[id].terms.map((t) => t.toLowerCase()));
}

// ── Corpus builder ────────────────────────────────────────────────────────────

/** Returns all searchable text tokens for a table as one lowercase string. */
function buildTableCorpus(table: Table): string {
  const parts: string[] = [
    table.name,
    table.schema,
    table.domain,
    table.entityType,
    table.description ?? "",
    ...table.columns.map((c) => `${c.name} ${c.displayName} ${c.description ?? ""}`),
    ...table.foreignKeys.map((fk) => fk.name),
    ...table.meta.indexes,
    ...table.meta.triggers,
  ];
  return parts.join(" ").toLowerCase();
}

// ── Scoring algorithm ─────────────────────────────────────────────────────────
// Uses a two-pass approach:
//   Pass 1 — exact multi-word phrase matching (higher weight)
//   Pass 2 — single-word token matching with word boundaries
//
// Score normalisation: score / max_possible → 0-1 confidence

function scoreTableForTag(corpus: string, tagId: TagId): number {
  const terms = thesaurus.tags[tagId].terms;
  let score = 0;

  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.includes(" ")) {
      // Multi-word phrase — exact substring match
      if (corpus.includes(t)) score += 3;
    } else {
      // Single word — word-boundary match to avoid false positives
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, "g");
      const hits = (corpus.match(re) ?? []).length;
      if (hits > 0) score += Math.min(hits, 5); // cap repeated hits at 5
    }
  }

  // Normalise to 0-1 by dividing by terms.length (theoretical max is 5 per term)
  return Math.min(score / (terms.length * 5), 1);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tag confidence threshold ───────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.04; // ~4% of max-possible score before a tag fires

// ── Main auto-tagger ──────────────────────────────────────────────────────────

/** Compute auto-tags for a single table. Does not write to any store. */
export function autoTagTable(table: Table): Omit<TableTag, "userTags"> {
  const corpus = buildTableCorpus(table);
  const confidence: Record<string, number> = {};
  const autoTags: string[] = [];

  for (const id of TAG_IDS) {
    const score = scoreTableForTag(corpus, id);
    confidence[id] = score;
    if (score >= CONFIDENCE_THRESHOLD) {
      autoTags.push(id);
    }
  }

  // Sort tags by confidence descending for consistent display order
  autoTags.sort((a, b) => (confidence[b] ?? 0) - (confidence[a] ?? 0));

  return {
    tableId: table.id,
    tags: autoTags,
    confidence,
    autoTags,
    lastTagged: new Date().toISOString(),
  };
}

/** Tag all tables and return a TagStore. Applies any existing user overrides. */
export function tagAllTables(
  tables: Table[],
  existing?: TagStore
): TagStore {
  const store: TagStore = {};

  for (const table of tables) {
    const auto = autoTagTable(table);
    const prev = existing?.[table.id];

    // User overrides: if a user explicitly added/removed tags, honour them
    const userTags: string[] = prev?.userTags ?? [];
    const merged = Array.from(
      new Set([...auto.autoTags, ...userTags])
    ).filter((t) => !prev?.userTags?.includes(`-${t}`)); // `-tag` prefix = user removal

    store[table.id] = {
      ...auto,
      tags: merged,
      userTags,
    };
  }

  return store;
}

// ── User override helpers ─────────────────────────────────────────────────────

/** Add a user-defined tag to a table entry. */
export function addUserTag(store: TagStore, tableId: string, tag: string): TagStore {
  const entry = store[tableId];
  if (!entry) return store;
  const userTags = Array.from(new Set([...entry.userTags.filter((t) => t !== `-${tag}`), tag]));
  const tags = Array.from(new Set([...entry.autoTags, ...userTags.filter((t) => !t.startsWith("-"))]));
  return { ...store, [tableId]: { ...entry, tags, userTags, lastTagged: new Date().toISOString() } };
}

/** Remove a tag from a table (adds a suppression marker to userTags). */
export function removeUserTag(store: TagStore, tableId: string, tag: string): TagStore {
  const entry = store[tableId];
  if (!entry) return store;
  const userTags = Array.from(new Set([...entry.userTags.filter((t) => t !== tag), `-${tag}`]));
  const tags = entry.tags.filter((t) => t !== tag);
  return { ...store, [tableId]: { ...entry, tags, userTags, lastTagged: new Date().toISOString() } };
}

// ── Search using tags ─────────────────────────────────────────────────────────

/** Return table IDs that match ANY of the requested tag categories. */
export function findTablesByTag(store: TagStore, tagIds: string[]): string[] {
  const set = new Set(tagIds);
  return Object.values(store)
    .filter((entry) => entry.tags.some((t) => set.has(t)))
    .sort((a, b) => {
      // Sort by sum of matching-tag confidence scores
      const scoreA = tagIds.reduce((s, t) => s + (a.confidence[t] ?? 0), 0);
      const scoreB = tagIds.reduce((s, t) => s + (b.confidence[t] ?? 0), 0);
      return scoreB - scoreA;
    })
    .map((e) => e.tableId);
}

/** Suggest tags for an arbitrary query string (same mechanism as table scoring). */
export function suggestTagsForQuery(query: string): string[] {
  const corpus = query.toLowerCase();
  const scored: { id: string; score: number }[] = [];

  for (const id of TAG_IDS) {
    const score = scoreTableForTag(corpus, id);
    if (score > 0) scored.push({ id, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.id);
}
