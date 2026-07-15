/**
 * POST /api/save-report
 *
 * Persists a query report and embeds it into the pgvector `reports` table
 * so it becomes instantly retrievable as context for future SQL generation.
 *
 * When DATABASE_URL is not configured, the route still returns a valid
 * report object (no embedding stored) so the workspace store can cache it
 * in-memory for the session.
 *
 * Request:
 *   name         – human-readable report title
 *   userQuery    – original natural-language question
 *   sql          – final SQL (may be AI-fixed)
 *   columns      – column names from the result set
 *   rowCount     – number of rows returned
 *   vectorSources – context labels used during generation
 *
 * Response:
 *   report       – normalized report object with id + createdAt
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { embedText, pgVectorLiteral } from "@/lib/ai/embeddings";
import { getPgVectorPool, isPgVectorConfigured } from "@/lib/db/pgvectorClient";

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
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const report = {
    id,
    name: data.name,
    userQuery: data.userQuery,
    sql: data.sql,
    columns: data.columns,
    rowCount: data.rowCount,
    createdAt,
    vectorSources: data.vectorSources ?? [],
  };

  // Persist to pgvector reports table when DATABASE_URL is configured
  if (isPgVectorConfigured()) {
    try {
      const embedding = await embedText(data.userQuery || data.name);
      const pool = getPgVectorPool();

      await pool.query(
        `INSERT INTO reports (id, name, sql, query, columns, row_count, embedding, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          data.name,
          data.sql,
          data.userQuery,
          data.columns,
          data.rowCount,
          embedding.length > 0 ? pgVectorLiteral(embedding) : null,
          JSON.stringify({ vectorSources: data.vectorSources ?? [] }),
          createdAt,
        ]
      );

      // Also insert a generic vector entry so the schema corpus includes it
      if (embedding.length > 0) {
        const content = `Report: "${data.name}" — query: "${data.userQuery}" — columns: ${data.columns.join(", ")} — sql: ${data.sql.slice(0, 200)}`;
        await pool.query(
          `INSERT INTO vectors (content, type, embedding, metadata)
           VALUES ($1, 'report', $2::vector, $3)`,
          [
            content,
            pgVectorLiteral(embedding),
            JSON.stringify({ reportId: id, reportName: data.name }),
          ]
        );
      }
    } catch (err) {
      // Non-fatal: log the error but still return the report to the client
      console.error("[save-report] pgvector persist failed:", err);
    }
  }

  return NextResponse.json({ report }, { status: 201 });
}
