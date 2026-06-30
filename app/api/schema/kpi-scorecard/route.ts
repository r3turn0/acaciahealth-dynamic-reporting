import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// Serve the pre-parsed KPI schemas from data/kpi-schemas.json
// Built by: node scripts/parse-kpi-scorecard.mjs

let cached: unknown = null;

function load() {
  if (cached) return cached;
  const p = join(process.cwd(), "data", "kpi-schemas.json");
  cached = JSON.parse(readFileSync(p, "utf-8"));
  return cached;
}

export async function GET(req: NextRequest) {
  try {
    const data = load() as {
      generated_at: string;
      source_file: string;
      sheet_count: number;
      schemas: unknown[];
    };

    const { searchParams } = new URL(req.url);
    const sheetId = searchParams.get("sheet");

    if (sheetId) {
      const schema = data.schemas.find((s: unknown) => (s as { id: string }).id === sheetId);
      if (!schema) {
        return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
      }
      return NextResponse.json(schema);
    }

    return NextResponse.json({
      generated_at: data.generated_at,
      source_file:  data.source_file,
      sheet_count:  data.sheet_count,
      schemas: data.schemas.map((s: unknown) => {
        const sc = s as {
          id: string; sheetName: string; title: string;
          description: string; domain: string; frequency: string;
          serviceLines: string[]; kpis: unknown[]; columns: unknown[];
        };
        return {
          id:           sc.id,
          sheetName:    sc.sheetName,
          title:        sc.title,
          description:  sc.description,
          domain:       sc.domain,
          frequency:    sc.frequency,
          serviceLines: sc.serviceLines,
          kpiCount:     sc.kpis.length,
          columnCount:  sc.columns.length,
        };
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load KPI schemas", detail: String(err) },
      { status: 500 }
    );
  }
}
