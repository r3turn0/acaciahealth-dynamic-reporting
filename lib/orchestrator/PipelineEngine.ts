/**
 * lib/orchestrator/PipelineEngine.ts
 *
 * Dynamic Pipeline Engine — zero hardcoded workflows.
 *
 * Concepts:
 *   PipelineDefinition  — a named, versioned, saved pipeline spec. An admin
 *     creates these via the UI or API. Stored in the singleton registry.
 *
 *   PipelineStep        — one step inside a definition. Names an agent from
 *     AgentRegistryStore, plus optional input transform, skip condition, and
 *     retry config.
 *
 *   PipelineRun         — one live execution of a definition against a runtime
 *     input. Produces PipelineRunResult with per-step traces.
 *
 * Supported Patterns:
 *   - Sequential          steps run in declared order
 *   - Parallel groups     steps with the same `parallelGroup` key run concurrently
 *   - Conditional skip    steps can declare a `skipIf` predicate key
 *   - Fan-out / Fan-in    via parallel groups + a merge step
 *   - A/B runtime         per-step variant selection via AgentRegistryStore.resolveConfig
 *   - Retry               per-step maxRetries / backoffMs
 *   - Timeout             per-step timeoutMs cap
 *
 * Example pipelines:
 *   Pipeline A: MetadataCatalogAgent → QueryGenerationAgent → BusinessIntelligenceAgent → ReportValidationAgent
 *   Pipeline B: SemanticSearchAgent → QueryGenerationAgent → BusinessIntelligenceAgent → RecommendationAgent
 *   Pipeline C: MetadataCatalogAgent → DataQualityAgent → SecurityAuditAgent → ReportValidationAgent
 */

import { agentRegistryStore, type AgentRegistration, type AgentConfig } from "./AgentRegistryStore";

// ── Pipeline definition types ─────────────────────────────────────────────────

export interface StepRetryConfig {
  maxRetries: number;
  backoffMs:  number;
}

export interface PipelineStep {
  /** Unique id within this pipeline, e.g. "step-1" */
  id:           string;
  /** Agent name from AgentRegistryStore */
  agentName:    string;
  /** Optional human label shown in UI */
  label?:       string;
  /**
   * Optional JS expression string evaluated against the previous step output.
   * If it evaluates truthy the step is skipped.
   * Supported tokens: `prev` (previous output), `ctx` (pipeline context).
   * Example: "ctx.role === 'viewer'" — skip SecurityAuditAgent for viewers.
   */
  skipIf?:      string;
  /**
   * If set, steps sharing this key run concurrently.
   * Fan-in happens automatically — next sequential step receives
   * an array of all parallel results.
   */
  parallelGroup?: string;
  /** Override config for this step (merged on top of agent defaults + A/B) */
  configOverride?: Partial<AgentConfig>;
  /** Retry config — overrides agent-level defaults */
  retry?:       StepRetryConfig;
  /** Step-level timeout — overrides agent-level timeoutMs */
  timeoutMs?:   number;
  /**
   * Optional transform applied to the previous step output
   * BEFORE passing to this agent.
   * Key → dot-path in previous output.
   * Example: { "query": "sql", "rows": "data" }
   */
  inputMap?:    Record<string, string>;
}

export interface PipelineDefinition {
  /** Unique pipeline id, e.g. "pipeline-a" */
  id:           string;
  /** Human name, e.g. "Metadata → Query → BI → Validation" */
  name:         string;
  description:  string;
  /** Semantic version */
  version:      string;
  /** Steps in declared execution order */
  steps:        PipelineStep[];
  /** Whether this pipeline is the default when no pipeline id is specified */
  isDefault:    boolean;
  enabled:      boolean;
  tags:         string[];
  createdAt:    string;
  updatedAt:    string;
  createdBy:    string;
  /** Run-level timeout cap (ms) */
  timeoutMs:    number;
}

// ── Run types ─────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "ok" | "skipped" | "error" | "timeout";

