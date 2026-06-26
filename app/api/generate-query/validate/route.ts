/**
 * POST /api/generate-query/validate
 * Lightweight SQL validation check used by the inline SQL editor.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateQuery } from "@/lib/services/queryGuard";

export async function POST(req: NextRequest) {
  try {
    const { sql } = await req.json();
    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ valid: false, errors: ["sql is required"] });
    }
    const result = validateQuery(sql);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ valid: false, errors: ["Validation error"] });
  }
}
