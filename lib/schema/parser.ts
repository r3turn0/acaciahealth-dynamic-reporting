// ─────────────────────────────────────────────────────────────────────────────
// Schema Parser — Normalizes raw metadata.json into consistent Table[]
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Column,
  ColumnRole,
  ForeignKey,
  RawColumn,
  RawForeignKey,
  RawMetadata,
  RawTable,
  Table,
} from "./types";

// ── Column normalization ──────────────────────────────────────────────────────

function normalizeColumnRole(col: RawColumn, tablePK: string): ColumnRole {
  if (col.role) {
    const r = col.role.toLowerCase();
    if (r.includes("primary")) return "primary_key";
    if (r.includes("foreign")) return "foreign_key";
    if (r.includes("time") || r.includes("date")) return "time_dimension";
    if (r.includes("measure")) return "measure";
    if (r.includes("dimension")) return "dimension";
  }

  const name = col.name.toLowerCase();
  const type = (col.type ?? col.data_type ?? "").toLowerCase();

  if (name === tablePK.toLowerCase()) return "primary_key";
  if (name.endsWith("_id") || name.endsWith("id")) return "foreign_key";
  if (name.endsWith("_date") || name.endsWith("_at") || name.endsWith("_time") || type.includes("date") || type.includes("time"))
    return "time_dimension";
  if (
    type.includes("int") ||
    type.includes("decimal") ||
    type.includes("float") ||
    type.includes("numeric") ||
    type.includes("money") ||
    type.includes("real")
  )
    return "measure";

  return "dimension";
}

function normalizeColumn(raw: RawColumn, tablePK: string): Column {
  const role = normalizeColumnRole(raw, tablePK);
  const col: Column = {
    name: raw.name,
    type: raw.type ?? raw.data_type ?? "varchar",
    role,
    nullable: raw.nullable ?? true,
  };
  if (raw.description) col.description = raw.description;
  if (raw.aggregation) {
    col.aggregation = raw.aggregation as Column["aggregation"];
  } else if (role === "measure") {
    const t = col.type.toLowerCase();
    col.aggregation = t.includes("float") || t.includes("decimal") || t.includes("money") ? "sum" : "sum";
  }
  return col;
}

function normalizeForeignKey(raw: RawForeignKey, schemaFallback: string): ForeignKey {
  const refTable = raw.references?.table ?? raw.ref_table ?? "";
  const refColumn = raw.references?.column ?? raw.ref_column ?? "id";
  // Fully-qualify if not already
  const fullyQualifiedTable = refTable.includes(".") ? refTable : `${schemaFallback}.${refTable}`;
  return {
    column: raw.column,
    references: { table: fullyQualifiedTable, column: refColumn },
  };
}

// ── Domain inference ──────────────────────────────────────────────────────────

const SCHEMA_DOMAIN_MAP: Record<string, string> = {
  accounting: "finance",
  Accounting: "finance",
  billing: "billing",
  Billing: "billing",
  archive: "payroll",
  Archive: "payroll",
  dbo: "core_reference",
  PDGM: "clinical",
  pdgm: "clinical",
};

function inferDomain(schemaName: string, provided?: string): string {
  if (provided) return provided;
  return SCHEMA_DOMAIN_MAP[schemaName] ?? schemaName.toLowerCase();
}

// ── Single table normalization ────────────────────────────────────────────────

function normalizeTable(raw: RawTable, defaultSchema: string, providedDomain?: string): Table {
  const tableName = raw.name ?? raw.table_name ?? "unknown";
  const schemaName = raw.schema ?? raw.table_schema ?? defaultSchema;
  const id = `${schemaName}.${tableName}`;
  const pk = raw.primaryKey ?? raw.primary_key ?? "";

  const rawCols = raw.columns ?? [];
  const rawFKs = raw.foreignKeys ?? raw.foreign_keys ?? [];

  const columns: Column[] = rawCols.map((c) => normalizeColumn(c, pk));
  const foreignKeys: ForeignKey[] = rawFKs.map((fk) => normalizeForeignKey(fk, schemaName));

  // Infer PK from columns if not provided
  const inferredPK =
    pk ||
    columns.find((c) => c.role === "primary_key")?.name ||
    columns.find((c) => c.name.toLowerCase().endsWith("_id"))?.name ||
    "id";

  return {
    id,
    schema: schemaName,
    name: tableName,
    primaryKey: inferredPK,
    columns,
    foreignKeys,
    domain: inferDomain(schemaName, raw.domain ?? providedDomain),
    entityType: raw.entityType ?? raw.entity_type ?? inferEntityType(tableName),
    description: raw.description,
    rowEstimate: raw.rowEstimate ?? raw.row_estimate,
  };
}

function inferEntityType(tableName: string): string {
  const n = tableName.toLowerCase();
  if (n.includes("episode") || n.includes("patient") || n.includes("client")) return "clinical";
  if (n.includes("billing") || n.includes("invoice") || n.includes("payment") || n.includes("line_item")) return "financial";
  if (n.includes("branch") || n.includes("staff") || n.includes("user")) return "operational";
  if (n.includes("date") || n.includes("time") || n.includes("calendar")) return "date_dimension";
  return "reference";
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseMetadata(raw: RawMetadata): Table[] {
  const tables: Table[] = [];
  const seen = new Set<string>();

  function addTable(t: Table) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      tables.push(t);
    }
  }

  // Format 1: { tables: RawTable[] }
  if (Array.isArray(raw.tables)) {
    for (const t of raw.tables) {
      addTable(normalizeTable(t, "dbo"));
    }
  }
  // Format 2: { tables: Record<name, RawTable> }
  else if (raw.tables && typeof raw.tables === "object") {
    for (const [name, t] of Object.entries(raw.tables as Record<string, RawTable>)) {
      addTable(normalizeTable({ ...t, name: t.name ?? name }, "dbo"));
    }
  }

  // Format 3: { schemas: { schemaName: { tables: ... } } }
  if (raw.schemas) {
    for (const [schemaName, schemaDef] of Object.entries(raw.schemas)) {
      const domain = schemaDef.domain;
      const schemaTables = schemaDef.tables;
      if (Array.isArray(schemaTables)) {
        for (const t of schemaTables) {
          addTable(normalizeTable({ ...t, schema: schemaName }, schemaName, domain));
        }
      } else if (schemaTables && typeof schemaTables === "object") {
        for (const [name, t] of Object.entries(schemaTables as Record<string, RawTable>)) {
          addTable(normalizeTable({ ...t, name: t.name ?? name, schema: schemaName }, schemaName, domain));
        }
      }
    }
  }

  return tables;
}

// Re-export for convenience
export { inferDomain };
