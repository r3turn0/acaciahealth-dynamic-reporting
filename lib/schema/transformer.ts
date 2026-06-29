// ─────────────────────────────────────────────────────────────────────────────
// Schema Transformer — Builds SchemaModel from normalized Table[]
// Graph construction, BFS join path computation, search index, entity hints
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Column,
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
      // Only add edge if target table is in our model
      if (!tableIds.has(to)) continue;

      const key = `${table.id}>${to}:${fk.column}`;
      const reverseKey = `${to}>${table.id}:${fk.column}`;
      if (edgeKeys.has(key) || edgeKeys.has(reverseKey)) continue;

      edgeKeys.add(key);
      edges.push({
        from: table.id,
        to,
        via: fk.column,
        type: "many-to-one",
      });
      // Add reverse edge
      const revKey = `${to}>${table.id}:${fk.column}`;
      if (!edgeKeys.has(revKey)) {
        edgeKeys.add(revKey);
        edges.push({
          from: to,
          to: table.id,
          via: fk.column,
          type: "one-to-many",
        });
      }
    }
  }

  return { nodes: tables, edges };
}

// ── BFS join path computation ─────────────────────────────────────────────────

function bfsJoinPaths(
  graph: Graph
): Record<string, Record<string, string[]>> {
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
        queue.push({ node: neighbor, path: newPath });
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

  function addKeyword(keyword: string, tableId: string) {
    const k = keyword.toLowerCase().trim();
    if (!k || k.length < 2) return;
    if (!index[k]) index[k] = [];
    if (!index[k].includes(tableId)) index[k].push(tableId);
  }

  for (const table of tables) {
    // Split table name on underscores and camelCase
    const words = table.name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[_\s]+/)
      .filter(Boolean);

    for (const word of words) {
      addKeyword(word, table.id);
    }
    addKeyword(table.name, table.id);
    addKeyword(table.schema, table.id);
    addKeyword(table.domain, table.id);
    addKeyword(table.entityType, table.id);
    if (table.description) {
      for (const word of table.description.split(/\s+/)) {
        addKeyword(word, table.id);
      }
    }

    for (const col of table.columns) {
      const colWords = col.name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[_\s]+/)
        .filter(Boolean);
      for (const word of colWords) {
        addKeyword(word, table.id);
      }
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
    const domain = table.domain;
    if (!domains[domain]) domains[domain] = [];
    if (!domains[domain].includes(table.id)) {
      domains[domain].push(table.id);
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
    const commonFilters: string[] = [];

    for (const col of table.columns) {
      switch (col.role) {
        case "measure":
          measures.push(col.name);
          break;
        case "time_dimension":
          timeColumns.push(col.name);
          commonFilters.push(col.name);
          break;
        case "dimension":
          dimensions.push(col.name);
          if (
            col.name.toLowerCase().includes("status") ||
            col.name.toLowerCase().includes("type") ||
            col.name.toLowerCase().includes("code") ||
            col.name.toLowerCase().includes("branch")
          ) {
            commonFilters.push(col.name);
          }
          break;
      }
    }

    hints[table.id] = {
      measures,
      dimensions,
      timeColumns,
      primaryKey: table.primaryKey,
      commonFilters: [...new Set(commonFilters)],
    };
  }

  return hints;
}

// ── Hash for source tracking ──────────────────────────────────────────────────

function hashMetadata(tables: Table[]): string {
  const str = tables.map((t) => t.id).sort().join(",");
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
  };
}

// ── Incremental update ────────────────────────────────────────────────────────

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
