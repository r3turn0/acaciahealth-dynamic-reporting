/**
 * /api/tables
 *
 * Returns the full list of tables and views in the connected SQL Server database.
 * This route NEVER uses the schema cache — it always queries sys.objects fresh
 * so the dropdown in Discover Data always reflects the real database.
 */

import { NextResponse } from "next/server";
import { isDbConfigured, executeRawQuery } from "@/lib/services/db";

const TABLES_SQL = `
  SELECT
    s.name  AS table_schema,
    o.name  AS table_name,
    CASE o.type
      WHEN 'U' THEN 'BASE TABLE'
      WHEN 'V' THEN 'VIEW'
      ELSE 'BASE TABLE'
    END     AS table_type
  FROM sys.objects  o
  JOIN sys.schemas  s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U', 'V')
    AND o.is_ms_shipped = 0
  ORDER BY o.type DESC, o.name
`;

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { source: "static_config", tables: [], error: "Database not configured" },
      { status: 200 }
    );
  }

  try {
    const rows = await executeRawQuery(TABLES_SQL) as {
      table_schema: string;
      table_name: string;
      table_type: string;
    }[];

    const tables = rows.map((r) => ({
      table_schema: r.table_schema,
      table_name: r.table_name,
      table_type: r.table_type,
      // Qualified name: omit schema prefix for dbo (most common)
      qualified_name:
        r.table_schema === "dbo" ? r.table_name : `${r.table_schema}.${r.table_name}`,
    }));

    return NextResponse.json({
      source: "live_db",
      count: tables.length,
      tables,
    });
  } catch (err) {
    console.error("[v0] /api/tables error:", (err as Error).message);
    return NextResponse.json(
      { source: "error", tables: [], error: (err as Error).message },
      { status: 500 }
    );
  }
}
