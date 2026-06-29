// ─────────────────────────────────────────────────────────────────────────────
// Schema Transformer — Builds SchemaModel from normalized Table[]
// Graph construction, BFS join path computation, search index, entity hints
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EntityHints,
  Graph,
  GraphEdge,
  RawMetadata,
  SchemaModel,
  Table,
} from "./types";
import { createHash } from "crypto";

// ── Graph construction ────────────────────────────────────────────────────────

function buildGraph(tables: Table[]): Graph {
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const tableIds = new Set(tables.map((t) => t.id));

  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      const to = fk.references.table;
      if (!tableIds.has(to)) continue;

      const forwardKey = `${table.id}>${to}:${fk.column}`;
      if (edgeKeys.has(forwardKey)) continue;
      edgeKeys.add(forwardKey);

      edges.push({
        from: table.id,
        to,
        via: fk.name,
        fromColumn: fk.column,
        toColumn: fk.references.column,
        type: "many-to-one",
      });

      const reverseKey = `${to}>${table.id}:${fk.column}`;
      if (!edgeKeys.has(reverseKey)) {
        edgeKeys.add(reverseKey);
        edges.push({
          from: to,
          to: table.id,
          via: fk.name,
          fromColumn: fk.references.column,
          toColumn: fk.column,
          type: "one-to-many",
        });
      }
    }
  }

  return { nodes: tables, edges };
}

// ── BFS join path computation ─────────────────────────────────────────────────

function bfsJoinPaths(graph: Graph): Record<string, Record<string, string[]>> {
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }

  const allIds = graph.nodes.map((n) => n.id);
  const joinPaths: Record<string, Record<string, string[]>> = {};

  for (const source of allIds) {
    joinPaths[source] = {};
    const visited = new Set<string>([source]);
    const queue: { node: string; path: string[] }[] = [{ node: source, path: [source] }];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      const neighbors = adjacency.get(node) ?? [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        const newPath = [...path, neighbor];
        joinPaths[source][neighbor] = newPath;
        // Cap path length at 4 to keep cross-schema joins manageable
        if (newPath.length < 5) {
          queue.push({ node: neighbor, path: newPath });
        }
      }
    }
  }

  return joinPaths;
}

// ── Search index ──────────────────────────────────────────────────────────────

function buildSearchIndex(
  tables: Table[],
  providedIndex?: Record<string, string[]>
): Record<string, string[]> {
  const index: Record<string, string[]> = { ...(providedIndex ?? {}) };

  function add(keyword: string, tableId: string) {
    const k = keyword.toLowerCase().trim();
    if (!k || k.length < 2) return;
    if (!index[k]) index[k] = [];
    if (!index[k].includes(tableId)) index[k].push(tableId);
  }

  for (const table of tables) {
    // Table name words
    table.name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[_\s]+/)
      .filter(Boolean)
      .forEach((w) => add(w, table.id));

    add(table.name, table.id);
    add(table.schema, table.id);
    add(table.domain, table.id);
    add(table.entityType, table.id);

    if (table.description) {
      table.description.split(/\s+/).forEach((w) => add(w, table.id));
    }

    // Column names — both raw and display names
    for (const col of table.columns) {
      col.name.split(/[_\s]+/).filter(Boolean).forEach((w) => add(w, table.id));
      col.displayName.split(/\s+/).filter(Boolean).forEach((w) => add(w, table.id));
    }

    // FK target table names (so searching "branches" surfaces tables that join to BRANCHES)
    for (const fk of table.foreignKeys) {
      const refTableName = fk.references.table.split(".").pop() ?? "";
      refTableName.split(/[_\s]+/).filter(Boolean).forEach((w) => add(w, table.id));
    }

    // Trigger/index names often contain domain keywords
    for (const trigger of table.meta.triggers) {
      trigger.split(/[_\s]+/).filter(Boolean).forEach((w) => add(w.toLowerCase(), table.id));
    }
  }

  return index;
}

// ── Domain grouping ───────────────────────────────────────────────────────────

function buildDomains(
  tables: Table[],
  providedDomains?: Record<string, string[]>
): Record<string, string[]> {
  const domains: Record<string, string[]> = { ...(providedDomains ?? {}) };

  for (const table of tables) {
    if (!domains[table.domain]) domains[table.domain] = [];
    if (!domains[table.domain].includes(table.id)) {
      domains[table.domain].push(table.id);
    }
  }

  return domains;
}

// ── Entity hints ──────────────────────────────────────────────────────────────

function buildEntityHints(tables: Table[]): Record<string, EntityHints> {
  const hints: Record<string, EntityHints> = {};

  for (const table of tables) {
    const measures: string[] = [];
    const dimensions: string[] = [];
    const timeColumns: string[] = [];
    const auditColumns: string[] = [];
    const commonFilters: string[] = [];

    for (const col of table.columns) {
      switch (col.role) {
        case "measure":
          if (!col.isComputed) measures.push(col.name); // skip computed columns as base measures
          break;
        case "time_dimension":
          timeColumns.push(col.name);
          commonFilters.push(col.name);
          break;
        case "dimension":
          dimensions.push(col.name);
          {
            const bare = col.name.toLowerCase();
            if (
              bare.includes("status") || bare.includes("type") ||
              bare.includes("code") || bare.includes("branch") ||
              bare.includes("source") || bare.includes("desc")
            ) {
              commonFilters.push(col.name);
            }
          }
          break;
        case "audit":
          auditColumns.push(col.name);
          break;
      }
    }

    hints[table.id] = {
      measures,
      dimensions,
      timeColumns,
      auditColumns,
      primaryKey: table.primaryKey,
      commonFilters: [...new Set(commonFilters)],
    };
  }

  return hints;
}

// ── SHA-256 hash ──────────────────────────────────────────────────────────────

function hashMetadata(tables: Table[]): string {
  const str = tables.map((t) => `${t.id}:${t.columns.length}:${t.foreignKeys.length}`).sort().join("|");
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

// ── Main transform function ───────────────────────────────────────────────────

export function transformToSchemaModel(
  tables: Table[],
  rawMeta?: RawMetadata
): SchemaModel {
  const tableMap: Record<string, Table> = {};
  for (const t of tables) {
    tableMap[t.id] = t;
  }

  const graph = buildGraph(tables);
  const joinPaths = bfsJoinPaths(graph);
  const searchIndex = buildSearchIndex(tables, rawMeta?.searchIndex);
  const domains = buildDomains(tables, rawMeta?.domains);
  const entityHints = buildEntityHints(tables);

  return {
    tables: tableMap,
    graph,
    joinPaths,
    searchIndex,
    domains,
    entityHints,
    generatedAt: new Date().toISOString(),
    sourceHash: hashMetadata(tables),
    sourceGeneratedAt: rawMeta?.generated_at,
  };
}

// ── Incremental merge ─────────────────────────────────────────────────────────

export function mergeSchemaModel(
  existing: SchemaModel,
  newTables: Table[]
): SchemaModel {
  const merged: Record<string, Table> = { ...existing.tables };
  for (const t of newTables) {
    merged[t.id] = t;
  }
  return transformToSchemaModel(Object.values(merged));
}
