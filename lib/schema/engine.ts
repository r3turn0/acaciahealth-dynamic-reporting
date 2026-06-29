// ─────────────────────────────────────────────────────────────────────────────
// Report Engine — Uses SchemaModel exclusively for field discovery, join
// resolution, aggregation detection, filter generation, and ReportPlan building
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Column,
  FilterOperator,
  ReportFilter,
  ReportJoin,
  ReportPlan,
  SchemaModel,
  Table,
} from "./types";

// ── In-memory cache ───────────────────────────────────────────────────────────

let cachedModel: SchemaModel | null = null;

export function setCachedModel(model: SchemaModel) {
  cachedModel = model;
  // Persist to sessionStorage on client
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem("schemaModel", JSON.stringify(model));
    } catch { /* quota exceeded */ }
  }
}

export function getCachedModel(): SchemaModel | null {
  if (cachedModel) return cachedModel;
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem("schemaModel");
      if (raw) {
        cachedModel = JSON.parse(raw) as SchemaModel;
        return cachedModel;
      }
    } catch { /* corrupted */ }
  }
  return null;
}

export function clearCachedModel() {
  cachedModel = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("schemaModel");
  }
}

// ── 1. Field Discovery ────────────────────────────────────────────────────────

export interface FieldSuggestions {
  measures: { table: string; column: Column }[];
  dimensions: { table: string; column: Column }[];
  timeColumns: { table: string; column: Column }[];
}

export function discoverFields(
  model: SchemaModel,
  tableIds: string[]
): FieldSuggestions {
  const result: FieldSuggestions = { measures: [], dimensions: [], timeColumns: [] };

  for (const id of tableIds) {
    const table = model.tables[id];
    if (!table) continue;
    const hints = model.entityHints[id];

    for (const col of table.columns) {
      switch (col.role) {
        case "measure":
          if (hints.measures.includes(col.name))
            result.measures.push({ table: id, column: col });
          break;
        case "time_dimension":
          result.timeColumns.push({ table: id, column: col });
          break;
        case "dimension":
          result.dimensions.push({ table: id, column: col });
          break;
      }
    }
  }

  return result;
}

// ── 2. Auto Join Resolution ───────────────────────────────────────────────────

export function resolveJoins(
  model: SchemaModel,
  tableIds: string[]
): ReportJoin[] {
  if (tableIds.length < 2) return [];

  const joins: ReportJoin[] = [];
  const joined = new Set<string>([tableIds[0]]);

  for (let i = 1; i < tableIds.length; i++) {
    const target = tableIds[i];
    if (joined.has(target)) continue;

    // Find shortest path from any already-joined table to target
    let bestPath: string[] | null = null;
    for (const source of joined) {
      const path = model.joinPaths[source]?.[target];
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
      }
    }

    if (!bestPath) continue;

    // Convert path to joins
    for (let j = 0; j < bestPath.length - 1; j++) {
      const from = bestPath[j];
      const to = bestPath[j + 1];

      if (joined.has(to)) continue;
      joined.add(to);

      // Find the FK column
      const fromTable = model.tables[from];
      const fk = fromTable?.foreignKeys.find((f) => f.references.table === to);
      const edge = model.graph.edges.find(
        (e) => e.from === from && e.to === to
      );

      joins.push({
        from,
        to,
        via: fk?.column ?? edge?.via ?? "id",
        condition: fk
          ? `${from.split(".")[1]}.${fk.column} = ${to.split(".")[1]}.${fk.references.column}`
          : undefined,
      });
    }
  }

  return joins;
}

// ── 3. Aggregation Detection ──────────────────────────────────────────────────

