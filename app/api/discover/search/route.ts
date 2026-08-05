import { NextRequest, NextResponse } from "next/server";
import { executeCatalogSearch, type AssetType } from "@/lib/discovery/catalog";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { query?: string; types?: AssetType[]; topK?: number };
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  const execution = await executeCatalogSearch(query, body.types, body.topK ?? 20);
  const leading = execution.results.slice(0, 3);

  return NextResponse.json({
    query,
    results: execution.results,
    total: execution.results.length,
    backend: "deterministic-evidence-index",
    index: execution.index,
    cacheHit: execution.cacheHit,
    timing: execution.timing,
    interpretation: {
      mode: "evidence-only",
      summary: leading.length
        ? `Found ${execution.results.length} traceable asset${execution.results.length === 1 ? "" : "s"}. Strongest evidence: ${leading.map((result) => `${result.name} (${Math.round(result.score * 100)}%)`).join(", ")}.`
        : "No governed metadata evidence matched this query.",
      citedResultIds: leading.map((result) => result.id),
      generatedByAI: false,
    },
    sources: ["governed metadata", "report SQL identifiers", "semantic datasets", "KPI formulas", "saved reports", "validations", "agents", "glossary", "lineage", "relationships"],
  });
}
