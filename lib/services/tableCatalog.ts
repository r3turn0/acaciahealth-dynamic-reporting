import "server-only";

import { withCache } from "@/lib/services/cache";
import { executeRawQuery } from "@/lib/services/db";

export interface LiveTableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
}

export interface LiveTableEntry extends LiveTableRow {
  canonical_name: string;
  qualified_name: string;
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
      const rows = await executeRawQuery(TABLE_CATALOG_SQL);
      return buildLiveTableCatalog(
        rows.map((row) => ({
          table_schema: String(row.table_schema),
          table_name: String(row.table_name),
          table_type: String(row.table_type),
        }))
      );
    },
    {
      ttlMs: TABLE_CATALOG_TTL_MS,
      namespace: "metadata",
      tags: ["table-catalog"],
    }
  );

  return value;
}
