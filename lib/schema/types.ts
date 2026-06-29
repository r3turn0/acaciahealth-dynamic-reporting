// ─────────────────────────────────────────────────────────────────────────────
// Schema-first Metadata Engine — Type Definitions
// Refined for the actual AcaciaHealth metadata.json format
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnRole =
  | "primary_key"
  | "foreign_key"
  | "dimension"
  | "measure"
  | "time_dimension"
  | "audit";

export interface Column {
  name: string;
  displayName: string;       // prefix-stripped, human-readable
  type: string;
  role: ColumnRole;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  nullable?: boolean;
  isIdentity?: boolean;
  isComputed?: boolean;
  defaultValue?: string | null;
  description?: string;
}

export interface ForeignKey {
  name: string;              // constraint name e.g. "FK_CASH_DEPOSITS_BRANCHES"
  column: string;            // local column
  references: {
    table: string;           // fully-qualified "schema.table"
    column: string;
  };
}

export interface TableMeta {
  triggers: string[];
  checkConstraints: string[];
  indexes: string[];
}

export interface Table {
  id: string;                // "Schema.TABLE_NAME"
  schema: string;
  name: string;
  primaryKey: string;        // single PK column (first if composite)
  primaryKeys: string[];     // all PK columns
  columns: Column[];
  foreignKeys: ForeignKey[];
  domain: string;
  entityType: string;
  description?: string;
  meta: TableMeta;
  isMemoryOptimized?: boolean;
  temporalType?: string;
}

export interface GraphEdge {
  from: string;              // "schema.table"
  to: string;
  via: string;               // FK constraint name
  fromColumn: string;        // local column involved
  toColumn: string;          // referenced column
  type: "many-to-one" | "one-to-many";
}

export interface Graph {
  nodes: Table[];
  edges: GraphEdge[];
}

export interface EntityHints {
  measures: string[];
  dimensions: string[];
  timeColumns: string[];
  auditColumns: string[];
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
  sourceGeneratedAt?: string;  // from metadata.json `generated_at`
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
  via: string;               // constraint name
  fromColumn: string;
  toColumn: string;
  condition: string;         // e.g. "CASH_DEPOSITS.cd_branchcode = BRANCHES.branch_code"
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

// ── Raw metadata.json shapes (actual AcaciaHealth format) ─────────────────────

export interface RawColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  is_identity: boolean;
  is_computed: boolean;
  default: string | null;
  description: string | null;
  // Legacy/alternate keys (other formats)
  type?: string;
  role?: string;
  aggregation?: string;
}

export interface RawForeignKeyEndpoint {
  schema: string;
  table: string;
  columns: string[];
}

export interface RawForeignKey {
  name: string;
  from: RawForeignKeyEndpoint;
  to: RawForeignKeyEndpoint;
  is_for_replication: boolean | null;
  // Legacy/alternate keys
  column?: string;
  references?: { table: string; column: string };
  ref_table?: string;
  ref_column?: string;
}

export interface RawDescriptions {
  table_description: string | null;
  triggers: string[];
  check_constraints: string[];
  indexes: string[];
}

export interface RawTable {
  schema: string;
  table: string;
  object_id?: number;
  is_memory_optimized?: boolean;
  temporal_type?: string;
  columns: RawColumn[];
  primary_keys: string[];
  foreign_keys: RawForeignKey[];
  descriptions: RawDescriptions;
  replication?: { is_for_replication: boolean | null };
  // Legacy/alternate keys
  name?: string;
  table_name?: string;
  table_schema?: string;
  primaryKey?: string;
  primary_key?: string;
  foreignKeys?: RawForeignKey[];
  domain?: string;
  entityType?: string;
}

export interface RawMetadata {
  generated_at?: string;
  tables?: RawTable[] | Record<string, RawTable>;
  schemas?: Record<string, { tables: RawTable[] | Record<string, RawTable>; domain?: string }>;
  domains?: Record<string, string[]>;
  searchIndex?: Record<string, string[]>;
  version?: string;
}
