/**
 * GET /api/schema/tables
 * Self-contained, no-cache endpoint that returns every table and view
 * from sys.objects. No dependency on schemaAgent or its cache.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/services/db";
import { getLiveTableCatalog } from "@/lib/services/tableCatalog";

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
    const catalog = await getLiveTableCatalog();

    return NextResponse.json({
      source: "live_db",
      count: catalog.tables.length,
      tables: catalog.tables,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[v0] /api/schema/tables error:", msg);
    return NextResponse.json({ source: "error", count: 0, tables: [], error: msg });
  }
}