export function detectAggregations(
  model: SchemaModel,
  selectedColumns: { table: string; column: string }[]
): { table: string; column: string; aggregation: string; alias: string }[] {
  return selectedColumns
    .map(({ table, column }) => {
      const tableObj = model.tables[table];
      const col = tableObj?.columns.find((c) => c.name === column);
      if (!col || col.role !== "measure") return null;
      const agg = col.aggregation ?? "SUM";
      return {
        table,
        column,
        aggregation: agg.toUpperCase(),
        alias: `${agg.toLowerCase()}_${column}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ── 4. Filter Generation ──────────────────────────────────────────────────────

export type FilterDefinition =
  | { kind: "categorical"; table: string; column: string; options?: string[] }
  | { kind: "date_range"; table: string; column: string }
  | { kind: "numeric_range"; table: string; column: string; min?: number; max?: number };

export function generateFilterDefinitions(
  model: SchemaModel,
  tableIds: string[]
): FilterDefinition[] {
  const filters: FilterDefinition[] = [];

  for (const id of tableIds) {
    const hints = model.entityHints[id];
    if (!hints) continue;

    for (const colName of hints.commonFilters) {
      const table = model.tables[id];
      const col = table?.columns.find((c) => c.name === colName);
      if (!col) continue;

      if (col.role === "time_dimension") {
        filters.push({ kind: "date_range", table: id, column: colName });
      } else if (col.role === "measure") {
        filters.push({ kind: "numeric_range", table: id, column: colName });
      } else {
        filters.push({ kind: "categorical", table: id, column: colName });
      }
    }
  }

  return filters;
}

// ── 5. Natural Query Mapping ──────────────────────────────────────────────────

export function searchByKeywords(
  model: SchemaModel,
  query: string
): string[] {
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const scores: Record<string, number> = {};

  for (const keyword of keywords) {
    // Exact match
    const exactMatches = model.searchIndex[keyword] ?? [];
    for (const id of exactMatches) {
      scores[id] = (scores[id] ?? 0) + 2;
    }
    // Partial match
    for (const [indexKey, ids] of Object.entries(model.searchIndex)) {
      if (indexKey.includes(keyword) || keyword.includes(indexKey)) {
        for (const id of ids) {
          scores[id] = (scores[id] ?? 0) + 1;
        }
      }
    }
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

// ── 6. Report Plan Builder ────────────────────────────────────────────────────

export interface ReportPlanInput {
  tableIds: string[];
  measureColumns: { table: string; column: string }[];
  dimensionColumns: { table: string; column: string }[];
  filters: ReportFilter[];
  timeRange?: { table: string; column: string; start: string; end: string };
  limit?: number;
}

export function buildReportPlan(
  model: SchemaModel,
  input: ReportPlanInput
): ReportPlan {
  const joins = resolveJoins(model, input.tableIds);
  const measures = detectAggregations(model, input.measureColumns);
  const dimensions = input.dimensionColumns.map(({ table, column }) => ({
    table,
    column,
    alias: column,
  }));
  const groupBy = dimensions.map((d) => `${d.table.split(".").pop()}.${d.column}`);

  return {
    tables: input.tableIds,
    joins,
    measures,
    dimensions,
    filters: input.filters,
    groupBy,
    timeRange: input.timeRange,
    limit: input.limit ?? 1000,
  };
}

// ── Suggestion templates ──────────────────────────────────────────────────────

export interface ReportSuggestion {
  label: string;
  description: string;
  tables: string[];
  keywords: string[];
  icon: string;
}

export function generateSuggestions(model: SchemaModel): ReportSuggestion[] {
  const suggestions: ReportSuggestion[] = [];
  const allTableIds = Object.keys(model.tables);

  for (const id of allTableIds) {
    const hints = model.entityHints[id];
    const table = model.tables[id];
    if (!hints) continue;

    if (hints.measures.length > 0 && hints.timeColumns.length > 0) {
      suggestions.push({
        label: `${table.name} trends over time`,
        description: `${hints.measures[0]} grouped by ${hints.timeColumns[0]}`,
        tables: [id],
        keywords: [table.name.toLowerCase(), "trend", "over time"],
        icon: "trending",
      });
    }

    if (hints.measures.length > 0 && hints.dimensions.length > 0) {
      const dim = hints.dimensions.find(
        (d) =>
          d.toLowerCase().includes("branch") ||
          d.toLowerCase().includes("type") ||
          d.toLowerCase().includes("status")
      );
      if (dim) {
        suggestions.push({
          label: `${table.name} by ${dim}`,
          description: `${hints.measures[0]} grouped by ${dim}`,
          tables: [id],
          keywords: [table.name.toLowerCase(), dim.toLowerCase(), "by"],
          icon: "bar",
        });
      }
    }
  }

  // Cross-table suggestions from join paths
  for (const [sourceId, paths] of Object.entries(model.joinPaths)) {
    for (const [targetId] of Object.entries(paths)) {
      if (sourceId === targetId) continue;
      const source = model.tables[sourceId];
      const target = model.tables[targetId];
      if (!source || !target) continue;

      const srcHints = model.entityHints[sourceId];
      const tgtHints = model.entityHints[targetId];
      if (!srcHints?.measures.length || !tgtHints?.dimensions.length) continue;

      suggestions.push({
        label: `${source.name} by ${target.name}`,
        description: `Aggregate ${srcHints.measures[0]} joined through ${target.name}`,
        tables: [sourceId, targetId],
        keywords: [source.name.toLowerCase(), "by", target.name.toLowerCase()],
        icon: "join",
      });
    }
  }

  return suggestions.slice(0, 20);
}