export interface StepTrace {
  stepId:       string;
  agentName:    string;
  label:        string;
  status:       StepStatus;
  durationMs:   number;
  input?:       unknown;
  output?:      unknown;
  error?:       string;
  retryCount:   number;
  variant?:     string;
  timestamp:    string;
}

export interface PipelineRunResult {
  pipelineId:   string;
  pipelineName: string;
  runId:        string;
  status:       "ok" | "partial" | "failed";
  steps:        StepTrace[];
  finalOutput:  unknown;
  totalMs:      number;
  startedAt:    string;
  finishedAt:   string;
  errors:       string[];
}

// ── Pipeline context ──────────────────────────────────────────────────────────

export interface PipelineContext {
  runId:        string;
  startedAt:    string;
  role?:        string;
  [key: string]: unknown;
}

// ── Agent executor function type ──────────────────────────────────────────────

/**
 * A function that actually runs an agent given its name, resolved config,
 * and input data. The caller wires real agents here; the engine stays agnostic.
 */
export type AgentExecutorFn = (
  agentName: string,
  config:    AgentConfig,
  input:     unknown,
  ctx:       PipelineContext
) => Promise<unknown>;

// ── The engine ────────────────────────────────────────────────────────────────

export class PipelineEngine {
  private definitions: Map<string, PipelineDefinition> = new Map();

  // ── Definition management ─────────────────────────────────────────────────

