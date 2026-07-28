/**
 * POST /api/gateway/query
 *
 * THE SINGLE SQL EXECUTION ENTRY POINT FOR THE ENTIRE APPLICATION.
 *
 * Every feature surface that generates, accepts, suggests, explains, validates,
 * or executes SQL MUST route through this endpoint. No direct SQL execution is
 * permitted anywhere else.
 *
 * Accepted sources:
 *   natural_language | sql_editor | dashboard_filter | report_builder |
 *   kpi_explorer | ai_copilot | ad_hoc | pipeline | scheduled
 *
 * Request body:
 * {
 *   query:       string   — NL question (required unless rawSql provided)
 *   source:      QuerySource
 *   startDate:   string   — ISO date (YYYY-MM-DD)
 *   endDate:     string   — ISO date (YYYY-MM-DD)
 *   branchCode?: string
 *   role?:       string   — "admin" | "analyst" | "viewer"
 *   rawSql?:     string   — pre-written SQL (only for source=sql_editor)
 *   planOnly?:   boolean  — return plan without executing
 *   reportName?: string
 *   requestId?:  string   — caller-supplied correlation ID
 * }
 *
 * Response: GatewayResult — includes pipeline trace, intent, semantic context,
 * SQL, validation, execution, lineage, governance metadata, and confidence.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runQueryGateway, type GatewayRequest } from "@/lib/gateway/QueryGateway";
import { GatewayQueryBodySchema } from "@/lib/validation/apiSchemas";

export async function POST(req: NextRequest) {
  const globalStart = Date.now();

  try {
    const raw = await req.json();
    const parsed = GatewayQueryBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      query,
      source,
      startDate,
      endDate,
      branchCode,
      role,
      rawSql,
      planOnly,
      reportName,
      requestId,
    } = parsed.data;

    // ── Run the 9-stage QueryGateway ──────────────────────────────────────────
    const gatewayReq: GatewayRequest = {
      query: query ?? rawSql ?? "",
      source,
      startDate,
      endDate,
      branchCode,
      role,
      rawSql,
      planOnly,
      reportName,
      requestId,
    };

    const result = await runQueryGateway(gatewayReq);

    // Surface validation failures as 422 so callers know the pipeline blocked
    if (!result.validation.valid) {
      return NextResponse.json(
        {
          ...result,
          error: "Query blocked by validation",
          validationErrors: result.validation.errors,
          totalElapsedMs: Date.now() - globalStart,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ...result,
      totalElapsedMs: Date.now() - globalStart,
    });
  } catch (err) {
    console.error("[QueryGateway] /api/gateway/query unhandled error:", err);
    return NextResponse.json(
      { error: "Gateway error", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gateway/query
 * Returns gateway metadata: active stages, read-only policy, accepted sources.
 */
export async function GET() {
  return NextResponse.json({
    gateway: "QueryGateway v1",
    description: "Global SQL Execution Gateway — all SQL requests must route through this endpoint.",
    policy: {
      readOnly: true,
      allowedStatements: ["SELECT", "WITH"],
      forbiddenStatements: ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "ALTER", "DROP", "CREATE", "MERGE", "UPSERT", "EXEC", "GRANT", "REVOKE"],
      maxRows: 100000,
      timeoutSeconds: 60,
    },
    stages: [
      "IntentAgent",
      "SemanticSearchAgent",
      "ApprovedPatternAgent",
      "SQLGeneratorAgent",
      "SQLValidationAgent",
      "ExecutionEngine",
      "FeedbackAgent",
      "LearningRepository",
      "ContinuousImprovementAgent",
    ],
    acceptedSources: [
      "natural_language",
      "sql_editor",
      "dashboard_filter",
      "report_builder",
      "kpi_explorer",
      "ai_copilot",
      "ad_hoc",
      "pipeline",
      "scheduled",
    ],
  });
}
