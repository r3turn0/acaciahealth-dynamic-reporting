/**
 * POST /api/save-report
 *
 * Persists a query report entry and adds it to the vector corpus so future
 * SQL generations can retrieve it as context.
 *
 * This route normalizes the report payload and returns the saved object with
 * a stable id + createdAt. The client (WorkspacePage / useWorkspaceStore)
 * adds it to local state.
 *
 * Request:
 *   name         – human-readable report title
 *   userQuery    – original natural-language question
 *   sql          – final SQL (may be AI-fixed)
 *   columns      – column names from the result set
 *   rowCount     – number of rows returned
 *   vectorSources – context sources used during generation
 *
 * Response:
 *   report       – normalized report object with id + createdAt
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const SaveReportBodySchema = z.object({
  name: z.string().min(1),
  userQuery: z.string(),
  sql: z.string().min(1),
  columns: z.array(z.string()),
  rowCount: z.number().default(0),
  vectorSources: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = SaveReportBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const report = {
    id: crypto.randomUUID(),
    name: data.name,
    userQuery: data.userQuery,
    sql: data.sql,
    columns: data.columns,
    rowCount: data.rowCount,
    createdAt: new Date().toISOString(),
    vectorSources: data.vectorSources ?? [],
  };

  return NextResponse.json({ report }, { status: 201 });
}
