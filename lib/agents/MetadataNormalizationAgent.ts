/**
 * lib/agents/MetadataNormalizationAgent.ts
 *
 * Parses and normalises any metadata.json payload (uploaded file or live schema)
 * into a canonical NormalisedMetadata shape consumed by:
 *   - VectorEmbeddingAgent (indexing)
 *   - SchemaIntelligenceAgent (graph rebuild)
 *   - DatasetBuilderAgent (join inference)
 *
 * Null-safety rules:
 *   - Every string field is coerced via safeStr() — null/undefined → ""
 *   - Every array field defaults to []
 *   - toLowerCase() is never called on a potentially null value
 *
 * Emits SCHEMA_UPDATED on the EventBus after successful normalisation.
 */

import { eventBus }      from "@/lib/orchestrator/EventBus";
import { agentRegistry } from "@/lib/orchestrator/AgentOfAgents";
import type { Agent }    from "@/lib/orchestrator/AgentOfAgents";
import type { NormalisedMetadata } from "./VectorEmbeddingAgent";

// ── Raw metadata shapes (user-supplied — anything can be null/undefined) ──────

interface RawColumn {
  name?:             unknown;
  columnName?:       unknown;
  column_name?:      unknown;
  data_type?:        unknown;
  type?:             unknown;
  description?:      unknown;
  primary_key?:      unknown;
}

interface RawRelationship {
  fromTable?:   unknown;
  from_table?:  unknown;
  toTable?:     unknown;
  to_table?:    unknown;
  fromColumn?:  unknown;
  from_column?: unknown;
  toColumn?:    unknown;
  to_column?:   unknown;
  from?:        { schema?: unknown; table?: unknown; columns?: unknown[] };
  to?:          { schema?: unknown; table?: unknown; columns?: unknown[] };
}

interface RawTable {
  schema?:         unknown;
  table?:          unknown;
  name?:           unknown;
  tableName?:      unknown;
  table_name?:     unknown;
  description?:    unknown;
  columns?:        unknown[];
  foreign_keys?:   unknown[];
  relationships?:  unknown[];
}

interface RawMetadata {
  tables?:       unknown[];
  entities?:     unknown[];
  kpis?:         unknown[];
  relationships?: unknown[];
}

// ── Input / output ────────────────────────────────────────────────────────────

export interface MetadataNormalisationInput {
  /** Raw parsed metadata.json — any shape */
  raw: unknown;
  /** Source label for the SCHEMA_UPDATED event */
  source?: "upload" | "live_db";
}

export interface MetadataNormalisationOutput {
  normalised:        NormalisedMetadata;
  tableCount:        number;
  columnCount:       number;
  relationshipCount: number;
  warnings:          string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normaliseColumn(raw: unknown): NormalisedMetadata["tables"][0]["columns"][0] | null {
  const c = raw as RawColumn;
  const name = safeStr(c?.name ?? c?.columnName ?? c?.column_name);
  if (!name) return null;
  return {
    columnName:  name,
    type:        safeStr(c?.data_type ?? c?.type) || "unknown",
    description: safeStr(c?.description),
  };
}

function normaliseRelationship(
  raw: unknown,
  tableName: string
): NormalisedMetadata["tables"][0]["relationships"][0] | null {
  const r = raw as RawRelationship;

  // Support both flat and nested FK shapes
  const fromCol = safeStr(r?.fromColumn ?? r?.from_column ?? safeArr(r?.from?.columns)[0]);
  const toTable = safeStr(r?.toTable ?? r?.to_table ?? (r?.to ? `${safeStr(r.to.schema)}.${safeStr(r.to.table)}` : ""));
  const toCol   = safeStr(r?.toColumn ?? r?.to_column ?? safeArr(r?.to?.columns)[0]);

  if (!fromCol || !toTable) return null;
  return { fromColumn: fromCol, toTable, toColumn: toCol };
}

function normaliseTable(raw: unknown): {
  table: NormalisedMetadata["tables"][0];
  warnings: string[];
} | null {
  const t = raw as RawTable;
  const warnings: string[] = [];

  const tableName  = safeStr(t?.tableName ?? t?.table_name ?? t?.table ?? t?.name);
  const tableSchema = safeStr(t?.schema) || "dbo";

  if (!tableName) {
    warnings.push("Skipped table with no name");
    return null;
  }

  const rawCols = safeArr(t?.columns);
  const columns = rawCols
    .map(normaliseColumn)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (columns.length === 0 && rawCols.length > 0) {
    warnings.push(`Table ${tableName}: all ${rawCols.length} columns had no name`);
  }

  const rawRels = safeArr(t?.foreign_keys ?? t?.relationships);
  const relationships = rawRels
    .map((r) => normaliseRelationship(r, tableName))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    table: { tableName, tableSchema, description: safeStr(t?.description), columns, relationships },
    warnings,
  };
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class MetadataNormalizationAgent
  implements Agent<MetadataNormalisationInput, MetadataNormalisationOutput>
{
  readonly name = "MetadataNormalizationAgent";

  async run(input: MetadataNormalisationInput): Promise<MetadataNormalisationOutput> {
    const raw     = input.raw as RawMetadata;
    const source  = input.source ?? "upload";
    const warnings: string[] = [];

    // Accept both `tables` and `entities` as the top-level array
    const rawTables = safeArr(raw?.tables ?? raw?.entities);

    if (rawTables.length === 0) {
      warnings.push("No tables/entities found in metadata payload");
    }

    const tables: NormalisedMetadata["tables"] = [];
    let columnCount = 0;
    let relationshipCount = 0;

    for (const rawTable of rawTables) {
      const result = normaliseTable(rawTable);
      if (!result) continue;
      tables.push(result.table);
      warnings.push(...result.warnings);
      columnCount       += result.table.columns.length;
      relationshipCount += result.table.relationships.length;
    }

    // Normalise KPIs if present
    const kpis: NormalisedMetadata["kpis"] = safeArr(raw?.kpis).map((k) => {
      const kpi = k as Record<string, unknown>;
      return {
        name:        safeStr(kpi?.name),
        description: safeStr(kpi?.description),
        formulaSql:  safeStr(kpi?.formula_sql ?? kpi?.formulaSql),
        dimensions:  safeArr<string>(kpi?.dimensions).map(safeStr),
      };
    }).filter((k) => k.name);

    const normalised: NormalisedMetadata = { tables, kpis };

    // Emit SCHEMA_UPDATED so SchemaIntelligenceAgent + VectorEmbeddingAgent react
    eventBus.emit("SCHEMA_UPDATED", {
      tables:        tables.map((t) => `${t.tableSchema}.${t.tableName}`),
      columnCount,
      relationships: relationshipCount,
      source,
      timestamp:     new Date().toISOString(),
    });

    return { normalised, tableCount: tables.length, columnCount, relationshipCount, warnings };
  }
}

// ── Singleton + auto-register ─────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & { __metadataAgent?: MetadataNormalizationAgent };
if (!_global.__metadataAgent) {
  _global.__metadataAgent = new MetadataNormalizationAgent();
  agentRegistry.register(_global.__metadataAgent);
}

export const metadataNormalizationAgent: MetadataNormalizationAgent = _global.__metadataAgent;
