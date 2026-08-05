import { NextRequest, NextResponse } from "next/server";
import { getCatalogIndexHealth, searchCatalog, type AssetType } from "@/lib/discovery/catalog";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { query?: string; types?: AssetType[]; topK?: number };
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  const [results, index] = await Promise.all([
    searchCatalog(query, body.types, body.topK ?? 20),
    getCatalogIndexHealth(),
  ]);

  return NextResponse.json({
    query,
    results,
    total: results.length,
    backend: "virtual-catalog",
    index,
    sources: ["governed metadata", "semantic datasets", "KPI registry", "saved reports", "validations", "agents", "glossary"],
  });
}
