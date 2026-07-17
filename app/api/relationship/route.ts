/**
 * POST /api/relationship
 *
 * Infers the relationship between two columns and generates an executable
 * JOIN clause (and optionally full dataset SQL) using the 3-signal pipeline:
 *
 *   1. VectorEmbeddingAgent.semanticJoinSearch  — corpus-backed semantic context
 *   2. inferRelationship (deterministic scoring) — metadata FK + naming heuristics
 *   3. buildJoinClause / buildDatasetSQL         — T-SQL output
 *
 * Request body:
 * {
 *   sourceColumn:  { table, column, type? }
 *   targetColumn:  { table, column, type? }
 *   metadata:      { relationships: [...], columns?: [...] }
 *   joinType?:     "auto" | "LEFT" | "INNER" | "RIGHT" | "FULL"  (default "auto")
 *   existingJoins?: JoinEdge[]   — append to graph + generate full SQL
 *   columns?:       ColumnSelection[]
 *   limit?:         number
 * }
 *
 * Response:
 * {
 *   success: true,
 *   joinClause, datasetSQL?, relationshipGraphUpdate,
 *   confidenceScore, warnings, explanation, signals,
 *   semanticMatches, aliases, graphWarnings
 * }
 *
 * GET /api/relationship
 *   Health-check — confirms agent is registered and returns its descriptor.
 */

import { NextRequest, NextResponse } from "next/server";
import { relationshipBuilderAgent } from "@/lib/agents/RelationshipBuilderAgent";

// ── GET — health check ────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    agent:       "RelationshipBuilderAgent",
    status:      "ready",
    description: "Infers JOIN relationships using metadata FK, naming heuristics, and vector semantic similarity.",
    endpoints: {
      POST: {
        required: ["sourceColumn", "targetColumn", "metadata"],
        optional: ["joinType", "existingJoins", "columns", "limit"],
      },
    },
  });
}

// ── POST — infer relationship ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // ── Input validation ────────────────────────────────────────────────────

  const { sourceColumn, targetColumn, metadata } = body;

  if (
    !sourceColumn ||
    typeof (sourceColumn as Record<string, unknown>).table !== "string" ||
    typeof (sourceColumn as Record<string, unknown>).column !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "sourceColumn must have { table: string, column: string }" },
      { status: 400 },
    );
  }

  if (
    !targetColumn ||
    typeof (targetColumn as Record<string, unknown>).table !== "string" ||
    typeof (targetColumn as Record<string, unknown>).column !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "targetColumn must have { table: string, column: string }" },
      { status: 400 },
    );
  }

  if (
    !metadata ||
    !Array.isArray((metadata as Record<string, unknown>).relationships)
  ) {
    return NextResponse.json(
      { success: false, error: "metadata must have { relationships: Array }" },
      { status: 400 },
    );
  }

  // ── Dispatch to agent ───────────────────────────────────────────────────

  try {
    const result = await relationshipBuilderAgent.run({
      sourceColumn: sourceColumn as { table: string; column: string; type?: string },
      targetColumn: targetColumn as { table: string; column: string; type?: string },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata:     metadata     as any,
      joinType:     (body.joinType as "auto" | "LEFT" | "INNER" | "RIGHT" | "FULL") ?? "auto",
      existingJoins: Array.isArray(body.existingJoins) ? body.existingJoins as never[] : [],
      columns:       Array.isArray(body.columns) ? body.columns as never[] : undefined,
      limit:         typeof body.limit === "number" ? body.limit : 1000,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[v0] RelationshipBuilderAgent error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
