/**
 * POST /api/vector-search
 *
 * Performs vector similarity search across the schema corpus, saved reports,
 * and fix history to retrieve the most relevant context for a user query.
 *
 * Request:
 *   query        – natural language search query
 *   types        – optional array of CorpusDocType to filter by
 *   topK         – max results to return (default 8)
 *   savedReports – optional array of saved report objects
 *   fixLog       – optional array of fix history entries
 *
 * Response:
 *   results      – ranked array of { type, content, score, metadata }
 *   formattedContext – injected context string ready for AI prompts
 */

import { NextRequest, NextResponse } from "next/server";
import { vectorSearch, formatVectorContext } from "@/lib/ai/vectorSearch";
import type { CorpusDocType } from "@/lib/ai/vectorSearch";

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
    });
  } catch (err) {
    console.error("[vector-search] error:", err);
    return NextResponse.json(
      { error: "Vector search failed", results: [], formattedContext: "" },
      { status: 500 }
    );
  }
}
