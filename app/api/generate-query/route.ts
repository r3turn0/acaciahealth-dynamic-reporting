/**
 * POST /api/generate-query
 * AI Query Planner Agent endpoint.
 * Accepts a natural language prompt, returns a QueryPlan with generated SQL,
 * explanation, cost analysis, and execution strategy.
 */

import { NextRequest, NextResponse } from "next/server";
import { planQuery } from "@/lib/agents/queryPlanner";
import { generateSQL } from "@/lib/services/queryGenerator";
import { validateQuery } from "@/lib/services/queryGuard";
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

    let plan: QueryPlan;

    if (aiAvailable) {
      // Use the AI Query Planner Agent
      plan = await planQuery({
        prompt,
        startDate: start_date,
        endDate: end_date,
        branchCode: branch_code,
        role: role ?? "analyst",
      });
    } else {
      // Rule-based fallback — wraps existing queryGenerator
      const generated = generateSQL(prompt, {
        date_range: { start_date, end_date },
        branch_code,
      });

      plan = {
        sql: generated.sql,
        explanation: `Rule-based query for KPI: ${generated.kpi}. Detects keywords in your prompt and selects from the matching fact table.`,
        tables_used: [
          generated.sql.match(/FROM\s+([\w.]+)/i)?.[1] ?? "CLIENT_EPISODES_ALL",
        ],
        filters_applied: [
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
      ai_powered: aiAvailable,
    });
  } catch (err) {
    console.error("[v0] generate-query error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
