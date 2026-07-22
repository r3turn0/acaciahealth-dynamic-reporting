/**
 * POST /api/pipeline/execute
 *
 * Execute a pipeline by id (or the default pipeline).
 *
 * Request body:
 *   pipelineId   — (optional) pipeline id. Defaults to the default pipeline.
 *   input        — arbitrary input object passed to the first step.
 *   ctx          — (optional) additional pipeline context fields.
 *   dryRun       — if true, validate only — do not execute.
 *   role         — "admin" | "analyst" | "viewer"
 *
 * Response: PipelineRunResult
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pipelineEngine, type AgentExecutorFn } from "@/lib/orchestrator/PipelineEngine";
import { agentRegistryStore } from "@/lib/orchestrator/AgentRegistryStore";
import "@/lib/orchestrator/PipelineEngine"; // ensure seeded

// ── Agent executor bridge ─────────────────────────────────────────────────────
// Maps agent names to their actual implementations. Agents that aren't wired
// to real code return a stub result so the pipeline can still be exercised
// end-to-end in demo mode.

import { runSemanticPipeline } from "@/lib/agents/semanticQueryEngine";
import { planQuery }           from "@/lib/agents/queryPlanner";
import type { AgentConfig }    from "@/lib/orchestrator/AgentRegistryStore";
import type { PipelineContext } from "@/lib/orchestrator/PipelineEngine";

const executor: AgentExecutorFn = async (
  agentName: string,
  config:     AgentConfig,
  input:      unknown,
  ctx:        PipelineContext
): Promise<unknown> => {
  const inp = (input ?? {}) as Record<string, unknown>;

  switch (agentName) {
    case "SemanticSearchAgent":
    case "MetadataCatalogAgent":
    case "MetadataNormalizationAgent": {
      // Attempt real semantic pipeline if query is available
      if (inp.query) {
        try {
          const result = await runSemanticPipeline({
            query:      String(inp.query),
            startDate:  String(inp.startDate ?? ""),
            endDate:    String(inp.endDate ?? ""),
            branchCode: inp.branchCode ? String(inp.branchCode) : undefined,
          });
          return { ...inp, semantic: result };
        } catch {
          return { ...inp, semantic: null };
        }
      }
      return { ...inp, cataloged: true, agent: agentName };
    }

    case "QueryGenerationAgent": {
      if (inp.query) {
        try {
          const plan = await planQuery({
            prompt:     String(inp.query),
            startDate:  String(inp.startDate ?? ""),
            endDate:    String(inp.endDate ?? ""),
            branchCode: inp.branchCode ? String(inp.branchCode) : undefined,
            role:       (ctx.role as "admin" | "analyst" | "viewer") ?? "analyst",
          });
          return { ...inp, plan, sql: plan.sql };
        } catch {
          return { ...inp, sql: null, plan: null };
        }
      }
      return { ...inp, sql: null };
    }

    case "BusinessIntelligenceAgent": {
      // Stub — real BI agent would generate narrative insights
      return {
        ...inp,
        narrative: `BI analysis complete for query: ${inp.query ?? "(no query)"}`,
        insights:  [],
        trends:    [],
      };
    }

    case "DataQualityAgent": {
      return {
        ...inp,
        qualityScore: 95,
        anomalies:    [],
        profiledAt:   new Date().toISOString(),
      };
    }

    case "ReportValidationAgent": {
      return {
        ...inp,
        validationStatus: "pass",
        kpiChecks:        [],
        validatedAt:      new Date().toISOString(),
      };
    }

    case "SecurityAuditAgent": {
      return {
        ...inp,
        securityStatus: "pass",
        rbacChecks:     [],
        phiRisk:        "low",
        auditedAt:      new Date().toISOString(),
      };
    }

    case "RecommendationAgent": {
      return {
        ...inp,
        recommendations: [
          "Review index coverage on high-frequency query tables.",
          "Validate PDGM period date ranges against claims.",
        ],
      };
    }

    default: {
      // Generic stub for any unknown or custom agent
      return { ...inp, agent: agentName, executed: true, demoMode: true };
    }
  }
};

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const {
    pipelineId,
    input    = {},
    ctx      = {},
    dryRun   = false,
    role     = "analyst",
  } = body as {
    pipelineId?: string;
    input?:      unknown;
    ctx?:        Record<string, unknown>;
    dryRun?:     boolean;
    role?:       string;
  };

  // Resolve pipeline
  const def = pipelineId
    ? pipelineEngine.getPipeline(pipelineId)
    : pipelineEngine.getDefault();

  if (!def) {
    return NextResponse.json(
      { error: pipelineId ? `Pipeline "${pipelineId}" not found` : "No default pipeline defined" },
      { status: 404 }
    );
  }

  // Validate
  const validation = pipelineEngine.validate(def);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Pipeline validation failed", details: validation.errors, pipelineId: def.id },
      { status: 422 }
    );
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun:     true,
      pipeline:   def,
      validation,
      agentCount: def.steps.length,
    });
  }

  // Execute
  const result = await pipelineEngine.execute(
    def,
    input,
    executor,
    { ...(ctx as Record<string, unknown>), role }
  );

  return NextResponse.json(result, {
    status: result.status === "failed" ? 500 : 200,
  });
}

// ── GET — convenience: list available pipelines + validate each ───────────────

export async function GET() {
  const pipelines = pipelineEngine.listPipelines().map((def) => ({
    ...def,
    validation: pipelineEngine.validate(def),
  }));

  return NextResponse.json({
    pipelines,
    count:     pipelines.length,
    defaultId: pipelineEngine.getDefault()?.id ?? null,
  });
}
