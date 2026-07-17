/**
 * lib/agents/RelationshipBuilderAgent.ts
 *
 * Orchestrates the full relationship inference pipeline for a proposed column
 * join.  Combines:
 *
 *   1. VectorEmbeddingAgent.semanticJoinSearch  — semantic context from the
 *      corpus (prior FK relationships, table descriptions, KPI definitions)
 *   2. inferRelationship (relationshipService)  — 3-signal deterministic scoring
 *      (metadata FK + naming heuristics + vector boost)
 *   3. buildJoinClause / buildDatasetSQL (sqlBuilder) — executable T-SQL output
 *
 * Registered with agentRegistry so AgentOfAgents can dispatch to it by name.
 *
 * Input shape  → RelationshipInput
 * Output shape → RelationshipOutput
 */

import { vectorEmbeddingAgent } from "./VectorEmbeddingAgent";
import { inferRelationship, type ColumnRef, type NormalisedMetadata, type InferenceResult } from "@/lib/services/relationshipService";
import { buildJoinClause, buildDatasetSQL, validateJoinGraph, type JoinEdge, type BuildDatasetSQLOptions } from "@/lib/services/sqlBuilder";
import { agentRegistry } from "@/lib/orchestrator/AgentOfAgents";
import type { Agent } from "@/lib/orchestrator/AgentOfAgents";
import type { VectorSearchResult } from "@/lib/ai/vectorSearch";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface RelationshipInput {
  /** The "from" side of the proposed join */
  sourceColumn: ColumnRef;
  /** The "to" side of the proposed join */
  targetColumn: ColumnRef;
  /** Normalised metadata — FK registry + column types */
  metadata: NormalisedMetadata;
  /**
   * Join type override.
   * Pass "auto" to let the agent decide based on inference confidence.
   * Explicit values ("LEFT", "INNER", "RIGHT", "FULL") are passed through.
   */
  joinType?: "auto" | "LEFT" | "INNER" | "RIGHT" | "FULL";
  /**
   * Optional existing join graph — if provided the new edge is appended and
   * full multi-table SQL is generated.
   */
  existingJoins?: JoinEdge[];
  /** Columns to SELECT in the full dataset SQL (optional) */
  columns?: BuildDatasetSQLOptions["columns"];
  /** Row limit for preview — defaults to 1000 */
  limit?: number;
}

export interface RelationshipOutput {
  /** Single JOIN clause for this edge */
  joinClause: string;
  /** Full executable SELECT...FROM...JOIN SQL (if existingJoins provided) */
  datasetSQL?: string;
  /** Graph update payload ready for state / storage */
  relationshipGraphUpdate: {
    sourceTable:  string;
    sourceColumn: string;
    targetTable:  string;
    targetColumn: string;
    joinType:     string;
    confidence:   number;
  };
  confidenceScore:  number;
  warnings:         string[];
  explanation:      string;
  signals:          InferenceResult["signals"];
  semanticMatches:  VectorSearchResult[];
  /** Aliases map: tableName → short alias used in the generated SQL */
  aliases:          Record<string, string>;
  /** SQL validation warnings from the join graph */
  graphWarnings:    string[];
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class RelationshipBuilderAgent implements Agent<RelationshipInput, RelationshipOutput> {
  readonly name = "RelationshipBuilderAgent";

  async run(input: RelationshipInput): Promise<RelationshipOutput> {
    const {
      sourceColumn,
      targetColumn,
      metadata,
      joinType = "auto",
      existingJoins = [],
      columns,
      limit = 1000,
    } = input;

    // ── Step 1: Vector semantic search ──────────────────────────────────────
    // Build a semantic query that captures the intent of joining these two columns.
    // Uses the enhanced semanticJoinSearch method added to VectorEmbeddingAgent.
    const sourceFqn = `${sourceColumn.table}.${sourceColumn.column}`;
    const targetFqn = `${targetColumn.table}.${targetColumn.column}`;

    let semanticMatches: VectorSearchResult[] = [];
    try {
      semanticMatches = await vectorEmbeddingAgent.semanticJoinSearch(
        sourceFqn,
        targetFqn,
        6,
      );
    } catch {
      // Non-fatal — proceed with zero vector boost
    }

    // ── Step 2: Deterministic inference ─────────────────────────────────────
    const inference = inferRelationship(
      sourceColumn,
      targetColumn,
      metadata,
      semanticMatches,
    );

    // Resolve join type: auto = use inference result, explicit = honour user choice
    const resolvedJoinType =
      joinType === "auto" ? inference.joinType : joinType;

    // ── Step 3: Build JOIN clause ────────────────────────────────────────────
    const newEdge: JoinEdge = {
      sourceTable:  sourceColumn.table,
      sourceColumn: sourceColumn.column,
      targetTable:  targetColumn.table,
      targetColumn: targetColumn.column,
      joinType:     resolvedJoinType,
    };

    // Build alias map for source + target (at minimum)
    const baseTableForAlias = existingJoins.length > 0
      ? existingJoins[0].sourceTable
      : sourceColumn.table;

    const allEdges = [...existingJoins, newEdge];
    const allTables = [
      baseTableForAlias,
      ...allEdges.map((j) => j.targetTable),
    ];
    const uniqueTables = [...new Set(allTables)];

    // Build aliases by reusing sqlBuilder's internal logic via a minimal call
    const { aliases } = buildDatasetSQL({
      baseTable: baseTableForAlias,
      joins: allEdges,
      columns: [],
      limit: 1,
    });

    const joinClause = buildJoinClause(newEdge, aliases);

    // ── Step 4: Full dataset SQL (if graph context available) ─────────────
    let datasetSQL: string | undefined;
    let graphWarnings: string[] = [];

    const baseTable = existingJoins.length > 0
      ? existingJoins[0].sourceTable
      : sourceColumn.table;

    if (existingJoins.length > 0 || columns?.length) {
      const result = buildDatasetSQL({
        baseTable,
        joins: allEdges,
        columns,
        limit,
      });
      datasetSQL    = result.sql;
      graphWarnings = result.warnings;
    } else {
      // Validate graph even without full SQL generation
      graphWarnings = validateJoinGraph(baseTable, allEdges, aliases);
    }

    return {
      joinClause,
      datasetSQL,
      relationshipGraphUpdate: {
        sourceTable:  sourceColumn.table,
        sourceColumn: sourceColumn.column,
        targetTable:  targetColumn.table,
        targetColumn: targetColumn.column,
        joinType:     resolvedJoinType,
        confidence:   inference.confidenceScore,
      },
      confidenceScore: inference.confidenceScore,
      warnings:        [...inference.warnings, ...graphWarnings.filter((w) => !w.startsWith("ERROR"))],
      explanation:     inference.explanation,
      signals:         inference.signals,
      semanticMatches,
      aliases,
      graphWarnings,
    };
  }
}

// ── Singleton + auto-register ─────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & {
  __relationshipBuilderAgent?: RelationshipBuilderAgent;
};
if (!_global.__relationshipBuilderAgent) {
  _global.__relationshipBuilderAgent = new RelationshipBuilderAgent();
  agentRegistry.register(_global.__relationshipBuilderAgent);
}

export const relationshipBuilderAgent: RelationshipBuilderAgent =
  _global.__relationshipBuilderAgent;
