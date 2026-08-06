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
const CACHE_VERSION = "v2";

function presentationForIntent(type: string) {
  if (type === "KPI") return { responseType: "KPI" as const, chartType: "none" as const };
  if (type === "SUMMARY") return { responseType: "SUMMARY_TEXT" as const, chartType: "none" as const };
  if (type === "TREND") return { responseType: "CHART" as const, chartType: "line" as const };
  if (type === "TOP_N" || type === "COMPARISON") {
    return { responseType: "CHART" as const, chartType: "bar" as const };
  }
  return { responseType: "TABLE" as const, chartType: "none" as const };
}

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { query, startDate, endDate, branchCode, clarificationAnswers } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const skipCache = !!(clarificationAnswers && Object.keys(clarificationAnswers).length);
    const cacheKey = buildCacheKey(`gateway-semantic:${CACHE_VERSION}:${query}`, {
      startDate,
      endDate,
      branchCode,
    });

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

    const { responseType, chartType } = presentationForIntent(result.intent.type);
    const primaryTable = result.semanticContext.resolvedTables[0] ?? "";
    const topN = query.match(/\btop\s+(\d+)\b/i);
    const limit = topN ? Number.parseInt(topN[1], 10) : 100;
    const pipelineStages = result.pipeline.map((stage) => ({
      stage: stage.stage,
      status:
        stage.status === "ok"
          ? ("ok" as const)
          : stage.status === "error"
            ? ("ambiguous" as const)
            : ("skipped" as const),
      note: stage.note ?? "",
    }));
    const warnings = [
      ...result.validation.warnings,
      ...result.pipeline
        .filter((stage) => stage.status === "fallback" || stage.status === "error")
        .map((stage) => stage.note ?? `${stage.stage} used a fallback`),
    ];

    // Preserve the SemanticResponse contract consumed by SemanticQueryPanel while
    // retaining the gateway's validated, read-only SQL for the editor handoff.
    const response = {
      resolvedQuery: query.trim(),
      intent: {
        type: result.intent.type,
        operation:
          result.intent.type === "TOP_N"
            ? "RANK"
            : result.intent.type === "COMPARISON"
              ? "COMPARE"
              : result.intent.type === "AGGREGATION" || result.intent.type === "KPI"
                ? "AGGREGATE"
                : "",
      },
      context: {
        table: primaryTable,
        filters: result.intent.filters,
        dimensions: result.intent.dimensions,
        metrics: result.intent.metrics,
      },
      logicalPlan:
        result.intent.type === "CLARIFICATION"
          ? null
          : {
              table: primaryTable,
              select: result.intent.dimensions,
              aggregations: result.intent.metrics.map((metric) => ({
                metric,
                function: "MEASURE" as const,
                alias: metric,
              })),
              groupBy: result.intent.dimensions,
              filters: [],
              orderBy:
                result.intent.type === "TOP_N" && result.intent.metrics[0]
                  ? [{ field: result.intent.metrics[0], direction: "DESC" as const }]
                  : [],
              limit,
            },
      clarification:
        result.intent.type === "CLARIFICATION"
          ? { question: result.explanation, options: [] }
          : null,
      response: {
        type: responseType,
        data: [],
        presentation: {
          chartType,
          xAxis: result.intent.dimensions[0] ?? "",
          yAxis: result.intent.metrics[0] ?? "",
          groupBy: result.intent.dimensions,
          limit,
        },
      },
      pipelineStages,
      metadata: {
        source: "powerbi_json" as const,
        confidence: result.confidence,
        warnings,
      },
      sql: result.sql,
      explanation: result.explanation,
      validation: result.validation,
      lineage: result.lineage,
      governance: result.governance,
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
