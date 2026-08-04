/**
 * GET /api/schema/debug
 * Diagnostic endpoint — runs the sys catalog query directly and returns
 * the raw row count, first 5 table names, and any error message.
 * Remove or protect this route before going to production.
 */

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/services/db";

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({
      ok: false,
      error: "DB not configured — no DB_HOST/DB_NAME/DB_USER/DB_PASS found in env",
    });
  }

  try {
    const { executeRawQuery } = await import("@/lib/services/db");

    // 1. Quick connectivity check
    await executeRawQuery("SELECT 1 AS ok");

    // 2. Count tables via INFORMATION_SCHEMA (old method)
    const infoRows = await executeRawQuery(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
    `);

    // 3. Count tables via sys catalog (new method)
    const sysRows = await executeRawQuery(`
      SELECT COUNT(*) AS cnt
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('U', 'V')
        AND o.is_ms_shipped = 0
    `);

    // 4. Sample first 10 table names from sys catalog
    const sampleRows = await executeRawQuery(`
      SELECT TOP 10
        s.name AS schema_name,
        o.name AS table_name,
        CASE o.type WHEN 'U' THEN 'BASE TABLE' WHEN 'V' THEN 'VIEW' ELSE o.type END AS type
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('U', 'V')
        AND o.is_ms_shipped = 0
      ORDER BY o.name
    `);

    return NextResponse.json({
      ok: true,
      information_schema_count: infoRows[0]?.cnt ?? 0,
      sys_catalog_count: sysRows[0]?.cnt ?? 0,
      sample_tables: sampleRows,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: (err as Error).message,
      stack: (err as Error).stack?.split("\n").slice(0, 5),
    });
  }
}
