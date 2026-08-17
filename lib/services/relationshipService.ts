/**
 * lib/services/relationshipService.ts
 *
 * Deterministic relationship inference engine.
 *
 * Merges three signal layers in order of reliability:
 *   1. Metadata FK match   — explicit FK defined in normalised metadata
 *   2. Naming heuristics   — column name equality, _id/_code suffix patterns
 *   3. Vector semantic boost — similarity results from VectorEmbeddingAgent
 *
 * Returns a typed InferenceResult with confidence (0–1), join type, warnings,
 * and a human-readable explanation of how the score was built.
 */

import type { VectorSearchResult } from "@/lib/ai/vectorSearch";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnRef {
  /** Fully-qualified or bare table name, e.g. "dbo.CLIENT_EPISODES_ALL" or "BRANCHES" */
  table:  string;
  /** Column name, e.g. "epi_id" */
  column: string;
  /** SQL Server data type reported by the schema, e.g. "int", "varchar" */
  type?:  string;
}

export interface MetadataRelationship {
  fromTable:  string;
  fromColumn: string;
  toTable:    string;
  toColumn:   string;
  /** Optional explicit join type from the metadata definition */
  joinType?:  "LEFT" | "INNER" | "RIGHT" | "FULL";
}

export interface NormalisedMetadata {
  relationships: MetadataRelationship[];
  columns?: { tableName: string; columnName: string; type?: string }[];
}

export type JoinType = "LEFT" | "INNER" | "RIGHT" | "FULL";

export interface InferenceResult {
  joinType:        JoinType;
  /** Backward-compatible normalized score (0–1). */
  confidenceScore: number;
  /** Standardized intelligence score (0–100). */
  confidencePercent: number;
  confidenceBand: "verified" | "strong" | "possible" | "rejected";
  authoritative: boolean;
  validationSource: "explicit_constraint" | "inferred";
  warnings:        string[];
  explanation:     string;
  signals:         SignalLog[];
}

