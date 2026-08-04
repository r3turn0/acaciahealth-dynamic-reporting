/**
 * POST /api/agents/vector-embed
 * Index metadata + KPIs into the vector store.
 * Called after MetadataNormalizationAgent uploads a schema.
 *
 * Body: { metadata: NormalisedMetadata }
 *
 * GET  /api/agents/vector-embed?query=<str>&topK=<n>
 * Perform a semantic similarity search and return ContextPayload.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { vectorEmbeddingAgent } from "@/lib/agents/VectorEmbeddingAgent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { metadata, force = false } = body as {
      metadata: Parameters<typeof vectorEmbeddingAgent.indexMetadata>[0]["metadata"];
      force?: boolean;
    };

    if (!metadata) {
      return NextResponse.json({ error: "metadata is required" }, { status: 400 });
    }

    const result = await vectorEmbeddingAgent.indexMetadata({ metadata, force });

    return NextResponse.json({ ...result, success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim();
  const topK  = parseInt(searchParams.get("topK") ?? "8", 10);

  if (!query) {
    return NextResponse.json({ error: "query parameter is required" }, { status: 400 });
  }

  try {
    const results = await vectorEmbeddingAgent.search({ query, topK });
    const context = vectorEmbeddingAgent.buildContext(results);

    return NextResponse.json({ results, context, query, topK });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
