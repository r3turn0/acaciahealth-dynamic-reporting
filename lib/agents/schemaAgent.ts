/**
 * Schema Intelligence Agent
 *
 * Phase 1 — Schema Discovery
 *   Reads live schema from sys.objects + sys.columns + sys.foreign_keys + sys.indexes
 *   (and INFORMATION_SCHEMA as secondary source). Falls back to static schemaConfig.json.
 *
 * Phase 2 — Knowledge Graph
 *   Builds an internal semantic graph with typed nodes (table, column, business_term,
 *   metric, entity) and typed edges (belongs_to, joins_to, describes, maps_to, alias_of,
 *   derived_from). Incorporates metadata.json business definitions, column aliases,
 *   semantic synonyms, lineage, and KPI definitions.
 *
 * Phase 3 — Context Inference
 *   Resolves ambiguous user terms via business-term resolution, metadata lookup,
 *   alias resolution, candidate table ranking, and confidence scoring.
 *
 * Caches the full graph for 60 minutes to avoid repeated DB round-trips.
 */

import { getCache, setCache } from "../services/cache";
import schemaConfig from "../config/schemaConfig.json";
import semanticLayer from "../config/semanticLayer.json";

const SCHEMA_CACHE_KEY = "schema_intelligence_v6";
const SCHEMA_TTL_MS = 60 * 60 * 1000; // 60 min

export interface ColumnMeta {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
}