interface SignalLog {
  signal:     string;
  delta:      number;
  cumulative: number;
  detail:     string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip schema prefix for bare-name comparisons */
function bareTable(t: string): string {
  return t.includes(".") ? t.split(".").pop()! : t;
}

/** Case-insensitive equality helper */
function eqCI(a: string, b: string): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

const FK_SUFFIXES = ["_id", "_key", "_code", "_num", "_ref", "_no"] as const;

/** Return the stem of a column name by stripping a known FK suffix */
function fkStem(col: string): string | null {
  const lower = col.toLowerCase();
  for (const suf of FK_SUFFIXES) {
    if (lower.endsWith(suf) && lower.length > suf.length) {
      return lower.slice(0, lower.length - suf.length).replace(/_$/, "");
    }
  }
  return null;
}

// ── Core inference function ───────────────────────────────────────────────────

/**
 * Infer the relationship between two column references.
 *
 * @param source         - The "from" side of the proposed join
 * @param target         - The "to" side of the proposed join
 * @param metadata       - Normalised schema metadata (FK registry + column types)
 * @param semanticMatches - Results from VectorEmbeddingAgent.semanticJoinSearch()
 */
export function inferRelationship(
  source:          ColumnRef,
  target:          ColumnRef,
  metadata:        NormalisedMetadata,
  semanticMatches: VectorSearchResult[],
): InferenceResult {
  const warnings: string[] = [];
  const signals:  SignalLog[] = [];
  let confidence = 0;

  function applySignal(signal: string, delta: number, detail: string) {
    confidence = Math.min(1, Math.max(0, confidence + delta));
    signals.push({ signal, delta, cumulative: confidence, detail });
  }

  const srcTable = bareTable(source.table);
  const tgtTable = bareTable(target.table);
  const srcCol   = source.column.toLowerCase();
  const tgtCol   = target.column.toLowerCase();

  // ── Signal 1: Explicit metadata FK match (highest trust) ─────────────────
  const exactFk = (metadata.relationships ?? []).find(
    (r) =>
      eqCI(bareTable(r.fromTable), srcTable) &&
      eqCI(r.fromColumn, source.column) &&
      eqCI(bareTable(r.toTable),   tgtTable) &&
      eqCI(r.toColumn,   target.column),
  );
  if (exactFk) {
    applySignal("metadata_fk_exact", 0.6, `Explicit FK: ${source.table}.${source.column} → ${target.table}.${target.column}`);
  }

  // Reverse direction FK (user dragged target → source, still valid)
  const reverseFk = !exactFk && (metadata.relationships ?? []).find(
    (r) =>
      eqCI(bareTable(r.fromTable), tgtTable) &&
      eqCI(r.fromColumn, target.column) &&
      eqCI(bareTable(r.toTable),   srcTable) &&
      eqCI(r.toColumn,   source.column),
  );
  if (reverseFk) {
    applySignal("metadata_fk_reverse", 0.5, `Reverse FK: ${target.table}.${target.column} → ${source.table}.${source.column}`);
    warnings.push("Join direction reversed from metadata FK definition — consider swapping source/target.");
  }

  // ── Signal 2: Exact column name match ────────────────────────────────────
  if (eqCI(source.column, target.column)) {
    applySignal("name_exact_match", 0.2, `Both columns named "${source.column}"`);
  }

  // ── Signal 3: FK suffix pattern ──────────────────────────────────────────
  //  e.g. epi_id (source) → epi_id (target)  or  epi_id → id in EPISODES table
  const srcStem = fkStem(srcCol);
  const tgtStem = fkStem(tgtCol);

  if (srcStem && tgtCol === "id") {
    // source has _id suffix and target column is "id"
    if (bareTable(target.table).toLowerCase().startsWith(srcStem) ||
        bareTable(target.table).toLowerCase().includes(srcStem)) {
      applySignal("fk_suffix_to_pk", 0.25,
        `"${source.column}" looks like FK into "${target.table}".id`);
    }
  } else if (tgtStem && srcCol === "id") {
    applySignal("fk_suffix_reverse", 0.2,
      `"${target.column}" looks like FK into "${source.table}".id`);
  } else if (srcStem && tgtStem && srcStem === tgtStem) {
    // e.g. patient_id ↔ patient_id in different tables
    applySignal("fk_shared_stem", 0.15,
      `Shared FK stem "${srcStem}" on both sides`);
  }

  // ── Signal 4: _id heuristic (both cols end in _id) ───────────────────────
  if (srcCol.endsWith("_id") && tgtCol.endsWith("_id") && !exactFk) {
    applySignal("both_id_suffix", 0.1, `Both columns end with _id`);
  }

  // ── Signal 5: Vector semantic boost ──────────────────────────────────────
  if (semanticMatches.length > 0) {
    // Weight by average similarity score of top-3 matches
    const topScores = semanticMatches.slice(0, 3).map((r) => r.score);
    const avgScore  = topScores.reduce((s, v) => s + v, 0) / topScores.length;
    const delta     = parseFloat((avgScore * 0.15).toFixed(3)); // max +0.15
    applySignal("vector_semantic", delta,
      `${semanticMatches.length} semantic match(es), avg score ${avgScore.toFixed(3)}`);
  }

  // ── Signal 6: Data type check ─────────────────────────────────────────────
  if (source.type && target.type) {
    const normalise = (t: string) => t.toLowerCase().replace(/\(.*/g, "").trim();
    const st = normalise(source.type);
    const tt = normalise(target.type);
    // Treat int/bigint/smallint/tinyint as compatible
    const isIntFamily = (t: string) => ["int", "bigint", "smallint", "tinyint"].includes(t);
    const compatible  = st === tt || (isIntFamily(st) && isIntFamily(tt));
    if (!compatible) {
      applySignal("type_mismatch_penalty", -0.3,
        `Data type mismatch: ${source.type} vs ${target.type}`);
      warnings.push(`Data type mismatch: ${source.table}.${source.column} is ${source.type} but ${target.table}.${target.column} is ${target.type}.`);
    }
  }

  // ── Clamp and determine join type ────────────────────────────────────────
  confidence = parseFloat(Math.max(0, Math.min(1, confidence)).toFixed(3));

  // Prefer the metadata-declared join type if available, otherwise LEFT
  const fkJoinType = (exactFk || reverseFk || undefined)?.joinType;
  let joinType: JoinType = fkJoinType ?? "LEFT";

  // Low confidence → warn, still emit LEFT JOIN but flag it
  if (confidence < 0.3 && !exactFk && !reverseFk) {
    warnings.push("Low confidence join — no explicit FK found and naming patterns are weak.");
  }

  // Build explanation
  const signalSummary = signals
    .map((s) => `${s.signal}(${s.delta >= 0 ? "+" : ""}${s.delta})`)
    .join(" + ");
  const explanation =
    `Confidence ${confidence.toFixed(2)} via: ${signalSummary || "no matching signals"}. ` +
    `Join type: ${joinType}.`;

  const explicitConstraint = Boolean(exactFk || reverseFk);
  const confidencePercent = explicitConstraint
    ? Math.max(95, Math.round(confidence * 100))
    : Math.round(confidence * 100);
  const confidenceBand = confidencePercent >= 95
    ? "verified"
    : confidencePercent >= 80
      ? "strong"
      : confidencePercent >= 60
        ? "possible"
        : "rejected";
  if (confidenceBand === "rejected") {
    warnings.push("Relationship rejected for automatic use because confidence is below 60%.");
  }

  return {
    joinType,
    confidenceScore: confidence,
    confidencePercent,
    confidenceBand,
    authoritative: explicitConstraint,
    validationSource: explicitConstraint ? "explicit_constraint" : "inferred",
    warnings,
    explanation,
    signals,
  };
}