  savePipeline(def: Omit<PipelineDefinition, "createdAt" | "updatedAt">): PipelineDefinition {
    const now = new Date().toISOString();
    const existing = this.definitions.get(def.id);

    if (def.isDefault) {
      for (const [id, d] of this.definitions) {
        if (id !== def.id && d.isDefault) {
          this.definitions.set(id, { ...d, isDefault: false, updatedAt: now });
        }
      }
    }

    const saved: PipelineDefinition = {
      ...def,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.definitions.set(def.id, saved);
    return saved;
  }

  getPipeline(id: string): PipelineDefinition | undefined {
    return this.definitions.get(id);
  }

  getDefault(): PipelineDefinition | undefined {
    return Array.from(this.definitions.values()).find((d) => d.isDefault && d.enabled);
  }

  listPipelines(): PipelineDefinition[] {
    return Array.from(this.definitions.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  deletePipeline(id: string): boolean {
    return this.definitions.delete(id);
  }

  updatePipeline(id: string, patch: Partial<Omit<PipelineDefinition, "id" | "createdAt">>): PipelineDefinition | null {
    const existing = this.definitions.get(id);
    if (!existing) return null;
    const updated: PipelineDefinition = { ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.definitions.set(id, updated);
    return updated;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  validate(def: PipelineDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!def.id)   errors.push("Pipeline id is required");
    if (!def.name) errors.push("Pipeline name is required");
    if (def.steps.length === 0) errors.push("Pipeline must have at least one step");

    const stepIds = new Set<string>();
    for (const step of def.steps) {
      if (!step.id)        errors.push(`Step is missing an id`);
      if (!step.agentName) errors.push(`Step "${step.id}" is missing agentName`);
      if (stepIds.has(step.id)) errors.push(`Duplicate step id: "${step.id}"`);
      stepIds.add(step.id);

      const reg = agentRegistryStore.getActiveVersion(step.agentName);
      if (!reg)     errors.push(`Step "${step.id}": agent "${step.agentName}" not found in registry`);
      if (reg && !reg.enabled) errors.push(`Step "${step.id}": agent "${step.agentName}" is disabled`);
    }

    // Check dependency satisfaction
    const agentNames = def.steps.map((s) => s.agentName);
    const depIssues  = agentRegistryStore.validateDependencies(agentNames);
    for (const issue of depIssues) {
      errors.push(`Agent "${issue.agent}" has unsatisfied dependencies: ${issue.missing.join(", ")}`);
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Execute a pipeline by id (or the default pipeline).
   * The `executor` function is called for each step — it bridges the engine
   * to the real agent implementations (or mocks in tests).
   */
  async execute(
    pipelineIdOrDef: string | PipelineDefinition,
    initialInput:    unknown,
    executor:        AgentExecutorFn,
    ctx?:            Partial<PipelineContext>
  ): Promise<PipelineRunResult> {
    const def = typeof pipelineIdOrDef === "string"
      ? this.definitions.get(pipelineIdOrDef) ?? this.getDefault()
      : pipelineIdOrDef;

    if (!def) {
      return this._failResult("unknown", "Unknown", ctx?.runId ?? newRunId(), initialInput,
        "Pipeline not found");
    }

    if (!def.enabled) {
      return this._failResult(def.id, def.name, ctx?.runId ?? newRunId(), initialInput,
        `Pipeline "${def.name}" is disabled`);
    }

    const runId    = ctx?.runId ?? newRunId();
    const startedAt = new Date().toISOString();
    const context: PipelineContext = { runId, startedAt, ...ctx };

    const steps:  StepTrace[] = [];
    const errors: string[] = [];
    let   currentOutput: unknown = initialInput;

    // Group steps into sequential / parallel buckets
    const buckets = groupSteps(def.steps);

    const runStart = Date.now();

    for (const bucket of buckets) {
      if (bucket.type === "sequential") {
        const step = bucket.step;
        const trace = await this._executeStep(step, currentOutput, context, executor);
        steps.push(trace);

        if (trace.status === "error") {
          errors.push(`Step "${step.id}" (${step.agentName}): ${trace.error}`);
          break; // stop pipeline on error
        }

        if (trace.status !== "skipped") {
          currentOutput = trace.output;
        }
        // record metrics
        agentRegistryStore.recordRun(step.agentName, "1.0.0", {
          success:    trace.status === "ok",
          durationMs: trace.durationMs,
          errorMsg:   trace.error,
        });

      } else {
        // Parallel group — run all steps concurrently
        const parallelTraces = await Promise.all(
          bucket.steps.map((step) => this._executeStep(step, currentOutput, context, executor))
        );

        for (const trace of parallelTraces) {
          steps.push(trace);
          if (trace.status === "error") {
            errors.push(`Step "${trace.stepId}" (${trace.agentName}): ${trace.error}`);
          }
          agentRegistryStore.recordRun(trace.agentName, "1.0.0", {
            success:    trace.status === "ok",
            durationMs: trace.durationMs,
            errorMsg:   trace.error,
          });
        }

        if (parallelTraces.some((t) => t.status === "error")) break;

        // Fan-in: pass all outputs as array to next step
        currentOutput = parallelTraces
          .filter((t) => t.status === "ok")
          .map((t) => t.output);
      }
    }

    const totalMs = Date.now() - runStart;
    const anyError = steps.some((s) => s.status === "error");
    const allOk    = steps.every((s) => s.status === "ok" || s.status === "skipped");

    return {
      pipelineId:   def.id,
      pipelineName: def.name,
      runId,
      status:       allOk ? "ok" : anyError ? (steps.some((s) => s.status === "ok") ? "partial" : "failed") : "ok",
      steps,
      finalOutput:  currentOutput,
      totalMs,
      startedAt,
      finishedAt:   new Date().toISOString(),
      errors,
    };
  }

  // ── Step execution ─────────────────────────────────────────────────────────

  private async _executeStep(
    step:     PipelineStep,
    input:    unknown,
    ctx:      PipelineContext,
    executor: AgentExecutorFn,
  ): Promise<StepTrace> {
    const label = step.label ?? step.agentName;
    const now   = new Date().toISOString();

    // Skip condition
    if (step.skipIf) {
      try {
        // eslint-disable-next-line no-new-func
        const skip = new Function("prev", "ctx", `return !!(${step.skipIf})`)(input, ctx);
        if (skip) {
          return { stepId: step.id, agentName: step.agentName, label, status: "skipped", durationMs: 0, retryCount: 0, timestamp: now };
        }
      } catch { /* if condition evaluation fails, proceed */ }
    }

    // Input transform
    const resolvedInput = step.inputMap ? applyInputMap(step.inputMap, input) : input;

    // Resolve config with A/B variant
    const resolved = agentRegistryStore.resolveConfig(step.agentName, ctx.runId);
    const config: AgentConfig = {
      ...(resolved?.config ?? {}),
      ...(step.configOverride ?? {}),
    };

    const maxRetries = step.retry?.maxRetries ?? config.maxRetries ?? 0;
    const backoffMs  = step.retry?.backoffMs  ?? 500;
    const timeoutMs  = step.timeoutMs ?? config.timeoutMs ?? 60000;

    let lastError = "";
    let output: unknown;
    let durationMs = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * attempt);

      const stepStart = Date.now();
      try {
        output = await withTimeout(
          executor(step.agentName, config, resolvedInput, ctx),
          timeoutMs
        );
        durationMs = Date.now() - stepStart;

        return {
          stepId: step.id, agentName: step.agentName, label,
          status: "ok", durationMs,
          input: resolvedInput, output,
          retryCount: attempt,
          variant:    resolved?.variant,
          timestamp:  now,
        };
      } catch (err) {
        durationMs = Date.now() - stepStart;
        lastError = err instanceof Error ? err.message : String(err);
        const isTimeout = lastError.includes("TIMEOUT");
        if (isTimeout || attempt === maxRetries) {
          return {
            stepId: step.id, agentName: step.agentName, label,
            status: isTimeout ? "timeout" : "error",
            durationMs, error: lastError,
            retryCount: attempt,
            variant:    resolved?.variant,
            timestamp:  now,
          };
        }
      }
    }

    // Unreachable but TypeScript needs it
    return { stepId: step.id, agentName: step.agentName, label, status: "error", durationMs, error: lastError, retryCount: maxRetries, timestamp: now };
  }

  private _failResult(
    pipelineId: string, pipelineName: string, runId: string,
    input: unknown, error: string
  ): PipelineRunResult {
    const now = new Date().toISOString();
    return {
      pipelineId, pipelineName, runId,
      status: "failed", steps: [], finalOutput: input,
      totalMs: 0, startedAt: now, finishedAt: now,
      errors: [error],
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); })
           .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

type StepBucket =
  | { type: "sequential"; step: PipelineStep }
  | { type: "parallel";   steps: PipelineStep[] };

function groupSteps(steps: PipelineStep[]): StepBucket[] {
  const buckets: StepBucket[] = [];
  const parallelMap: Map<string, PipelineStep[]> = new Map();

  for (const step of steps) {
    if (step.parallelGroup) {
      if (!parallelMap.has(step.parallelGroup)) parallelMap.set(step.parallelGroup, []);
      parallelMap.get(step.parallelGroup)!.push(step);
    } else {
      // Flush any pending parallel group first (steps are declared in order)
      for (const [, psteps] of parallelMap) {
        buckets.push({ type: "parallel", steps: psteps });
      }
      parallelMap.clear();
      buckets.push({ type: "sequential", step });
    }
  }

  // Flush remaining parallel groups
  for (const [, psteps] of parallelMap) {
    buckets.push({ type: "parallel", steps: psteps });
  }

  return buckets;
}

function applyInputMap(map: Record<string, string>, prev: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const obj = (prev && typeof prev === "object") ? prev as Record<string, unknown> : {};
  for (const [targetKey, sourcePath] of Object.entries(map)) {
    result[targetKey] = getPath(obj, sourcePath);
  }
  return result;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const _g = globalThis as typeof globalThis & { __pipelineEngine?: PipelineEngine };
if (!_g.__pipelineEngine) _g.__pipelineEngine = new PipelineEngine();
export const pipelineEngine: PipelineEngine = _g.__pipelineEngine;

// ── Seed default pipelines ────────────────────────────────────────────────────

if (pipelineEngine.listPipelines().length === 0) {
  const makeStep = (id: string, agentName: string, label: string, extra?: Partial<PipelineStep>): PipelineStep => ({
    id, agentName, label, dependencies: [], abVariants: [], retry: { maxRetries: 1, backoffMs: 500 }, ...extra,
  } as PipelineStep);

  // Pipeline A: Metadata → Query → BI → Validation
  pipelineEngine.savePipeline({
    id:          "pipeline-a",
    name:        "Metadata → Query → BI → Validation",
    description: "Standard analytics pipeline: schema discovery, SQL generation, narrative insights, validation.",
    version:     "1.0.0",
    isDefault:   true,
    enabled:     true,
    tags:        ["standard", "analytics", "bi"],
    timeoutMs:   180000,
    createdBy:   "system",
    steps: [
      makeStep("step-1", "MetadataCatalogAgent",       "Metadata Catalog"),
      makeStep("step-2", "QueryGenerationAgent",        "Query Generation"),
      makeStep("step-3", "BusinessIntelligenceAgent",   "BI Insights"),
      makeStep("step-4", "ReportValidationAgent",       "Report Validation"),
    ],
  });

  // Pipeline B: Semantic Search → Query → BI → Recommendation
  pipelineEngine.savePipeline({
    id:          "pipeline-b",
    name:        "Semantic Search → Query → BI → Recommendation",
    description: "Semantic-first pipeline: NL search, SQL generation, AI insights, recommendations.",
    version:     "1.0.0",
    isDefault:   false,
    enabled:     true,
    tags:        ["semantic", "recommendation", "analytics"],
    timeoutMs:   240000,
    createdBy:   "system",
    steps: [
      makeStep("step-1", "SemanticSearchAgent",         "Semantic Search"),
      makeStep("step-2", "QueryGenerationAgent",        "Query Generation"),
      makeStep("step-3", "BusinessIntelligenceAgent",   "BI Insights"),
      makeStep("step-4", "RecommendationAgent",         "Recommendations"),
    ],
  });

  // Pipeline C: Metadata → Data Quality → Security → Validation
  pipelineEngine.savePipeline({
    id:          "pipeline-c",
    name:        "Metadata → Data Quality → Security → Validation",
    description: "Governance pipeline: schema catalog, data quality profiling, security audit, report validation.",
    version:     "1.0.0",
    isDefault:   false,
    enabled:     true,
    tags:        ["governance", "security", "quality"],
    timeoutMs:   120000,
    createdBy:   "system",
    steps: [
      makeStep("step-1", "MetadataCatalogAgent",   "Metadata Catalog"),
      makeStep("step-2", "DataQualityAgent",        "Data Quality"),
      makeStep("step-3", "SecurityAuditAgent",      "Security Audit"),
      makeStep("step-4", "ReportValidationAgent",   "Report Validation"),
    ],
  });

  // Pipeline D: Full Parallel BI — MetadataCatalog + SemanticSearch in parallel → QueryGen → BI
  pipelineEngine.savePipeline({
    id:          "pipeline-d",
    name:        "Parallel Discovery → Query → BI",
    description: "Fan-out pipeline: metadata catalog and semantic search run in parallel, feed a shared query agent.",
    version:     "1.0.0",
    isDefault:   false,
    enabled:     true,
    tags:        ["parallel", "fan-out", "advanced"],
    timeoutMs:   180000,
    createdBy:   "system",
    steps: [
      makeStep("step-1a", "MetadataCatalogAgent",     "Metadata Catalog",   { parallelGroup: "discovery" }),
      makeStep("step-1b", "SemanticSearchAgent",      "Semantic Search",    { parallelGroup: "discovery" }),
      makeStep("step-2",  "QueryGenerationAgent",     "Query Generation"),
      makeStep("step-3",  "BusinessIntelligenceAgent","BI Insights"),
    ],
  });
}
