/**
 * GET /api/schema
 * GET /api/schema?tablesOnly=true  — fast no-cache list of every table/view
 * GET /api/schema?refresh=true     — bust the 60-min schema cache
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSchemaIntelligence } from "@/lib/agents/schemaAgent";
import { invalidateCache } from "@/lib/services/cache";
import { isDbConfigured, executeRawQuery } from "@/lib/services/db";

const SCHEMA_CACHE_KEY = "schema_intelligence_v4";

const TABLES_SQL = `
  SELECT
    s.name AS table_schema,
    o.name AS table_name,
    CASE o.type WHEN 'U' THEN 'BASE TABLE' WHEN 'V' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
  FROM sys.objects  o
  JOIN sys.schemas  s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
  ORDER BY o.type DESC, o.name
`;

export async function GET(req: NextRequest) {
  try {
    const tablesOnly = req.nextUrl.searchParams.get("tablesOnly") === "true";

    // Fast path: just return table names, no cache, no column introspection
    if (tablesOnly) {
      if (!isDbConfigured()) {
        return NextResponse.json({ source: "static_config", tables: [], count: 0 });
      }
      const rows = await executeRawQuery(TABLES_SQL) as {
        table_schema: string; table_name: string; table_type: string;
      }[];
      const tables = rows.map((r) => ({
        table_schema: r.table_schema,
        table_name:   r.table_name,
        table_type:   r.table_type,
        qualified_name: r.table_schema === "dbo" ? r.table_name : `${r.table_schema}.${r.table_name}`,
      }));
      return NextResponse.json({ source: "live_db", count: tables.length, tables });
    }

    // Full schema path (cached)
    const refresh = req.nextUrl.searchParams.get("refresh") === "true";
    if (refresh) invalidateCache(SCHEMA_CACHE_KEY);
    const schema = await getSchemaIntelligence();
    return NextResponse.json(schema);
  } catch (err) {
    console.error("[v0] /api/schema error:", (err as Error).message);
    return NextResponse.json({ error: "Failed to retrieve schema" }, { status: 500 });
  }
}
