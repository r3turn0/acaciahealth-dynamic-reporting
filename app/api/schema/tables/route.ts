/**
 * GET /api/schema/tables
 * Self-contained, no-cache endpoint that returns every table and view
 * from sys.objects. No dependency on schemaAgent or its cache.
 */

import { NextResponse } from "next/server";
import { executeRawQuery, isDbConfigured } from "@/lib/services/db";

const SQL = `
  SELECT
    s.name AS table_schema,
    o.name AS table_name,
    CASE o.type WHEN 'U' THEN 'BASE TABLE' WHEN 'V' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
  FROM sys.objects  o
  JOIN sys.schemas  s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U','V')
    AND o.is_ms_shipped = 0
  ORDER BY o.type DESC, o.name
`;

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({
      source: "no_db",
      count: 0,
      tables: [],
      error: "No database credentials configured",
    });
  }

  try {
    const rows = await executeRawQuery(SQL) as {
      table_schema: string;
      table_name: string;
      table_type: string;
    }[];

    const tables = rows.map((r) => ({
      table_schema:   r.table_schema,
      table_name:     r.table_name,
      table_type:     r.table_type,
      qualified_name: r.table_schema === "dbo"
        ? r.table_name
        : `${r.table_schema}.${r.table_name}`,
    }));

    return NextResponse.json({
      source: "live_db",
      count: tables.length,
      tables,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[v0] /api/schema/tables error:", msg);
    return NextResponse.json({ source: "error", count: 0, tables: [], error: msg });
  }
}
