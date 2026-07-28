/**
 * app/api/admin/apcs/route.ts
 *
 * APCS Admin API — exposes compaction metrics, dictionary, macros,
 * RAG stats, failure memory, and learned facts for the Admin UI.
 *
 * GET  /api/admin/apcs         — aggregate + recent session metrics
 * POST /api/admin/apcs/compact — test-compact a supplied prompt
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAggregateMetrics,
  getCompactionMetrics,
  getAllFailureMemory,
  getAllLearnedFacts,
  getRagStats,
} from "@/lib/ai/apcs/PromptStore";
import { getPromptCompactor } from "@/lib/ai/apcs/PromptCompactor";
import { applyAPCS } from "@/lib/ai/apcs/APCSPipeline";

export async function GET() {
  try {
    const aggregate   = getAggregateMetrics();
    const recentSessions = getCompactionMetrics(20);
    const failureMemory  = getAllFailureMemory().slice(0, 20);
    const learnedFacts   = getAllLearnedFacts(20);
    const ragStats       = getRagStats();
    const compactor      = getPromptCompactor();
    const dictionary     = compactor.getDictionary();
    const macros         = compactor.getMacros();
    const sqlTemplates   = compactor.getSqlTemplates();

    return NextResponse.json({
      aggregate,
      recentSessions,
      failureMemory,
      learnedFacts,
      ragStats,
      dictionary: dictionary.map(({ key, category, tokens, version }) => ({
        key, category, tokens, version,
      })),
      macros: macros.map(({ key, shorthand, expandedSteps }) => ({
        key, shorthand, stepCount: expandedSteps.length,
      })),
      sqlTemplates: sqlTemplates.map(({ key, example }) => ({
        key,
        examplePreview: example.slice(0, 120) + (example.length > 120 ? "…" : ""),
      })),
    });
  } catch (err) {
    console.error("[/api/admin/apcs] GET error:", err);
    return NextResponse.json({ error: "Failed to load APCS metrics" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { prompt?: string };
    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const result = applyAPCS({ systemPrompt: body.prompt });

    return NextResponse.json({
      originalPrompt:   body.prompt.slice(0, 500),
      compactedPrompt:  result.payload.compactedSystemPrompt.slice(0, 500),
      originalTokens:   result.payload.originalTokens,
      compactedTokens:  result.payload.compactedTokens,
      reductionPct:     result.payload.reductionPct,
      layersApplied:    result.payload.layersApplied,
      schemaHash:       result.payload.schemaHash,
      schemaCacheHit:   result.payload.schemaCacheHit,
      ragRefs:          result.payload.ragRefs,
      qsig:             result.payload.qsig,
      intentString:     result.payload.intentString,
      compressed:       result.compressed,
    });
  } catch (err) {
    console.error("[/api/admin/apcs] POST error:", err);
    return NextResponse.json({ error: "Compaction test failed" }, { status: 500 });
  }
}
