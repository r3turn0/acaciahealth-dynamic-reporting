// POST /api/schema/metadata
// Accepts raw metadata.json body, parses it into SchemaModel, caches server-side.
// GET  /api/schema/metadata
// Returns the cached SchemaModel (or 404 if not yet ingested).

import { NextRequest, NextResponse } from "next/server";
import { parseMetadata } from "@/lib/schema/parser";
import { transformToSchemaModel, mergeSchemaModel } from "@/lib/schema/transformer";
import type { RawMetadata, SchemaModel } from "@/lib/schema/types";

// Server-side in-memory cache (persists across requests within the same process)
let serverCachedModel: SchemaModel | null = null;

export async function GET() {
  if (!serverCachedModel) {
    return NextResponse.json(
      { error: "No metadata ingested yet. POST to /api/schema/metadata first." },
      { status: 404 }
    );
  }
  return NextResponse.json(serverCachedModel);
}

export async function POST(req: NextRequest) {
  let body: RawMetadata;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  // Parse + validate
  const tables = parseMetadata(body);

  if (tables.length === 0) {
    return NextResponse.json(
      { error: "No tables found in metadata. Expected `tables`, `schemas`, or both keys." },
      { status: 422 }
    );
  }

  // Support incremental updates (merge with existing model)
  const url = new URL(req.url);
  const incremental = url.searchParams.get("incremental") === "true";

  if (incremental && serverCachedModel) {
    serverCachedModel = mergeSchemaModel(serverCachedModel, tables);
  } else {
    serverCachedModel = transformToSchemaModel(tables, body);
  }

  return NextResponse.json(
    {
      ok: true,
      tableCount: tables.length,
      domainCount: Object.keys(serverCachedModel.domains).length,
      edgeCount: serverCachedModel.graph.edges.length,
      sourceHash: serverCachedModel.sourceHash,
      generatedAt: serverCachedModel.generatedAt,
      model: serverCachedModel,
    },
    { status: 200 }
  );
}

export async function DELETE() {
  serverCachedModel = null;
  return NextResponse.json({ ok: true, message: "Schema model cleared." });
}
