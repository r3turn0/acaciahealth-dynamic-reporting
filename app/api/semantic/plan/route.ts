/**
 * POST /api/semantic/plan  →  GATEWAY ADAPTER
 *
 * Semantic query planning now routes through QueryGateway (planOnly=true).
 * All 9 pipeline stages are enforced — intent, semantic search, pattern
 * retrieval, SQL generation, and validation — before any plan is returned.
 * SemanticResponse shape preserved for callers.
 */

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";

const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { query, startDate, endDate, branchCode, clarificationAnswers } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const skipCache = !!(clarificationAnswers && Object.keys(clarificationAnswers).length);
    const cacheKey = buildCacheKey(`gateway-semantic:${query}`, { startDate, endDate, branchCode });

    if (!skipCache) {
      const cached = getCache(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true, elapsed_ms: Date.now() - start });
      }
    }

    const defaultEnd   = new Date().toISOString().split("T")[0];
    const defaultStart = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];

    const result = await runQueryGateway({
      query: query.trim(),
      source: "natural_language",
      startDate: startDate ?? defaultStart,
      endDate:   endDate   ?? defaultEnd,
      branchCode,
      planOnly: true,
    });

    // Build SemanticResponse-compatible shape
    const response = {
      intent:      result.intent,
      sql:         result.sql,
      explanation: result.explanation,
      confidence:  result.confidence,
      tables:      result.semanticContext.resolvedTables,
      kpiDefs:     result.semanticContext.kpiDefinitions,
      joinPaths:   result.semanticContext.joinPaths,
      validation:  result.validation,
      lineage:     result.lineage,
      pipeline:    result.pipeline,
      governance:  result.governance,
      approvedPattern: result.approvedPattern,
      cached: false,
      elapsed_ms: Date.now() - start,
    };

    if (!skipCache) setCache(cacheKey, response, CACHE_TTL);

    return NextResponse.json(response);
  } catch (err) {
    console.error("[Gateway→semantic/plan] error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
