import "server-only";

import { withCache } from "@/lib/services/cache";
import { executeRawQuery } from "@/lib/services/db";

export interface LiveTableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
}

export interface LiveColumnEntry {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}

export interface LiveTableEntry extends LiveTableRow {
  canonical_name: string;
  qualified_name: string;
  estimated_row_count?: number;
  columns?: LiveColumnEntry[];
}

export interface LiveTableCatalog {
  tables: LiveTableEntry[];
  canonicalNames: Set<string>;
}

const TABLE_CATALOG_CACHE_KEY = "metadata:live-table-catalog:v1";
const TABLE_CATALOG_TTL_MS = 60_000;
const TABLE_IDENTIFIER = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/;

const TABLE_CATALOG_SQL = `
  SELECT
    s.name AS table_schema,
    o.name AS table_name,
    CASE o.type WHEN 'U' THEN 'BASE TABLE' WHEN 'V' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
  FROM sys.objects o
  JOIN sys.schemas s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U', 'V')
    AND o.is_ms_shipped = 0
  ORDER BY o.type DESC, o.name
`;

/** Normalize an allowlisted one- or two-part SQL Server identifier. */
export function normalizeTableIdentifier(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!TABLE_IDENTIFIER.test(trimmed)) return null;
  return trimmed.includes(".") ? trimmed : `dbo.${trimmed}`;
}

export function buildLiveTableCatalog(rows: LiveTableRow[]): LiveTableCatalog {
  const tables = rows.map((row) => {
    const canonicalName = `${row.table_schema}.${row.table_name}`;
    return {
      ...row,
      canonical_name: canonicalName,
      qualified_name: row.table_schema.toLowerCase() === "dbo"
        ? row.table_name
        : canonicalName,
    };
  });

  return {
    tables,
    canonicalNames: new Set(tables.map((table) => table.canonical_name.toLowerCase())),
  };
}

export function isTableInCatalog(identifier: string, catalog: LiveTableCatalog): boolean {
  const normalized = normalizeTableIdentifier(identifier);
  return normalized !== null && catalog.canonicalNames.has(normalized.toLowerCase());
}

/** Load the live read-only SQL Server table/view catalog with request coalescing. */
export async function getLiveTableCatalog(): Promise<LiveTableCatalog> {
  const { value } = await withCache(
    TABLE_CATALOG_CACHE_KEY,
    async () => {
      const [rows, columnRows] = await Promise.all([
        executeRawQuery(TABLE_CATALOG_SQL),
        executeRawQuery(`
          SELECT
            s.name AS table_schema,
            o.name AS table_name,
            c.name AS column_name,
            ty.name AS data_type,
            c.is_nullable,
            CASE WHEN pk.column_id IS NULL THEN 0 ELSE 1 END AS is_primary_key,
            CASE WHEN fk.parent_column_id IS NULL THEN 0 ELSE 1 END AS is_foreign_key,
            COALESCE(rc.estimated_row_count, 0) AS estimated_row_count
          FROM sys.objects o
          JOIN sys.schemas s ON s.schema_id = o.schema_id
          JOIN sys.columns c ON c.object_id = o.object_id
          JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          LEFT JOIN (
            SELECT ic.object_id, ic.column_id
            FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            WHERE i.is_primary_key = 1
          ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
          LEFT JOIN sys.foreign_key_columns fk ON fk.parent_object_id = c.object_id AND fk.parent_column_id = c.column_id
          LEFT JOIN (
            SELECT object_id, SUM(rows) AS estimated_row_count
            FROM sys.partitions
            WHERE index_id IN (0, 1)
            GROUP BY object_id
          ) rc ON rc.object_id = o.object_id
          WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
          ORDER BY s.name, o.name, c.column_id
        `),
      ]);
      const catalog = buildLiveTableCatalog(
        rows.map((row) => ({
          table_schema: String(row.table_schema),
          table_name: String(row.table_name),
          table_type: String(row.table_type),
        }))
      );
      const byTable = new Map<string, LiveColumnEntry[]>();
      const rowCounts = new Map<string, number>();
      for (const row of columnRows) {
        const key = `${String(row.table_schema)}.${String(row.table_name)}`.toLowerCase();
        const columns = byTable.get(key) ?? [];
        columns.push({
          column_name: String(row.column_name),
          data_type: String(row.data_type),
          is_nullable: Boolean(row.is_nullable),
          is_primary_key: Boolean(row.is_primary_key),
          is_foreign_key: Boolean(row.is_foreign_key),
        });
        byTable.set(key, columns);
        rowCounts.set(key, Number(row.estimated_row_count) || 0);
      }
      catalog.tables = catalog.tables.map((table) => {
        const key = table.canonical_name.toLowerCase();
        return { ...table, columns: byTable.get(key) ?? [], estimated_row_count: rowCounts.get(key) ?? 0 };
      });
      return catalog;
    },
    {
      ttlMs: TABLE_CATALOG_TTL_MS,
      namespace: "metadata",
      tags: ["table-catalog"],
    }
  );

  return value;
}
