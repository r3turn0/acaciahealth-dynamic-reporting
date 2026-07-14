/**
 * POST /api/generate-query
 * AI Query Planner Agent endpoint.
 * Accepts a natural language prompt, returns a QueryPlan with generated SQL,
 * explanation, cost analysis, and execution strategy.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { planQuery } from "@/lib/agents/queryPlanner";
import { generateAiQuery } from "@/lib/services/aiQueryService";
import { generateSQL } from "@/lib/services/queryGenerator";
import { validateQuery } from "@/lib/services/queryGuard";
import { parameterizeDates } from "@/lib/services/dateParams";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import { isAiConfigured, getModelId } from "@/lib/ai/gateway";
import type { QueryPlan } from "@/lib/agents/queryPlanner";

const PLAN_CACHE_TTL = 5 * 60 * 1000; // 5 min for plans

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    const body = await req.json();
    const { prompt, start_date, end_date, branch_code, role } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!start_date || !end_date) {
      return NextResponse.json(
        { error: "start_date and end_date are required" },
        { status: 400 }
      );
    }

    // Cache check
    const cacheKey = buildCacheKey(`plan:${prompt}`, { start_date, end_date, branch_code });
    const cached = getCache<QueryPlan>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cache_hit: true,
        elapsed_ms: Date.now() - start,
        ai_powered: true,
      });
    }

    // Determine whether AI is available
    const aiAvailable = isAiConfigured();

    // Structured builder state (sent by the Visual Query Builder) lets the
    // rule-based fallback honor the chosen KPI, grouping, and ordering.
    const builder = body.builder as
      | { kpi?: string; group_by?: string[]; order_by?: string; order_dir?: "ASC" | "DESC"; limit?: number }
      | undefined;

    let plan: QueryPlan;
    let aiUsed = false;

    // Try the AI Query Planner Agent first, but NEVER let an AI failure
    // (missing/invalid key, gateway/network error, timeout) break the endpoint.
    // Any failure gracefully degrades to the deterministic rule-based generator.
    if (aiAvailable) {
      try {
        // Try the schema-aware aiQueryService first (GPT-4o + confidence score).
        // Falls back to the legacy planQuery if it errors.
        const aiResult = await generateAiQuery({
          userPrompt: prompt,
          startDate: start_date,
          endDate: end_date,
          branchCode: branch_code,
          role: role ?? "analyst",
        });
        if (!aiResult.plan || (aiResult.plan.strategy === "sql" && !aiResult.plan.sql?.trim())) {
          throw new Error("AI service returned an empty plan");
        }
        plan = {
          ...aiResult.plan,
          // Surface confidence score in the response payload
          confidence_score: aiResult.plan.confidenceScore,
        } as QueryPlan & { confidence_score: number };
        aiUsed = true;
      } catch (aiErr) {
        console.error("[v0] aiQueryService failed, trying legacy planQuery:", aiErr);
        try {
          plan = await planQuery({
            prompt,
            startDate: start_date,
            endDate: end_date,
            branchCode: branch_code,
            role: role ?? "analyst",
          });
          if (!plan || (plan.strategy === "sql" && !plan.sql?.trim())) {
            throw new Error("AI planner returned an empty plan");
          }
          aiUsed = true;
        } catch (legacyErr) {
          console.error("[v0] Legacy planner also failed, using rule-based:", legacyErr);
          plan = ruleBasedPlan(prompt, start_date, end_date, branch_code, builder);
        }
      }
    } else {
      plan = ruleBasedPlan(prompt, start_date, end_date, branch_code, builder);
    }

    // Normalize any hardcoded date literals to @StartDate / @EndDate so the
    // SQL Editor shows a query the date pickers actually control.
    if (plan.strategy === "sql") {
      plan.sql = parameterizeDates(plan.sql).sql;
      if (plan.optimized_suggestion) {
        plan.optimized_suggestion = parameterizeDates(plan.optimized_suggestion).sql;
      }
    }

    // Always validate the generated SQL
    if (plan.strategy === "sql") {
      const validation = validateQuery(plan.sql);
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: "Generated SQL failed security validation",
            details: validation.errors,
            plan,
          },
          { status: 422 }
        );
      }
    }

    setCache(cacheKey, plan, PLAN_CACHE_TTL);

    return NextResponse.json({
      ...plan,
      cache_hit: false,
      elapsed_ms: Date.now() - start,
      ai_powered: aiUsed,
    });
  } catch (err) {
    console.error("[db] generate-query error:", err);
    return NextResponse.json({ error: "Query generation failed" }, { status: 500 });
  }
}

// ── Rule-based fallback ─────────────────────────────────────────────────────
// Deterministic query plan used when AI is unavailable or errors out. Wraps the
// existing queryGenerator so the endpoint always returns a usable plan.
function ruleBasedPlan(
  prompt: string,
  start_date: string,
  end_date: string,
  branch_code: string | undefined,
  builder?: { kpi?: string; group_by?: string[]; order_by?: string; order_dir?: "ASC" | "DESC"; limit?: number }
): QueryPlan {
  const generated = generateSQL(prompt, {
    date_range: { start_date, end_date },
    branch_code,
    group_by: builder?.group_by,
    order_by: builder?.order_by,
    order_dir: builder?.order_dir,
    limit: builder?.limit,
  });

  return {
    sql: generated.sql,
    explanation: `Rule-based query for KPI: ${generated.kpi}. Detects keywords in your prompt and selects from the matching fact table.`,
    tables_used:
      generated.tables_used?.length > 0
        ? generated.tables_used
        : [generated.sql.match(/FROM\s+([\w.]+)/i)?.[1] ?? "CLIENT_EPISODES_ALL"],
    filters_applied: generated.filters_applied ?? [
      `Date range: ${start_date} to ${end_date}`,
      ...(branch_code ? [`Branch: ${branch_code}`] : []),
    ],
    kpi_detected: generated.kpi,
    strategy: "sql",
    api_fallback_reason: null,
    cost_warning: null,
    optimized_suggestion: null,
  };
}
