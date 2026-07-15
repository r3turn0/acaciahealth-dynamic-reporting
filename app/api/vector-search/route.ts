/**
 * POST /api/vector-search
 *
 * Vector similarity search over schema, saved reports, and fix history.
 * Uses pgvector when DATABASE_URL is configured; falls back to in-process
 * cosine similarity against metadata.json when Postgres is absent.
 *
 * Also exposes a GET /api/vector-search/seed endpoint to seed the schema
 * corpus from metadata.json into the pgvector `vectors` table.
 *
 * Request:
 *   query        – natural language search query
 *   types        – optional CorpusDocType[] filter
 *   topK         – max results (default 8)
 *   savedReports – optional saved report objects (for in-process fallback)
 *   fixLog       – optional fix history entries (for in-process fallback)
 *
 * Response:
 *   results          – ranked [{ type, content, score, metadata }]
 *   formattedContext – context block ready for AI prompts
 *   total            – result count
 *   backend          – "pgvector" | "in-process"
 */

import { NextRequest, NextResponse } from "next/server";
import { vectorSearch, formatVectorContext, seedSchemaCorpus } from "@/lib/ai/vectorSearch";
import { isPgVectorConfigured } from "@/lib/db/pgvectorClient";
import type { CorpusDocType } from "@/lib/ai/vectorSearch";

// ── POST /api/vector-search ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    query = "",
    types,
    topK = 8,
    savedReports = [],
    fixLog = [],
  } = body as {
    query: string;
    types?: CorpusDocType[];
    topK?: number;
    savedReports?: unknown[];
    fixLog?: unknown[];
  };

  if (!query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const results = await vectorSearch({
      query,
      topK,
      types,
      savedReports: savedReports as Parameters<typeof vectorSearch>[0]["savedReports"],
      fixLog: fixLog as Parameters<typeof vectorSearch>[0]["fixLog"],
    });

    return NextResponse.json({
      results,
      formattedContext: formatVectorContext(results),
      total: results.length,
      backend: isPgVectorConfigured() ? "pgvector" : "in-process",
    });
  } catch (err) {
    console.error("[vector-search] error:", err);
    return NextResponse.json(
      { error: "Vector search failed", results: [], formattedContext: "", total: 0 },
      { status: 500 }
    );
  }
}

// ── GET /api/vector-search?action=seed ────────────────────────────────────────
// Seeds schema corpus from metadata.json into the pgvector vectors table.
// Call once after running lib/db/setupVectors.ts.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") !== "seed") {
    return NextResponse.json({ error: "Unknown action. Use ?action=seed" }, { status: 400 });
  }

  if (!isPgVectorConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured — cannot seed pgvector corpus." },
      { status: 503 }
    );
  }

  try {
    const result = await seedSchemaCorpus();
    return NextResponse.json({ success: true, inserted: result.inserted });
  } catch (err) {
    console.error("[vector-search/seed] error:", err);
    return NextResponse.json({ error: "Seeding failed", detail: String(err) }, { status: 500 });
  }
}
