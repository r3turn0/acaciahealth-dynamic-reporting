import { NextRequest, NextResponse } from "next/server";
import { generateSQL } from "@/lib/services/queryGenerator";
import { validateQuery } from "@/lib/services/queryGuard";
import { executeQuery } from "@/lib/services/db";
import { formatReport } from "@/lib/services/formatter";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import type { ReportOutput } from "@/lib/services/formatter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { report_name, prompt, filters } = body;

    // Input validation
    if (!report_name || typeof report_name !== "string") {
      return NextResponse.json({ error: "report_name is required" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!filters?.date_range?.start_date || !filters?.date_range?.end_date) {
      return NextResponse.json(
        { error: "filters.date_range with start_date and end_date is required" },
        { status: 400 }
      );
    }

    // Cache check
    const cacheKey = buildCacheKey(prompt, filters);
    const cached = getCache<ReportOutput>(cacheKey);
    if (cached) {
      console.log("[v0] Cache hit for key:", cacheKey.slice(0, 12) + "...");
      return NextResponse.json({ ...cached, cache_hit: true });
    }

    // Generate SQL
    const { sql, params, kpi } = generateSQL(prompt, filters);
    console.log("[v0] Generated SQL for KPI:", kpi);

    // Validate SQL
    const validation = validateQuery(sql);
    if (!validation.valid) {
      console.log("[v0] Query validation failed:", validation.errors);
      return NextResponse.json(
        { error: "Query validation failed", details: validation.errors },
        { status: 422 }
      );
    }

    // Check if DB is configured
    if (!process.env.SQL_CONNECTION_STRING) {
      // Return mock data for demo/preview purposes
      const mockData = generateMockData(kpi, filters);
      const report = formatReport(report_name, filters, mockData, kpi, sql);
      return NextResponse.json({ ...report, demo_mode: true, cache_hit: false });
    }

    // Execute
    const data = await executeQuery(sql, params);
    const report = formatReport(report_name, filters, data as Record<string, unknown>[], kpi, sql);

    setCache(cacheKey, report);

    return NextResponse.json({ ...report, cache_hit: false });
  } catch (err) {
    console.error("[v0] Report run error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generateMockData(
  kpi: string,
  filters: { date_range: { start_date: string; end_date: string } }
): Record<string, unknown>[] {
  const branches = [
    "Hospice OC",
    "Home Health",
    "Hospice GI",
    "Hospice IRC",
    "Palliative Care",
    "Pediatrics",
  ];

  const startDate = new Date(filters.date_range.start_date);
  const endDate = new Date(filters.date_range.end_date);
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const weeks = Math.max(1, Math.floor(daysDiff / 7));

  const data: Record<string, unknown>[] = [];
  for (const branch of branches) {
    for (let w = 1; w <= weeks; w++) {
      const base = kpi === "revenue" ? 50000 + Math.random() * 80000 : 5 + Math.random() * 30;
      data.push({
        branch_name: branch,
        week_number: w,
        [kpi]: kpi === "revenue" ? Math.round(base * 100) / 100 : Math.round(base),
      });
    }
  }
  return data;
}
