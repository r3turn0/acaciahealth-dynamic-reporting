export const runtime = "nodejs";

// GET /api/registry
// Returns the schema registry: every table + column that MAY be exposed.
// The Table Selection UI reads this to let users scope a data contract.

import { NextResponse } from "next/server";
import { listSchemas } from "@/lib/access/schemaRegistry";

export async function GET() {
  try {
    const schemas = await listSchemas();
    return NextResponse.json({ schemas });
  } catch (err) {
    console.error("[access] /api/registry error:", err);
    return NextResponse.json({ error: "Failed to load schema registry" }, { status: 500 });
  }
}
