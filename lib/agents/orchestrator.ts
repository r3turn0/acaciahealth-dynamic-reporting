/**
 * lib/agents/orchestrator.ts
 *
 * Multi-Agent Orchestration Pipeline
 *
 * Agents (in order):
 *   1. SemanticAgent    — interpret NL → LogicalPlan + intent classification
 *   2. PlannerAgent     — LogicalPlan + context → T-SQL (AI-powered)
 *   3. ValidatorAgent   — static SQL safety check (Tier 1)
 *   4. ExecutorAgent    — execute against DB, collect rows + timing
 *   5. HealerAgent      — if execution fails: deterministic → AI self-heal (Tiers 2+3)
 *   6. PresentationAgent— pick chart type / KPI display hint from semantic result
 *
 * Each agent emits a typed AgentEvent so the caller can stream progress to the UI.
 */

import { runSemanticPipeline } from "./semanticQueryEngine";
import { planQuery }           from "./queryPlanner";
import { validateSQL, runSelfHealingPipeline } from "@/lib/sql/pipeline";
import type { SemanticResponse }  from "./semanticQueryEngine";
import type { QueryPlan }         from "./queryPlanner";
import type { PipelineResult }    from "@/lib/sql/pipeline";

// ── Event bus ─────────────────────────────────────────────────────────────────

export type AgentName =
  | "semantic"
  | "planner"
  | "validator"
  | "executor"
  | "healer"
  | "presentation";

export type AgentStatus = "running" | "ok" | "warn" | "error" | "skipped";

export interface AgentEvent {
  agent:   AgentName;
  status:  AgentStatus;
  message: string;
  data?:   unknown;
}

// ── Orchestration result ──────────────────────────────────────────────────────

