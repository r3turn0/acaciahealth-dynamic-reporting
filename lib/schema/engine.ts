// ─────────────────────────────────────────────────────────────────────────────
// Report Engine — field discovery, join resolution, aggregation detection,
// filter generation, and ReportPlan building from a parsed SchemaModel
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Column,
  FilterOperator,
  ReportFilter,
  ReportJoin,
  ReportPlan,
  SchemaModel,
} from "./types";

// ── In-memory cache ───────────────────────────────────────────────────────────

let cachedModel: SchemaModel | null = null;

export function setCachedModel(model: SchemaModel) {
  cachedModel = model;
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

    for (const col of table.columns) {
      // Skip audit columns — not useful as selectable fields
      if (col.role === "audit") continue;

      switch (col.role) {
        case "measure":
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

    // Convert path steps to ReportJoins
    for (let j = 0; j < bestPath.length - 1; j++) {
      const from = bestPath[j];
      const to = bestPath[j + 1];
      if (joined.has(to)) continue;
      joined.add(to);

      // Find the FK edge from `from` → `to`
      const edge = model.graph.edges.find(
        (e) => e.from === from && e.to === to && e.type === "many-to-one"
      );

      const fromTableName = from.split(".").pop() ?? from;
      const toTableName = to.split(".").pop() ?? to;

      const fromCol = edge?.fromColumn ?? "id";
      const toCol = edge?.toColumn ?? "id";

      joins.push({
        from,
        to,
        via: edge?.via ?? "",
        fromColumn: fromCol,
        toColumn: toCol,
        condition: `${fromTableName}.${fromCol} = ${toTableName}.${toCol}`,
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
      const agg = (col.aggregation ?? "sum").toUpperCase();
      return {
        table,
        column,
        aggregation: agg,
        alias: `${agg.toLowerCase()}_${col.displayName.replace(/\s+/g, "_").toLowerCase()}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ── 4. Filter Generation ──────────────────────────────────────────────────────

export type FilterDefinition =
  | { kind: "categorical"; table: string; column: string; displayName: string }
  | { kind: "date_range"; table: string; column: string; displayName: string }
  | { kind: "numeric_range"; table: string; column: string; displayName: string; min?: number; max?: number };

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
        filters.push({ kind: "date_range", table: id, column: colName, displayName: col.displayName });
      } else if (col.role === "measure") {
        filters.push({ kind: "numeric_range", table: id, column: colName, displayName: col.displayName });
      } else {
        filters.push({ kind: "categorical", table: id, column: colName, displayName: col.displayName });
      }
    }
  }

  return filters;
}

// ── 5. Keyword Search ─────────────────────────────────────────────────────────

export function searchByKeywords(
  model: SchemaModel,
  query: string
): string[] {
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const scores: Record<string, number> = {};

  for (const keyword of keywords) {
    const exactMatches = model.searchIndex[keyword] ?? [];
    for (const id of exactMatches) {
      scores[id] = (scores[id] ?? 0) + 3;
    }
    for (const [indexKey, ids] of Object.entries(model.searchIndex)) {
      if (indexKey !== keyword && (indexKey.includes(keyword) || keyword.includes(indexKey))) {
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
  const dimensions = input.dimensionColumns.map(({ table, column }) => {
    const col = model.tables[table]?.columns.find((c) => c.name === column);
    return { table, column, alias: col?.displayName.replace(/\s+/g, "_").toLowerCase() ?? column };
  });
  const groupBy = dimensions.map(
    (d) => `${d.table.split(".").pop()}.${d.column}`
  );

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

// ── 7. Suggestion templates ───────────────────────────────────────────────────

export interface ReportSuggestion {
  label: string;
  description: string;
  tables: string[];
  keywords: string[];
  icon: "trending" | "bar" | "join" | "time" | "filter";
}

export function generateSuggestions(model: SchemaModel): ReportSuggestion[] {
  const suggestions: ReportSuggestion[] = [];
  const allTableIds = Object.keys(model.tables);

  for (const id of allTableIds) {
    const hints = model.entityHints[id];
    const table = model.tables[id];
    if (!hints) continue;

    // Time-series suggestion
    if (hints.measures.length > 0 && hints.timeColumns.length > 0) {
      const mCol = model.tables[id]?.columns.find((c) => c.name === hints.measures[0]);
      const tCol = model.tables[id]?.columns.find((c) => c.name === hints.timeColumns[0]);
      suggestions.push({
        label: `${table.name.replace(/_/g, " ")} over time`,
        description: `${mCol?.displayName ?? hints.measures[0]} by ${tCol?.displayName ?? hints.timeColumns[0]}`,
        tables: [id],
        keywords: [table.name.toLowerCase(), "trend", "over time", "by date"],
        icon: "trending",
      });
    }

    // Dimension breakdown suggestion
    if (hints.measures.length > 0 && hints.dimensions.length > 0) {
      const dim = hints.dimensions.find((d) => {
        const bare = d.toLowerCase();
        return bare.includes("branch") || bare.includes("type") || bare.includes("status") || bare.includes("source");
      });
      if (dim) {
        const mCol = model.tables[id]?.columns.find((c) => c.name === hints.measures[0]);
        const dCol = model.tables[id]?.columns.find((c) => c.name === dim);
        suggestions.push({
          label: `${table.name.replace(/_/g, " ")} by ${dCol?.displayName ?? dim}`,
          description: `${mCol?.displayName ?? hints.measures[0]} grouped by ${dCol?.displayName ?? dim}`,
          tables: [id],
          keywords: [table.name.toLowerCase(), dim.toLowerCase(), "by branch", "breakdown"],
          icon: "bar",
        });
      }
    }
  }

  // Cross-table join suggestions (only direct FK joins, not multi-hop)
  for (const edge of model.graph.edges.filter((e) => e.type === "many-to-one")) {
    const source = model.tables[edge.from];
    const target = model.tables[edge.to];
    if (!source || !target) continue;

    const srcHints = model.entityHints[edge.from];
    const tgtHints = model.entityHints[edge.to];
    if (!srcHints?.measures.length) continue;

    const mCol = source.columns.find((c) => c.name === srcHints.measures[0]);
    const dim = tgtHints?.dimensions[0];
    const dCol = dim ? target.columns.find((c) => c.name === dim) : null;

    if (dCol) {
      suggestions.push({
        label: `${source.name.replace(/_/g, " ")} by ${target.name.replace(/_/g, " ")}`,
        description: `${mCol?.displayName ?? srcHints.measures[0]} joined via ${edge.fromColumn} → ${edge.toColumn}`,
        tables: [edge.from, edge.to],
        keywords: [source.name.toLowerCase(), "by", target.name.toLowerCase(), "join"],
        icon: "join",
      });
    }
  }

  // Deduplicate by label and cap at 30
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  }).slice(0, 30);
}
