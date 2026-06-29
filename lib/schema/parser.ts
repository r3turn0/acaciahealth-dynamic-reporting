// ─────────────────────────────────────────────────────────────────────────────
// Schema Parser — Normalizes AcaciaHealth metadata.json into consistent Table[]
// Handles the real format: prefix-named columns, array PKs, structured FK objects
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
  TableMeta,
} from "./types";

// ── Column prefix stripping ───────────────────────────────────────────────────
// AcaciaHealth columns use a 2–4 char prefix: cd_branchcode, rct_step, etc.
// We strip the prefix for human-readable display names.

function stripColumnPrefix(name: string): string {
  // Pattern: 2-5 lowercase chars followed by underscore
  const match = name.match(/^[a-z]{2,5}_(.+)$/);
  if (match) return match[1];
  return name;
}

function toDisplayName(name: string): string {
  return stripColumnPrefix(name)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Audit column detection ────────────────────────────────────────────────────

const AUDIT_SUFFIXES = [
  "insertedby", "insertedbywkrid", "insertdate",
  "lastupdatedby", "lastupdatedbywkrid", "lastupdate",
  "createdby", "createdat", "updatedby", "updatedat",
  "modifiedby", "modifiedat",
];

function isAuditColumn(name: string): boolean {
  const bare = stripColumnPrefix(name).toLowerCase();
  return AUDIT_SUFFIXES.some((s) => bare === s || bare.endsWith(s));
}

// ── Column role inference ─────────────────────────────────────────────────────

function inferColumnRole(
  col: RawColumn,
  tablePKs: string[],
  fkColumns: Set<string>
): ColumnRole {
  // Explicit role in raw data (legacy formats)
  if (col.role) {
    const r = col.role.toLowerCase();
    if (r.includes("primary")) return "primary_key";
    if (r.includes("foreign")) return "foreign_key";
    if (r.includes("time") || r.includes("date")) return "time_dimension";
    if (r.includes("measure")) return "measure";
    if (r.includes("dimension")) return "dimension";
  }

  const name = col.name.toLowerCase();
  const bare = stripColumnPrefix(name);
  const dataType = (col.data_type ?? col.type ?? "").toLowerCase();

  // Audit columns get their own role
  if (isAuditColumn(col.name)) return "audit";

  // Primary key
  if (tablePKs.map((k) => k.toLowerCase()).includes(name)) return "primary_key";

  // Foreign key — column is referenced by a FK constraint
  if (fkColumns.has(col.name)) return "foreign_key";

  // Time dimension
  if (
    bare.endsWith("date") || bare.endsWith("at") || bare.endsWith("time") || bare === "date" ||
    dataType.includes("date") || dataType.includes("datetime") || dataType.includes("time")
  ) return "time_dimension";

  // Measure — numeric non-identity non-FK columns
  if (
    (dataType.includes("decimal") || dataType.includes("numeric") ||
     dataType.includes("float") || dataType.includes("real") ||
     dataType.includes("money")) &&
    !col.is_identity
  ) return "measure";

  // Integer fields that are NOT PKs/FKs and not identity are often codes/counts
  if (
    (dataType === "int" || dataType === "bigint" || dataType === "smallint" || dataType === "tinyint") &&
    !col.is_identity && !tablePKs.map((k) => k.toLowerCase()).includes(name) &&
    !fkColumns.has(col.name) &&
    !bare.endsWith("id") && !bare.endsWith("code")
  ) return "measure";

  return "dimension";
}

function normalizeColumn(
  raw: RawColumn,
  tablePKs: string[],
  fkColumns: Set<string>
): Column {
  const role = inferColumnRole(raw, tablePKs, fkColumns);
  const type = raw.data_type ?? raw.type ?? "varchar";

  const col: Column = {
    name: raw.name,
    displayName: toDisplayName(raw.name),
    type,
    role,
    nullable: raw.nullable ?? true,
    isIdentity: raw.is_identity ?? false,
    isComputed: raw.is_computed ?? false,
    defaultValue: raw.default ?? null,
  };

  if (raw.description) col.description = raw.description;

  if (role === "measure") {
    const t = type.toLowerCase();
    col.aggregation =
      t.includes("decimal") || t.includes("numeric") || t.includes("float") ||
      t.includes("real") || t.includes("money")
        ? "sum"
        : "count";
  }

  return col;
}

// ── FK normalization ──────────────────────────────────────────────────────────
// Real format: { name, from: { schema, table, columns[] }, to: { schema, table, columns[] } }
// Legacy format: { column, references: { table, column } } or { ref_table, ref_column }

function normalizeForeignKey(
  raw: RawForeignKey,
  thisSchema: string,
  thisTable: string
): ForeignKey | null {
  // Real AcaciaHealth format
  if (raw.from && raw.to) {
    const fromCols = raw.from.columns ?? [];
    const toCols = raw.to.columns ?? [];

    if (fromCols.length === 0 || toCols.length === 0) return null;

    // Only emit FKs that actually belong to THIS table
    if (
      raw.from.schema.toLowerCase() !== thisSchema.toLowerCase() ||
      raw.from.table.toLowerCase() !== thisTable.toLowerCase()
    ) {
      return null;
    }

    const toTableId = `${raw.to.schema}.${raw.to.table}`;
    return {
      name: raw.name,
      column: fromCols[0],
      references: {
        table: toTableId,
        column: toCols[0],
      },
    };
  }

  // Legacy format
  if (raw.column) {
    const refTable = raw.references?.table ?? raw.ref_table ?? "";
    const refColumn = raw.references?.column ?? raw.ref_column ?? "id";
    const fullyQualified = refTable.includes(".") ? refTable : `${thisSchema}.${refTable}`;
    return {
      name: raw.name ?? `fk_${raw.column}`,
      column: raw.column,
      references: { table: fullyQualified, column: refColumn },
    };
  }

  return null;
}

// ── Domain inference ──────────────────────────────────────────────────────────

const SCHEMA_DOMAIN_MAP: Record<string, string> = {
  Accounting: "finance",
  accounting: "finance",
  Billing:    "billing",
  billing:    "billing",
  Archive:    "payroll",
  archive:    "payroll",
  dbo:        "core_reference",
  PDGM:       "clinical",
  pdgm:       "clinical",
};

export function inferDomain(schemaName: string, provided?: string): string {
  if (provided) return provided;
  return SCHEMA_DOMAIN_MAP[schemaName] ?? schemaName.toLowerCase();
}

// ── Entity type inference ─────────────────────────────────────────────────────

function inferEntityType(tableName: string): string {
  const n = tableName.toLowerCase();
  if (n.includes("episode") || n.includes("patient") || n.includes("client")) return "clinical";
  if (
    n.includes("billing") || n.includes("invoice") || n.includes("payment") ||
    n.includes("line_item") || n.includes("revenue") || n.includes("cash") ||
    n.includes("deposit") || n.includes("distribution")
  ) return "financial";
  if (n.includes("branch") || n.includes("worker") || n.includes("staff") || n.includes("user")) return "operational";
  if (n.includes("date") || n.includes("time") || n.includes("calendar") || n.includes("period")) return "date_dimension";
  if (n.includes("type") || n.includes("code") || n.includes("status") || n.includes("source")) return "lookup";
  return "reference";
}

// ── Single table normalization ────────────────────────────────────────────────

function normalizeTable(raw: RawTable, defaultSchema: string, providedDomain?: string): Table {
  // Real format: raw.schema + raw.table
  // Legacy format: raw.name or raw.table_name, raw.table_schema
  const schemaName = raw.schema ?? raw.table_schema ?? defaultSchema;
  const tableName = raw.table ?? raw.name ?? raw.table_name ?? "unknown";
  const id = `${schemaName}.${tableName}`;

  // PKs — real format is primary_keys: string[], legacy is primaryKey/primary_key: string
  const primaryKeys: string[] =
    Array.isArray(raw.primary_keys) && raw.primary_keys.length > 0
      ? raw.primary_keys
      : raw.primaryKey
        ? [raw.primaryKey]
        : raw.primary_key
          ? [raw.primary_key]
          : [];

  // Collect FK column names for role inference
  const rawFKs: RawForeignKey[] = raw.foreign_keys ?? raw.foreignKeys ?? [];
  const fkColumns = new Set<string>(
    rawFKs.flatMap((fk) => fk.from?.columns ?? (fk.column ? [fk.column] : []))
  );

  const columns: Column[] = (raw.columns ?? []).map((c) =>
    normalizeColumn(c, primaryKeys, fkColumns)
  );

  const foreignKeys: ForeignKey[] = rawFKs
    .map((fk) => normalizeForeignKey(fk, schemaName, tableName))
    .filter((fk): fk is ForeignKey => fk !== null);

  // Infer PK from columns if not provided
  const inferredPK =
    primaryKeys[0] ||
    columns.find((c) => c.role === "primary_key")?.name ||
    columns.find((c) => {
      const bare = stripColumnPrefix(c.name.toLowerCase());
      return bare === "id" || bare.endsWith("id");
    })?.name ||
    "id";

  // Descriptions
  const desc = raw.descriptions;
  const meta: TableMeta = {
    triggers: desc?.triggers ?? [],
    checkConstraints: desc?.check_constraints ?? [],
    indexes: desc?.indexes ?? [],
  };

  return {
    id,
    schema: schemaName,
    name: tableName,
    primaryKey: inferredPK,
    primaryKeys: primaryKeys.length > 0 ? primaryKeys : [inferredPK],
    columns,
    foreignKeys,
    domain: inferDomain(schemaName, raw.domain ?? providedDomain),
    entityType: raw.entityType ?? inferEntityType(tableName),
    description: desc?.table_description ?? undefined,
    meta,
    isMemoryOptimized: raw.is_memory_optimized ?? false,
    temporalType: raw.temporal_type ?? undefined,
  };
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

  // Format 1: { tables: RawTable[] }  — actual AcaciaHealth format
  if (Array.isArray(raw.tables)) {
    for (const t of raw.tables) {
      addTable(normalizeTable(t, "dbo"));
    }
  }
  // Format 2: { tables: Record<name, RawTable> }
  else if (raw.tables && typeof raw.tables === "object") {
    for (const [name, t] of Object.entries(raw.tables as Record<string, RawTable>)) {
      addTable(normalizeTable({ ...t, name: t.name ?? (t.table ?? name) }, "dbo"));
    }
  }

  // Format 3: { schemas: { schemaName: { tables: ... } } }
  if (raw.schemas) {
    for (const [schemaName, schemaDef] of Object.entries(raw.schemas)) {
      const domain = schemaDef.domain;
      const schemaTables = schemaDef.tables;
      if (Array.isArray(schemaTables)) {
        for (const t of schemaTables) {
          addTable(normalizeTable({ ...t, schema: t.schema ?? schemaName }, schemaName, domain));
        }
      } else if (schemaTables && typeof schemaTables === "object") {
        for (const [name, t] of Object.entries(schemaTables as Record<string, RawTable>)) {
          addTable(
            normalizeTable(
              { ...t, table: t.table ?? t.name ?? name, schema: schemaName },
              schemaName,
              domain
            )
          );
        }
      }
    }
  }

  return tables;
}
