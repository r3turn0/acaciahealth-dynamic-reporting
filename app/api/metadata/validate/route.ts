/**
 * GET  /api/metadata/validate
 * POST /api/metadata/validate
 *
 * Runs the full 8-check metadata validation pipeline and returns a
 * MetadataHealthReport.
 *
 * GET  — uses the static catalog only (fast, always available)
 * POST — accepts { liveDbTables: [...] } to merge live DB results before
 *         running checks; the client fetches /api/schema/tables first and
 *         passes the results here for a full end-to-end validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { runValidation } from "@/lib/services/metadataRegistry";
import { isDbConfigured, executeRawQuery } from "@/lib/services/db";

const CACHE_TTL_MS = 30_000; // 30 s server-side cache to avoid hammering the DB

let _cachedReport: Awaited<ReturnType<typeof runValidation>> | null = null;
let _cacheTs = 0;

async function fetchLiveTables(): Promise<{ table_schema: string; table_name: string }[]> {
  if (!isDbConfigured()) return [];
  try {
    const rows = await executeRawQuery(`
      SELECT s.name AS table_schema, o.name AS table_name
      FROM   sys.objects  o
      JOIN   sys.schemas  s ON s.schema_id = o.schema_id
      WHERE  o.type IN ('U','V') AND o.is_ms_shipped = 0
    `) as { table_schema: string; table_name: string }[];
    return rows;
  } catch {
    return [];
  }
}

export async function GET() {
  // Serve from cache if fresh
  if (_cachedReport && Date.now() - _cacheTs < CACHE_TTL_MS) {
    return NextResponse.json(_cachedReport, {
      headers: { "X-Cache": "HIT", "Cache-Control": "no-store" },
    });
  }

  const liveDbTables = await fetchLiveTables();
  const report       = runValidation({ liveDbTables });

  _cachedReport = report;
  _cacheTs      = Date.now();

  return NextResponse.json(report, {
    headers: { "X-Cache": "MISS", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  // Invalidate cache on explicit refresh request
  _cachedReport = null;
  _cacheTs      = 0;

  let liveDbTables: { table_schema: string; table_name: string }[] = [];
  try {
    const body = await req.json() as { liveDbTables?: typeof liveDbTables };
    if (Array.isArray(body.liveDbTables)) {
      liveDbTables = body.liveDbTables;
    } else {
      // If caller didn't pass live tables, fetch from DB ourselves
      liveDbTables = await fetchLiveTables();
    }
  } catch {
    liveDbTables = await fetchLiveTables();
  }

  const report = runValidation({ liveDbTables });

  _cachedReport = report;
  _cacheTs      = Date.now();

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
