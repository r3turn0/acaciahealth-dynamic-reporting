/**
 * POST /api/agents/normalise-metadata
 * Normalise a raw metadata.json payload, auto-index into vector store, emit SCHEMA_UPDATED.
 *
 * Body: { raw: <raw metadata.json content>, source?: "upload" | "live_db" }
 *
 * Workflow:
 *   1. MetadataNormalizationAgent — parse + normalise
 *   2. VectorEmbeddingAgent — index tables / columns / relationships
 *   3. Return normalised schema + index stats
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { metadataNormalizationAgent } from "@/lib/agents/MetadataNormalizationAgent";
import { vectorEmbeddingAgent }       from "@/lib/agents/VectorEmbeddingAgent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { raw, source = "upload" } = body as {
      raw:     unknown;
      source?: "upload" | "live_db";
    };

    if (!raw) {
      return NextResponse.json({ error: "raw metadata payload is required" }, { status: 400 });
    }

    // Step 1: Normalise
    const normResult = await metadataNormalizationAgent.run({ raw, source });

    // Step 2: Index into vector store (async — non-blocking for response)
    let indexResult = { inserted: 0, skipped: 0, corpusName: "metadata" };
    try {
      indexResult = await vectorEmbeddingAgent.indexMetadata({
        metadata: normResult.normalised,
        force:    false,
      });
    } catch (indexErr) {
      normResult.warnings.push(
        `Vector indexing failed (non-fatal): ${indexErr instanceof Error ? indexErr.message : String(indexErr)}`
      );
    }

    return NextResponse.json({
      success:           true,
      tableCount:        normResult.tableCount,
      columnCount:       normResult.columnCount,
      relationshipCount: normResult.relationshipCount,
      warnings:          normResult.warnings,
      vectorIndex:       indexResult,
      normalised:        normResult.normalised,
      generatedAt:       new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
