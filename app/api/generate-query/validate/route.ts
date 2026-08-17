/**
 * POST /api/generate-query/validate
 * Lightweight SQL validation check used by the inline SQL editor.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateQuery } from "@/lib/services/queryGuard";
import { analyzeSql } from "@/lib/services/metadataIntelligence";
import { buildStaticCatalog } from "@/lib/services/metadataRegistry";

export async function POST(req: NextRequest) {
  try {
    const { sql } = await req.json();
    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ valid: false, errors: ["sql is required"] });
    }
    const guard = validateQuery(sql);
    const intelligence = analyzeSql(sql, buildStaticCatalog());
    return NextResponse.json({
      valid: guard.valid && intelligence.validationStatus !== "blocked",
      errors: [...guard.errors, ...intelligence.errors],
      warnings: intelligence.warnings,
      intelligence,
    });
  } catch {
    return NextResponse.json({ valid: false, errors: ["Validation error"] });
  }
}
