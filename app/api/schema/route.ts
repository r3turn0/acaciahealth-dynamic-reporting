/**
 * GET /api/schema
 * Schema Intelligence Agent endpoint.
 * Returns structured metadata: tables, columns, relationships, semantic layer.
 * Reads live from INFORMATION_SCHEMA when DB is connected; falls back to static config.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSchemaIntelligence } from "@/lib/agents/schemaAgent";
import { invalidateCache } from "@/lib/services/cache";

const SCHEMA_CACHE_KEY = "schema_intelligence_v3";

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "true";
    if (refresh) {
      invalidateCache(SCHEMA_CACHE_KEY);
    }
    const schema = await getSchemaIntelligence();
    return NextResponse.json(schema);
  } catch (err) {
    console.error("[v0] /api/schema error:", err);
    return NextResponse.json({ error: "Failed to retrieve schema" }, { status: 500 });
  }
}
