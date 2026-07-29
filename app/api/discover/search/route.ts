import { NextRequest, NextResponse } from "next/server";
import { lexicalCatalogSearch, type AssetType } from "@/lib/discovery/catalog";
import { vectorSearch } from "@/lib/ai/vectorSearch";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { query?: string; types?: AssetType[]; topK?: number };
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  const lexical = lexicalCatalogSearch(query, body.types);
  let vectors: Awaited<ReturnType<typeof vectorSearch>> = [];
  try { vectors = await vectorSearch({ query, topK: body.topK ?? 12 }); } catch { /* lexical catalog remains available */ }
  const vectorAssets = vectors.map((item, index) => ({
    id: String(item.metadata.table ?? item.metadata.reportId ?? `vector-${index}`),
    type: item.type === "schema" ? "table" : item.type === "history" || item.type === "fix" ? "query" : item.type,
    name: String(item.metadata.reportName ?? item.metadata.table ?? item.content.split(/[—,]/)[0]),
    description: item.content,
    tags: [item.type], location: "Metadata Catalog", related: [], score: Math.max(0, Math.min(1, item.score)), matchedTerms: [],
  }));
  const byId = new Map([...lexical, ...vectorAssets].map((asset) => [asset.id, asset]));
  const results = [...byId.values()].filter((asset) => !body.types?.length || body.types.includes(asset.type as AssetType)).sort((a, b) => b.score - a.score).slice(0, body.topK ?? 20);
  return NextResponse.json({ query, results, total: results.length, backend: vectors.length ? "pgvector-hybrid" : "lexical-fallback", sources: ["metadata", "kpi-catalog", "reports", "validation", "agents", "glossary"] });
}
