/**
 * GET /api/schema
 * Schema Intelligence Agent endpoint.
 * Returns structured metadata: tables, columns, relationships, semantic layer.
 * Reads live from INFORMATION_SCHEMA when DB is connected; falls back to static config.
 */

import { NextResponse } from "next/server";
import { getSchemaIntelligence } from "@/lib/agents/schemaAgent";

export async function GET() {
  try {
    const schema = await getSchemaIntelligence();
    return NextResponse.json(schema);
  } catch (err) {
    console.error("[v0] /api/schema error:", err);
    return NextResponse.json({ error: "Failed to retrieve schema" }, { status: 500 });
  }
}