export interface OrchestrationResult {
  /** Final SQL used (original, deterministic fix, or AI fix) */
  sql:              string;
  /** Result rows from the DB (empty if execution not attempted) */
  rows:             Record<string, unknown>[];
  rowCount:         number;
  durationMs:       number;
  /** Which self-healing tier resolved the error (if any) */
  healTier?:        PipelineResult["tier"];
  /** Semantic interpretation from agent 1 */
  semantic?:        SemanticResponse;
  /** SQL plan from agent 2 */
  plan?:            QueryPlan;
  /** Presentation recommendation */
  presentation?: {
    type:      "TABLE" | "CHART" | "KPI" | "SUMMARY_TEXT";
    chartType: "bar" | "line" | "pie" | "none";
    xAxis?:    string;
    yAxis?:    string;
  };
  /** All agent events in order for UI trace display */
  trace:            AgentEvent[];
  success:          boolean;
  error?:           string;
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface OrchestrationInput {
  query:       string;
  startDate:   string;
  endDate:     string;
  branchCode?: string;
  role?:       "admin" | "analyst" | "viewer";
  /** Optional: function to actually execute SQL against the DB */
  executeSQL?: (sql: string) => Promise<{
    ok:     boolean;
    rows?:  Record<string, unknown>[];
    error?: string;
    dbErrorLogs?: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function event(
  trace: AgentEvent[],
  agent:   AgentName,
  status:  AgentStatus,
  message: string,
  data?:   unknown
): void {
  trace.push({ agent, status, message, data });
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function orchestrate(
  input: OrchestrationInput
): Promise<OrchestrationResult> {
  const { query, startDate, endDate, branchCode, role = "analyst", executeSQL } = input;
  const trace: AgentEvent[] = [];
  const start = Date.now();

  let semantic: SemanticResponse | undefined;
  let plan:     QueryPlan | undefined;
  let sql       = "";
  let rows:     Record<string, unknown>[] = [];
  let healTier: PipelineResult["tier"] | undefined;

  // ── Agent 1: Semantic ───────────────────────────────────────────────────────
  event(trace, "semantic", "running", "Interpreting natural language query…");
  try {
    semantic = await runSemanticPipeline({ query, startDate, endDate, branchCode });
    if (semantic.intent.type === "CLARIFICATION") {
      event(trace, "semantic", "warn", "Clarification needed", semantic.clarification);
      return {
        sql: "", rows: [], rowCount: 0, durationMs: Date.now() - start,
        semantic, trace, success: false,
        error: semantic.clarification?.question ?? "Clarification needed",
      };
    }
    event(trace, "semantic", "ok",
      `Intent: ${semantic.intent.type} | Table: ${semantic.context.table}`,
      { intent: semantic.intent, context: semantic.context }
    );
  } catch (err) {
    event(trace, "semantic", "warn", "Semantic agent failed — skipping to planner", String(err));
    // Non-fatal: continue with planner using raw query
  }

  // ── Agent 2: Planner ────────────────────────────────────────────────────────
  event(trace, "planner", "running", "Generating T-SQL from intent…");
  try {
    plan = await planQuery({ prompt: query, startDate, endDate, branchCode, role });
    sql  = plan.sql ?? "";
    if (plan.strategy === "api_fallback") {
      event(trace, "planner", "warn", `API fallback: ${plan.api_fallback_reason ?? "SQL not possible"}`);
      return {
        sql: "", rows: [], rowCount: 0, durationMs: Date.now() - start,
        semantic, plan, trace, success: false,
        error: plan.api_fallback_reason ?? "This query cannot be answered with SQL",
      };
    }
    if (plan.cost_warning) {
      event(trace, "planner", "warn", plan.cost_warning, { suggestion: plan.optimized_suggestion });
      // Use the optimized suggestion if provided
      if (plan.optimized_suggestion) sql = plan.optimized_suggestion;
    } else {
      event(trace, "planner", "ok", `SQL ready (${plan.tables_used.join(", ")})`, { sql: sql.slice(0, 200) });
    }
  } catch (err) {
    event(trace, "planner", "error", "Planner failed", String(err));
    return {
      sql: "", rows: [], rowCount: 0, durationMs: Date.now() - start,
      semantic, trace, success: false,
      error: `SQL generation failed: ${String(err)}`,
    };
  }

  // ── Agent 3: Validator ──────────────────────────────────────────────────────
  event(trace, "validator", "running", "Validating SQL safety…");
  const validation = validateSQL(sql);
  if (!validation.valid) {
    event(trace, "validator", "error", validation.errors.join("; "));
    return {
      sql, rows: [], rowCount: 0, durationMs: Date.now() - start,
      semantic, plan, trace, success: false,
      error: `Validation failed: ${validation.errors.join("; ")}`,
    };
  }
  event(trace, "validator", "ok", "SQL passed read-only validation");

  // ── Agent 4: Executor ───────────────────────────────────────────────────────
  if (!executeSQL) {
    event(trace, "executor", "skipped", "No executor provided — returning SQL only");
    return {
      sql, rows: [], rowCount: 0, durationMs: Date.now() - start,
      semantic, plan,
      presentation: buildPresentation(semantic),
      trace, success: true,
    };
  }

  event(trace, "executor", "running", "Executing SQL against database…");
  const execResult = await executeSQL(sql);

  if (execResult.ok && execResult.rows) {
    rows = execResult.rows;
    event(trace, "executor", "ok", `${rows.length} rows returned in ${Date.now() - start}ms`);

    // ── Agent 6: Presentation ─────────────────────────────────────────────────
    event(trace, "presentation", "ok", "Selecting optimal presentation format");
    return {
      sql, rows, rowCount: rows.length,
      durationMs: Date.now() - start,
      semantic, plan,
      presentation: buildPresentation(semantic),
      trace, success: true,
    };
  }

  // ── Agent 5: Healer ─────────────────────────────────────────────────────────
  const dbError = execResult.dbErrorLogs ?? execResult.error ?? "Unknown DB error";
  event(trace, "healer", "running", `Execution failed — running self-healing pipeline. Error: ${dbError.slice(0, 120)}`);

  const healResult = await runSelfHealingPipeline({
    sql,
    dbError,
    userQuery: query,
    runSQL: async (healedSQL) => {
      const r = await executeSQL(healedSQL);
      return { ok: r.ok, error: r.error, rows: r.rows };
    },
  });

  healTier = healResult.tier;

  if (healResult.valid && healResult.tier !== "failed") {
    rows = [];
    // Re-execute healed SQL
    const healExec = await executeSQL(healResult.sql);
    if (healExec.ok && healExec.rows) {
      rows = healExec.rows;
      event(trace, "healer", "ok",
        `Healed via ${healResult.tier}: ${healResult.explanation}`,
        { changes: healResult.changes }
      );
    } else {
      event(trace, "healer", "warn", "Healed SQL still failed after retry", healExec.error);
    }
    event(trace, "presentation", "ok", "Selecting presentation format post-heal");
    return {
      sql:       healResult.sql,
      rows,
      rowCount:  rows.length,
      durationMs: Date.now() - start,
      healTier,
      semantic, plan,
      presentation: buildPresentation(semantic),
      trace, success: rows.length > 0,
      error: rows.length === 0 ? `Healed but still no results: ${healExec?.error ?? ""}` : undefined,
    };
  }

  event(trace, "healer", "error", `Self-heal failed: ${healResult.explanation}`);
  return {
    sql,
    rows: [],
    rowCount: 0,
    durationMs: Date.now() - start,
    healTier,
    semantic, plan,
    trace, success: false,
    error: `${dbError}\n\nSelf-heal attempted but failed: ${healResult.explanation}`,
  };
}

// ── Presentation helper ───────────────────────────────────────────────────────

function buildPresentation(semantic?: SemanticResponse): OrchestrationResult["presentation"] {
  if (!semantic) return { type: "TABLE", chartType: "none" };
  const { type, presentation } = semantic.response;
  return {
    type,
    chartType: presentation.chartType,
    xAxis:     presentation.xAxis || undefined,
    yAxis:     presentation.yAxis || undefined,
  };
}
