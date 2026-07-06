/**
 * POST /api/semantic/plan
 *
 * Runs the 7-stage Semantic Query Engine pipeline and returns a SemanticResponse.
 * Input:  { query, startDate?, endDate?, branchCode?, clarificationAnswers? }
 * Output: SemanticResponse (see lib/agents/semanticQueryEngine.ts)
 */

import { NextRequest, NextResponse } from "next/server";
import { runSemanticPipeline } from "@/lib/agents/semanticQueryEngine";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import type { SemanticResponse } from "@/lib/agents/semanticQueryEngine";

const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { query, startDate, endDate, branchCode, clarificationAnswers } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    // Skip cache when clarification answers are being folded in
    const skipCache = !!(clarificationAnswers && Object.keys(clarificationAnswers).length);
    const cacheKey = buildCacheKey(`semantic:${query}`, { startDate, endDate, branchCode });

    if (!skipCache) {
      const cached = getCache<SemanticResponse>(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true, elapsed_ms: Date.now() - start });
      }
    }

    const response = await runSemanticPipeline({
      query: query.trim(),
      startDate,
      endDate,
      branchCode,
      clarificationAnswers,
    });

    if (!skipCache) setCache(cacheKey, response, CACHE_TTL);

    return NextResponse.json({ ...response, cached: false, elapsed_ms: Date.now() - start });
  } catch (err) {
    console.error("[semantic/plan] error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
