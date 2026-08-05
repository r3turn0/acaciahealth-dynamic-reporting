import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatVectorContext, seedSchemaCorpus, vectorSearch } from "@/lib/ai/vectorSearch";

const SearchSchema = z.object({
  query: z.string().trim().min(1).max(4_000),
  types: z.array(z.enum(["schema", "column", "relationship", "report", "history", "fix"])).optional(),
  topK: z.number().int().min(1).max(50).default(8),
  savedReports: z.array(z.unknown()).max(1_000).default([]),
  fixLog: z.array(z.unknown()).max(1_000).default([]),
});

export async function POST(req: NextRequest) {
  const parsed = SearchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid search request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const results = await vectorSearch({
      ...parsed.data,
      savedReports: parsed.data.savedReports as Parameters<typeof vectorSearch>[0]["savedReports"],
      fixLog: parsed.data.fixLog as Parameters<typeof vectorSearch>[0]["fixLog"],
    });
    return NextResponse.json({
      results,
      formattedContext: formatVectorContext(results),
      total: results.length,
      backend: "process-cache",
      authoritative: false,
      readOnly: true,
    });
  } catch {
    return NextResponse.json(
      { error: "Semantic search failed", results: [], formattedContext: "", total: 0 },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") !== "seed") {
    return NextResponse.json({ error: "Unknown action. Use ?action=seed" }, { status: 400 });
  }

  const result = await seedSchemaCorpus();
  return NextResponse.json({
    success: true,
    ...result,
    message: "The virtual corpus is rehydrated from governed read-only metadata on demand.",
    authoritative: false,
  });
}