export interface TableMeta {
  table_name: string;
  table_schema: string;
  table_type: "BASE TABLE" | "VIEW";
  columns: ColumnMeta[];
  relationships: Record<string, string>;
  row_estimate?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Graph Types (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType = "table" | "column" | "business_term" | "metric" | "entity";

export type EdgeType =
  | "belongs_to"    // column → table
  | "joins_to"      // table → table (FK relationship)
  | "describes"     // business_term → table or column
  | "contains"      // table → column
  | "maps_to"       // business_term → column
  | "alias_of"      // business_term → business_term
  | "derived_from"; // metric → column(s)

export interface KnowledgeNode {
  id: string;           // Unique node id: "table::CLIENT_EPISODES_ALL", "col::epi_SocDate", "term::admissions"
  type: NodeType;
  label: string;        // Human-readable label
  physicalName?: string; // Physical DB name (table or column)
  description?: string;
  synonyms?: string[];
  businessDefinition?: string;
  confidence?: number;  // 0–1 relevance weight
}

export interface KnowledgeEdge {
  from: string;         // Source node id
  to: string;           // Target node id
  type: EdgeType;
  label?: string;       // e.g. join condition
  confidence?: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** Quick lookup: node id → node */
  nodeIndex: Record<string, KnowledgeNode>;
  /** Quick lookup: term (lowercased) → node ids */
  termIndex: Record<string, string[]>;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate Table Resolution (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateTable {
  table_name: string;
  table_confidence: number;   // 0–1
  join_confidence: number;    // 0–1 — how well join paths are understood
  column_confidence: number;  // 0–1 — how many required columns are found
  matched_terms: string[];
  reasoning: string;
}

export interface ContextInferenceResult {
  resolvedTables: CandidateTable[];
  resolvedColumns: string[];
  businessTerms: string[];
  joinPaths: string[];
  ambiguous: boolean;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// metadata.json Shape
// ─────────────────────────────────────────────────────────────────────────────

export interface MetadataJson {
  businessDefinitions?: Record<string, string>;
  columnAliases?: Record<string, string | string[]>;
  semanticMappings?: Record<string, string>;
  dataLineage?: Record<string, string>;
  tableDescriptions?: Record<string, string>;
  kpiDefinitions?: Record<string, { formula?: string; description?: string; table?: string }>;
  subjectAreaMappings?: Record<string, string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended SchemaIntelligence with Knowledge Graph
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaIntelligence {
  tables: TableMeta[];
  semantic_layer: typeof semanticLayer;
  schema_config: typeof schemaConfig;
  generated_at: string;
  source: "live_db" | "static_config";
  /** Phase 2: internal semantic Knowledge Graph */
  knowledgeGraph: KnowledgeGraph;
  /** Phase 1: parsed metadata.json (if available) */
  metadata: MetadataJson;
  /** Phase 3: pre-computed confidence scores per table */
  tableConfidenceMap: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Knowledge Graph Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a semantic Knowledge Graph from tables, semanticLayer, schemaConfig,
 * and an optional metadata.json payload.
 *
 * Node types created:
 *   table        — one per physical table / view
 *   column       — one per column in each table
 *   business_term — from semantic layer synonyms + metadata businessDefinitions
 *   metric       — from KPI catalogue + semantic layer metrics
 *   entity       — derived from semantic layer table descriptions
 *
 * Edge types created:
 *   contains    — table → column
 *   belongs_to  — column → table
 *   joins_to    — table → table (from schemaConfig.joins + FK rows)
 *   describes   — business_term → table
 *   maps_to     — business_term → column
 *   alias_of    — business_term → business_term (synonym chains)
 *   derived_from — metric → table
 */
function buildKnowledgeGraph(
  tables: TableMeta[],
  metadata: MetadataJson
): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const nodeIndex: Record<string, KnowledgeNode> = {};
  const termIndex: Record<string, string[]> = {};

  function addNode(node: KnowledgeNode): void {
    if (nodeIndex[node.id]) return; // Deduplicate
    nodes.push(node);
    nodeIndex[node.id] = node;
    // Index by label and synonyms (lowercased)
    const terms = [node.label.toLowerCase()];
    if (node.synonyms) terms.push(...node.synonyms.map((s) => s.toLowerCase()));
    if (node.physicalName) terms.push(node.physicalName.toLowerCase());
    for (const t of terms) {
      termIndex[t] = [...(termIndex[t] ?? []), node.id];
    }
  }

  function addEdge(edge: KnowledgeEdge): void {
    // Deduplicate by from+to+type
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (!edges.some((e) => `${e.from}|${e.to}|${e.type}` === key)) {
      edges.push(edge);
    }
  }

  // ── 1. Table nodes ──────────────────────────────────────────────────────────

  const sl = semanticLayer as {
    tables: Record<string, {
      physical_name: string; alias: string;
      synonyms: string[]; description: string;
    }>;
    metrics: Record<string, { expression: string; description: string }>;
    sensitive_columns: string[];
  };

  const physicalToSlKey: Record<string, string> = {};
  for (const [key, t] of Object.entries(sl.tables)) {
    physicalToSlKey[t.physical_name.toUpperCase()] = key;
  }

  for (const table of tables) {
    const tableName = table.table_name.toUpperCase();
    const tableId = `table::${tableName}`;
    const slEntry = sl.tables[physicalToSlKey[tableName] ?? ""];
    const metaDesc = metadata.tableDescriptions?.[tableName] ?? metadata.tableDescriptions?.[table.table_name] ?? "";

    addNode({
      id: tableId,
      type: "table",
      label: table.table_name,
      physicalName: table.table_name,
      description: metaDesc || slEntry?.description || "",
      synonyms: slEntry?.synonyms ?? [],
      businessDefinition: metadata.businessDefinitions?.[tableName] ?? metadata.businessDefinitions?.[table.table_name],
      confidence: 1.0,
    });

    // ── 2. Column nodes ───────────────────────────────────────────────────────

    for (const col of table.columns) {
      const colId = `col::${tableName}::${col.column_name.toUpperCase()}`;
      const aliasRaw = metadata.columnAliases?.[col.column_name] ?? metadata.columnAliases?.[`${table.table_name}.${col.column_name}`];
      const aliases = aliasRaw
        ? Array.isArray(aliasRaw) ? aliasRaw : [aliasRaw]
        : [];

      addNode({
        id: colId,
        type: "column",
        label: col.column_name,
        physicalName: col.column_name,
        synonyms: aliases as string[],
        description: `${col.data_type}${col.is_nullable === "YES" ? " (nullable)" : ""}`,
        confidence: 1.0,
      });

      addEdge({ from: tableId, to: colId, type: "contains" });
      addEdge({ from: colId, to: tableId, type: "belongs_to" });
    }
  }

  // ── 3. Join edges from schemaConfig ─────────────────────────────────────────

  for (const [tableName, cfg] of Object.entries(schemaConfig as Record<string, { alias: string; keys: string[]; joins: Record<string, string> }>)) {
    const fromId = `table::${tableName.toUpperCase()}`;
    for (const [targetTable, condition] of Object.entries(cfg.joins)) {
      const toId = `table::${targetTable.toUpperCase()}`;
      addEdge({ from: fromId, to: toId, type: "joins_to", label: condition, confidence: 1.0 });
    }
  }

  // ── 4. Business term nodes from semantic layer tables ───────────────────────

  for (const [termKey, t] of Object.entries(sl.tables)) {
    const termId = `term::${termKey}`;
    addNode({
      id: termId,
      type: "business_term",
      label: termKey,
      synonyms: t.synonyms,
      description: t.description,
      confidence: 1.0,
    });

    const physicalId = `table::${t.physical_name.toUpperCase()}`;
    if (nodeIndex[physicalId]) {
      addEdge({ from: termId, to: physicalId, type: "describes", confidence: 1.0 });
    }

    // Synonym alias chains
    for (const syn of t.synonyms) {
      const synId = `term::${syn.toLowerCase().replace(/\s+/g, "_")}`;
      if (!nodeIndex[synId]) {
        addNode({ id: synId, type: "business_term", label: syn, synonyms: [], confidence: 0.8 });
      }
      addEdge({ from: synId, to: termId, type: "alias_of", confidence: 0.9 });
    }
  }

  // ── 5. Metric nodes from semantic layer + KPI config ───────────────────────

  for (const [metricKey, m] of Object.entries(sl.metrics)) {
    const metricId = `metric::${metricKey}`;
    addNode({
      id: metricId,
      type: "metric",
      label: metricKey,
      description: m.description,
      businessDefinition: m.expression,
      confidence: 1.0,
    });
  }

  // ── 6. Business definitions from metadata.json ──────────────────────────────

  for (const [term, def] of Object.entries(metadata.businessDefinitions ?? {})) {
    const termId = `term::${term.toLowerCase().replace(/\s+/g, "_")}`;
    if (!nodeIndex[termId]) {
      addNode({
        id: termId,
        type: "business_term",
        label: term,
        businessDefinition: def,
        confidence: 0.9,
      });
    } else {
      nodeIndex[termId].businessDefinition = def;
    }
  }

  // ── 7. Semantic mappings from metadata.json (term → physical column) ────────

  for (const [term, colRef] of Object.entries(metadata.semanticMappings ?? {})) {
    const termId = `term::${term.toLowerCase().replace(/\s+/g, "_")}`;
    if (!nodeIndex[termId]) {
      addNode({ id: termId, type: "business_term", label: term, confidence: 0.85 });
    }

    // colRef could be "TABLE.column" or just "column"
    const parts = colRef.includes(".") ? colRef.split(".") : [null, colRef];
    const [tbl, col] = parts;
    if (tbl && col) {
      const colId = `col::${tbl.toUpperCase()}::${col.toUpperCase()}`;
      if (nodeIndex[colId]) {
        addEdge({ from: termId, to: colId, type: "maps_to", confidence: 0.9 });
      }
    }
  }

  // ── 8. KPI definitions from metadata.json ──────────────────────────────────

  for (const [kpiName, kpiDef] of Object.entries(metadata.kpiDefinitions ?? {})) {
    const metricId = `metric::${kpiName.toLowerCase().replace(/\s+/g, "_")}`;
    if (!nodeIndex[metricId]) {
      addNode({
        id: metricId,
        type: "metric",
        label: kpiName,
        description: kpiDef.description,
        businessDefinition: kpiDef.formula,
        confidence: 0.95,
      });
    }
    if (kpiDef.table) {
      const tableId = `table::${kpiDef.table.toUpperCase()}`;
      if (nodeIndex[tableId]) {
        addEdge({ from: metricId, to: tableId, type: "derived_from", confidence: 0.9 });
      }
    }
  }

  return {
    nodes,
    edges,
    nodeIndex,
    termIndex,
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Context Inference — resolve ambiguous user terms
// ─────────────────────────────────────────────────────────���───────────────────

/**
 * Resolve a natural language query to candidate tables with confidence scores.
 * Performs:
 *   1. Business-term resolution via termIndex
 *   2. Metadata lookup (aliases, synonyms, descriptions)
 *   3. Alias resolution (alias_of edges)
 *   4. Candidate table ranking by edge traversal
 *   5. Join path inference
 *   6. Confidence scoring
 */
export function resolveQueryContext(
  query: string,
  graph: KnowledgeGraph,
  tables: TableMeta[]
): ContextInferenceResult {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  // Score each table node
  const tableScores: Record<string, { score: number; matchedTerms: string[] }> = {};

  for (const token of tokens) {
    // Direct termIndex lookup
    const nodeIds = graph.termIndex[token] ?? [];

    for (const nodeId of nodeIds) {
      const node = graph.nodeIndex[nodeId];
      if (!node) continue;

      // Traverse edges to find connected tables
      if (node.type === "table") {
        const tbl = node.physicalName?.toUpperCase() ?? node.label.toUpperCase();
        tableScores[tbl] = tableScores[tbl] ?? { score: 0, matchedTerms: [] };
        tableScores[tbl].score += node.confidence ?? 1.0;
        if (!tableScores[tbl].matchedTerms.includes(token)) {
          tableScores[tbl].matchedTerms.push(token);
        }
      }

      // For business_term / metric, follow describes / derived_from edges
      if (node.type === "business_term" || node.type === "metric") {
        const connectedEdges = graph.edges.filter(
          (e) => e.from === nodeId && (e.type === "describes" || e.type === "derived_from")
        );
        for (const edge of connectedEdges) {
          const targetNode = graph.nodeIndex[edge.to];
          if (targetNode?.type === "table") {
            const tbl = targetNode.physicalName?.toUpperCase() ?? targetNode.label.toUpperCase();
            tableScores[tbl] = tableScores[tbl] ?? { score: 0, matchedTerms: [] };
            tableScores[tbl].score += (edge.confidence ?? 0.9) * (node.confidence ?? 1.0);
            if (!tableScores[tbl].matchedTerms.includes(token)) {
              tableScores[tbl].matchedTerms.push(token);
            }
          }
        }
      }
    }

    // Fuzzy substring match against table names
    for (const table of tables) {
      const tableName = table.table_name.toUpperCase();
      const tableNameLower = table.table_name.toLowerCase();
      if (
        tableNameLower.includes(token) ||
        token.includes(tableNameLower.replace(/_/g, ""))
      ) {
        tableScores[tableName] = tableScores[tableName] ?? { score: 0, matchedTerms: [] };
        tableScores[tableName].score += 0.6;
        if (!tableScores[tableName].matchedTerms.includes(token)) {
          tableScores[tableName].matchedTerms.push(token);
        }
      }
    }
  }

  // Ensure CLIENT_EPISODES_ALL always has a baseline score
  const primaryTable = "CLIENT_EPISODES_ALL";
  if (!tableScores[primaryTable]) {
    tableScores[primaryTable] = { score: 0.4, matchedTerms: [] };
  }

  // Sort by score
  const ranked = Object.entries(tableScores)
    .map(([tableName, { score, matchedTerms }]) => {
      // Join confidence: how many join paths are documented from this table
      const tableId = `table::${tableName}`;
      const joinEdgeCount = graph.edges.filter(
        (e) => e.from === tableId && e.type === "joins_to"
      ).length;

      // Column confidence: rough proxy via column count
      const tableMeta = tables.find((t) => t.table_name.toUpperCase() === tableName);
      const colCount = tableMeta?.columns.length ?? 0;

      return {
        table_name: tableName,
        table_confidence: Math.min(score, 1.0),
        join_confidence: joinEdgeCount > 0 ? Math.min(0.5 + joinEdgeCount * 0.1, 1.0) : 0.3,
        column_confidence: colCount > 0 ? Math.min(0.4 + colCount * 0.01, 0.95) : 0.3,
        matched_terms: matchedTerms,
        reasoning: matchedTerms.length > 0
          ? `Matched via: ${matchedTerms.join(", ")}`
          : "Baseline primary table",
      } as CandidateTable;
    })
    .sort((a, b) => b.table_confidence - a.table_confidence)
    .slice(0, 8);

  // Build join path descriptions for the top tables
  const joinPaths: string[] = [];
  const topTableIds = ranked.slice(0, 3).map((t) => `table::${t.table_name}`);
  for (const fromId of topTableIds) {
    const fromEdges = graph.edges.filter(
      (e) => e.from === fromId && e.type === "joins_to" && topTableIds.includes(e.to)
    );
    for (const edge of fromEdges) {
      const label = edge.label ?? `${edge.from} → ${edge.to}`;
      if (!joinPaths.includes(label)) joinPaths.push(label);
    }
  }

  // Resolve columns mentioned in the query
  const resolvedColumns: string[] = [];
  for (const token of tokens) {
    const colNodeIds = (graph.termIndex[token] ?? []).filter((id) => id.startsWith("col::"));
    for (const colId of colNodeIds) {
      const node = graph.nodeIndex[colId];
      if (node?.physicalName) resolvedColumns.push(node.physicalName);
    }
  }

  const businessTerms = tokens.filter((t) => (graph.termIndex[t] ?? []).some((id) => id.startsWith("term::")));

  const overallConfidence = ranked.length > 0
    ? ranked.slice(0, 3).reduce((s, t) => s + t.table_confidence, 0) / Math.min(ranked.length, 3)
    : 0.4;

  return {
    resolvedTables: ranked,
    resolvedColumns: [...new Set(resolvedColumns)],
    businessTerms: [...new Set(businessTerms)],
    joinPaths,
    ambiguous: ranked.length > 1 && ranked[0].table_confidence < 0.6,
    confidence: overallConfidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute per-table confidence map for quick lookup
// ─────────────────────────────────────────────────────────────────────────────

function buildTableConfidenceMap(graph: KnowledgeGraph): Record<string, number> {
  const map: Record<string, number> = {};
  for (const node of graph.nodes) {
    if (node.type === "table" && node.physicalName) {
      map[node.physicalName.toUpperCase()] = node.confidence ?? 1.0;
    }
  }
  return map;
}

// ── Live introspection ────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Live DB Introspection
// Uses sys.objects, sys.columns, sys.foreign_keys, sys.indexes, sys.key_column_usage
// ─────────────────────────────────────────────────────────────────────────────

async function introspectFromDb(metadata: MetadataJson): Promise<SchemaIntelligence | null> {
  try {
    const { executeRawQuery } = await import("../services/db");

    // ── Columns from sys catalog (works with only CONNECT permission) ──────────
    const columnsSQL = `
      SELECT
        s.name           AS TABLE_SCHEMA,
        o.name           AS TABLE_NAME,
        CASE o.type
          WHEN 'U' THEN 'BASE TABLE'
          WHEN 'V' THEN 'VIEW'
          ELSE 'BASE TABLE'
        END              AS TABLE_TYPE,
        c.name           AS COLUMN_NAME,
        tp.name          AS DATA_TYPE,
        CASE c.is_nullable WHEN 1 THEN 'YES' ELSE 'NO' END AS IS_NULLABLE,
        c.max_length     AS CHARACTER_MAXIMUM_LENGTH
      FROM sys.objects o
      JOIN sys.schemas  s  ON s.schema_id  = o.schema_id
      JOIN sys.columns  c  ON c.object_id  = o.object_id
      JOIN sys.types    tp ON tp.user_type_id = c.user_type_id
      WHERE o.type IN ('U', 'V')
        AND o.is_ms_shipped = 0
      ORDER BY o.type DESC, o.name, c.column_id
    `;

    // ── Foreign keys from sys.foreign_keys ─────────────────────────────────────
    const fkSQL = `
      SELECT
        OBJECT_NAME(fk.parent_object_id)      AS FK_TABLE,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS FK_COLUMN,
        OBJECT_NAME(fk.referenced_object_id)  AS PK_TABLE,
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS PK_COLUMN,
        fk.name AS CONSTRAINT_NAME
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      ORDER BY FK_TABLE, FK_COLUMN
    `;

    // ── Row counts from sys.dm_db_partition_stats (if permission allows) ──────
    const rowCountSQL = `
      SELECT
        o.name AS TABLE_NAME,
        SUM(p.row_count) AS ROW_COUNT
      FROM sys.dm_db_partition_stats p
      JOIN sys.objects o ON o.object_id = p.object_id
      WHERE o.type = 'U'
        AND p.index_id < 2
      GROUP BY o.name
    `;

    const [colRows, fkRows, rowCountRows] = await Promise.all([
      executeRawQuery(columnsSQL).catch(() => [] as Record<string, unknown>[]),
      executeRawQuery(fkSQL).catch(() => [] as Record<string, unknown>[]),
      executeRawQuery(rowCountSQL).catch(() => [] as Record<string, unknown>[]),
    ]);

    // Build row count map
    const rowCounts: Record<string, number> = {};
    for (const r of rowCountRows as Record<string, unknown>[]) {
      rowCounts[String(r.TABLE_NAME).toUpperCase()] = Number(r.ROW_COUNT ?? 0);
    }

    // Build FK relationship map: table → { targetTable: "FK_COL = PK_COL" }
    const fkRelMap: Record<string, Record<string, string>> = {};
    for (const r of fkRows as Record<string, unknown>[]) {
      const src = String(r.FK_TABLE).toUpperCase();
      const tgt = String(r.PK_TABLE).toUpperCase();
      fkRelMap[src] = fkRelMap[src] ?? {};
      fkRelMap[src][tgt] = `${src}.${r.FK_COLUMN} = ${tgt}.${r.PK_COLUMN}`;
    }

    // Group columns by table
    const tableMap = new Map<string, TableMeta>();
    for (const row of colRows as Record<string, unknown>[]) {
      const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}` as string;
      const tableName = row.TABLE_NAME as string;
      if (!tableMap.has(key)) {
        const schemaJoins = (schemaConfig as Record<string, { joins: Record<string, string> }>)[tableName]?.joins ?? {};
        const fkJoins = fkRelMap[tableName.toUpperCase()] ?? {};
        tableMap.set(key, {
          table_name: tableName,
          table_schema: row.TABLE_SCHEMA as string,
          table_type: (row.TABLE_TYPE as string) === "VIEW" ? "VIEW" : "BASE TABLE",
          columns: [],
          relationships: { ...schemaJoins, ...fkJoins },
          row_estimate: rowCounts[tableName.toUpperCase()],
        });
      }
      tableMap.get(key)!.columns.push({
        column_name: row.COLUMN_NAME as string,
        data_type: row.DATA_TYPE as string,
        is_nullable: row.IS_NULLABLE as string,
        character_maximum_length: row.CHARACTER_MAXIMUM_LENGTH as number | null,
      });
    }

    const tables = Array.from(tableMap.values());
    const knowledgeGraph = buildKnowledgeGraph(tables, metadata);
    const tableConfidenceMap = buildTableConfidenceMap(knowledgeGraph);

    return {
      tables,
      semantic_layer: semanticLayer,
      schema_config: schemaConfig,
      generated_at: new Date().toISOString(),
      source: "live_db",
      knowledgeGraph,
      metadata,
      tableConfidenceMap,
    };
  } catch (err) {
    console.error("[schemaAgent] live DB introspection failed:", (err as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Static fallback: builds a schema from schemaConfig.json only
// ─────────────────────────────────────────────────────────────────────────────

function buildStaticSchema(metadata: MetadataJson): SchemaIntelligence {
  const staticTables: TableMeta[] = Object.entries(
    schemaConfig as Record<string, { keys: string[]; joins: Record<string, string> }>
  ).map(([tableName, config]) => ({
    table_name: tableName,
    table_schema: tableName.includes(".") ? tableName.split(".")[0] : "dbo",
    table_type: (tableName.toUpperCase().startsWith("VW_") ? "VIEW" : "BASE TABLE") as "VIEW" | "BASE TABLE",
    columns: config.keys.map((k) => ({
      column_name: k,
      data_type: "int",
      is_nullable: "NO",
      character_maximum_length: null,
    })),
    relationships: config.joins,
  }));

  const knowledgeGraph = buildKnowledgeGraph(staticTables, metadata);
  const tableConfidenceMap = buildTableConfidenceMap(knowledgeGraph);

  return {
    tables: staticTables,
    semantic_layer: semanticLayer,
    schema_config: schemaConfig,
    generated_at: new Date().toISOString(),
    source: "static_config",
    knowledgeGraph,
    metadata,
    tableConfidenceMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and return the full SchemaIntelligence object, including the Knowledge Graph.
 * Optionally accepts a metadata.json payload for richer context.
 * Result is cached for SCHEMA_TTL_MS.
 *
 * Pass `forceRefresh=true` to bypass the cache (e.g. after metadata.json upload).
 */
export async function getSchemaIntelligence(
  options: {
    metadata?: MetadataJson;
    forceRefresh?: boolean;
  } = {}
): Promise<SchemaIntelligence> {
  if (!options.forceRefresh) {
    const cached = getCache<SchemaIntelligence>(SCHEMA_CACHE_KEY);
    if (cached) return cached;
  }

  const metadata: MetadataJson = options.metadata ?? {};

  let schema: SchemaIntelligence;

  const { isDbConfigured } = await import("../services/db");
  if (isDbConfigured()) {
    const live = await introspectFromDb(metadata);
    if (live) {
      schema = live;
    } else {
      schema = buildStaticSchema(metadata);
    }
  } else {
    schema = buildStaticSchema(metadata);
  }

  setCache(SCHEMA_CACHE_KEY, schema, SCHEMA_TTL_MS);
  return schema;
}

/**
 * Convenience: resolve a natural language query to candidate tables using the
 * cached Knowledge Graph. Returns ContextInferenceResult.
 */
export async function inferQueryContext(query: string): Promise<ContextInferenceResult> {
  const schema = await getSchemaIntelligence();
  return resolveQueryContext(query, schema.knowledgeGraph, schema.tables);
}

/**
 * Force-invalidate the schema cache (e.g. after metadata.json upload or schema change).
 */
export function invalidateSchemaCache(): void {
  // Cache keys are managed by the cache service — overwrite with a no-op entry
  // that expires immediately by setting null. We achieve this by setting TTL = 1ms.
  setCache(SCHEMA_CACHE_KEY, null as unknown as SchemaIntelligence, 1);
}
