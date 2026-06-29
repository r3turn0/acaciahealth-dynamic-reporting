// ─────────────────────────────────────────────────────────────────────────────
// Schema-first Metadata Engine — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnRole =
  | "primary_key"
  | "foreign_key"
  | "dimension"
  | "measure"
  | "time_dimension";

export interface Column {
  name: string;
  type: string;
  role: ColumnRole;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  nullable?: boolean;
  description?: string;
}

export interface ForeignKey {
  column: string;
  references: {
    table: string; // fully-qualified "schema.table"
    column: string;
  };
}

export interface Table {
  id: string; // "schema.table"
  schema: string;
  name: string;
  primaryKey: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
  domain: string;
  entityType: string;
  description?: string;
  rowEstimate?: number;
}

export interface GraphEdge {
  from: string; // "schema.table"
  to: string;
  via: string; // column name on `from`
  type: "one-to-many" | "many-to-one";
}

export interface Graph {
  nodes: Table[];
  edges: GraphEdge[];
}

export interface EntityHints {
  measures: string[];
  dimensions: string[];
  timeColumns: string[];
  primaryKey: string;
  commonFilters: string[];
}

export interface SchemaModel {
  tables: Record<string, Table>;
  graph: Graph;
  joinPaths: Record<string, Record<string, string[]>>;
  searchIndex: Record<string, string[]>;
  domains: Record<string, string[]>;
  entityHints: Record<string, EntityHints>;
  generatedAt: string;
  sourceHash: string;
}

// ── Report Plan ───────────────────────────────────────────────────────────────

export type FilterOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN" | "BETWEEN" | "LIKE";

export interface ReportFilter {
  table: string;
  column: string;
  operator: FilterOperator;
  value: unknown;
}

export interface ReportJoin {
  from: string;
  to: string;
  via: string;
  condition?: string;
}

export interface ReportPlan {
  tables: string[];
  joins: ReportJoin[];
  measures: { table: string; column: string; aggregation: string; alias: string }[];
  dimensions: { table: string; column: string; alias: string }[];
  filters: ReportFilter[];
  groupBy: string[];
  orderBy?: { column: string; direction: "ASC" | "DESC" }[];
  limit?: number;
  timeRange?: {
    table: string;
    column: string;
    start: string;
    end: string;
  };
}

// ── Raw metadata.json shapes (before normalization) ───────────────────────────

export interface RawColumn {
  name: string;
  type?: string;
  data_type?: string;
  role?: string;
  aggregation?: string;
  nullable?: boolean;
  description?: string;
}

export interface RawForeignKey {
  column: string;
  references?: { table: string; column: string };
  ref_table?: string;
  ref_column?: string;
}

export interface RawTable {
  name?: string;
  table_name?: string;
  schema?: string;
  table_schema?: string;
  primaryKey?: string;
  primary_key?: string;
  columns?: RawColumn[];
  foreignKeys?: RawForeignKey[];
  foreign_keys?: RawForeignKey[];
  domain?: string;
  entityType?: string;
  entity_type?: string;
  description?: string;
  rowEstimate?: number;
  row_estimate?: number;
}

export interface RawMetadata {
  tables?: RawTable[] | Record<string, RawTable>;
  schemas?: Record<string, { tables: RawTable[] | Record<string, RawTable>; domain?: string }>;
  domains?: Record<string, string[]>;
  searchIndex?: Record<string, string[]>;
  version?: string;
}
