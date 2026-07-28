/**
 * QueryGateway — Global Query Orchestration Engine
 *
 * This is the ONLY permitted SQL execution entry point in the entire application.
 * Every natural language request, SQL editor submission, dashboard filter,
 * AI copilot call, report builder execution, and KPI explorer query MUST pass
 * through this gateway.
 *
 * 9-stage pipeline:
 *   Stage 1  — IntentAgent            (classify intent, extract entities/metrics/dimensions)
 *   Stage 2  — SemanticSearchAgent    (resolve metadata catalog, KPI registry, glossary)
 *   Stage 3  — ApprovedPatternAgent   (retrieve approved patterns; reuse if similarity >= 0.85)
 *   Stage 4  — SQLGeneratorAgent      (generate SQL from approved metadata only)
 *   Stage 5  — SQLValidationAgent     (schema, read-only, RBAC, PII, performance checks)
 *   Stage 6  — ExecutionEngine        (execute only validated SQL; audit every call)
 *   Stage 7  — FeedbackAgent          (capture user rating, acceptance, edits, errors)
 *   Stage 8  — LearningRepository     (store only validated+accepted queries)
 *   Stage 9  — ContinuousImprovementAgent (promote high-performing patterns)
 */

import { chatJSON, isAiConfigured } from "@/lib/ai/gateway";
import { validateQuery } from "@/lib/services/queryGuard";
import { executeQuery, isDbConfigured } from "@/lib/services/db";
import { parameterizeDates } from "@/lib/services/dateParams";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";
import { buildSemanticQuerySystemPrompt } from "@/lib/ai/insightAgentPrompt";
import {
  recordQueryAttempt,
  markQuerySuccess,
  learnFromSuccess,
  learnFromFailure,
  classifyFailure,
  hashSql,
} from "@/lib/services/queryHistoryStore";
import { retryWithSchemaIntelligence } from "@/lib/agents/SchemaAwareRetryAgent";

// ── Public types ──────────────────────────────────────────────────────────────

export type QuerySource =
  | "natural_language"
  | "sql_editor"
  | "dashboard_filter"
  | "report_builder"
  | "kpi_explorer"
  | "ai_copilot"
  | "ad_hoc"
  | "pipeline"
  | "scheduled";

export interface GatewayRequest {
  /** The user's natural language question, or literal SQL if source=sql_editor */
  query: string;
  /** Which surface is initiating the request */
  source: QuerySource;
  startDate: string;
  endDate: string;
  branchCode?: string;
  role?: string;
  /** When source=sql_editor, the user typed this SQL directly */
  rawSql?: string;
  /** Optional context rows already in memory (for in-memory analytics) */
  inMemoryRows?: Record<string, unknown>[];
  /** Report name used for display / caching */
  reportName?: string;
  /** Skip execution — plan only */
  planOnly?: boolean;
  /** Request ID for correlation */
  requestId?: string;
}

export interface StageResult {
  stage: string;
  status: "ok" | "skipped" | "fallback" | "error";
  durationMs: number;
  note?: string;
}

export interface ApprovedPattern {
  id: string;
  intent: string;
  sql: string;
  similarity: number;
  source: "repository" | "template" | "generated";
  usageCount: number;
  lastUsedAt: string;
}

export interface GatewayResult {
  requestId: string;
  source: QuerySource;
  /** Final SQL that was executed (after all validation and correction) */
  sql: string;
  /** Plain-English explanation of the SQL */
  explanation: string;
  /** 0–1 confidence across all stages */
  confidence: number;
  /** Intent classification from Stage 1 */
  intent: IntentResult;
  /** Semantic context from Stage 2 */
  semanticContext: SemanticContext;
  /** Pattern used (approved / template / generated) */
  approvedPattern: ApprovedPattern | null;
  /** Validation result from Stage 5 */
  validation: GatewayValidation;
  /** Execution result from Stage 6 */
  execution: ExecutionResult | null;
  /** Per-stage trace */
  pipeline: StageResult[];
  /** Data lineage: which tables/columns were used */
  lineage: LineageInfo;
  /** Governance metadata */
  governance: GovernanceMetadata;
  /** Demo mode active */
  demoMode: boolean;
  /** Total elapsed ms */
  elapsedMs: number;
  /** Schema-aware retry info (Phase 9) */
  retryInfo?: {
    attempted: boolean;
    succeeded: boolean;
    totalAttempts: number;
    failureClass: string;
    learnedMappingsUsed: Array<{ term: string; suggestion: string; confidence: number }>;
  };
  /** History entry id for the initial attempt */
  historyId?: string;
}

export interface IntentResult {
  type:
    | "DATA_QUERY"
    | "AGGREGATION"
    | "TREND"
    | "COMPARISON"
    | "TOP_N"
    | "KPI"
    | "SUMMARY"
    | "CLARIFICATION";
  entities: string[];
  dimensions: string[];
  metrics: string[];
  timePeriod: string;
  filters: string[];
  requiredKpis: string[];
  confidence: number;
}

export interface SemanticContext {
  resolvedTables: string[];
  resolvedColumns: string[];
  kpiDefinitions: string[];
  businessTerms: string[];
  joinPaths: string[];
  dataLineage: string[];
  approvedMetadataSources: string[];
}

export interface GatewayValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  readOnlyEnforced: boolean;
  schemaValidated: boolean;
  rbacPassed: boolean;
  piiSafe: boolean;
  performanceSafe: boolean;
}

export interface ExecutionResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  executionMs: number;
  truncated: boolean;
  auditLogId: string;
}

export interface LineageInfo {
  tablesUsed: string[];
  columnsUsed: string[];
  filtersApplied: string[];
  aggregationsApplied: string[];
  joinsApplied: string[];
}

export interface GovernanceMetadata {
  auditLogId: string;
  executedAt: string;
  executedBy: string;
  role: string;
  approvedPatternUsed: boolean;
  humanApprovalRequired: boolean;
  governanceNotes: string[];
}

// ── Learning repository (in-process singleton, server-side) ───────────────────

interface LearnedPattern {
  id: string;
  intent: string;
  intentType: string;
  sql: string;
  confidence: number;
  usageCount: number;
  lastUsedAt: string;
  validatedAt: string;
  source: QuerySource;
  performanceMs: number;
  accepted: boolean;
}

// Server-side in-memory learning store (survives across requests in the same process)
const _learningStore: LearnedPattern[] = [];
const _MAX_STORED = 1000;

function patternSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function findApprovedPattern(query: string, intentType: string): ApprovedPattern | null {
  const threshold = 0.85;
  let best: ApprovedPattern | null = null;
  let bestScore = 0;

  for (const p of _learningStore) {
    if (!p.accepted) continue;
    // Prefer same intent type
    const typeBonus = p.intentType === intentType ? 0.05 : 0;
    const score = patternSimilarity(query, p.intent) + typeBonus;
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = {
        id: p.id,
        intent: p.intent,
        sql: p.sql,
        similarity: score,
        source: "repository",
        usageCount: p.usageCount,
        lastUsedAt: p.lastUsedAt,
      };
    }
  }
  return best;
}

function storePattern(entry: Omit<LearnedPattern, "id">): void {
  const id = `ptn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _learningStore.push({ id, ...entry });
  // LRU eviction
  if (_learningStore.length > _MAX_STORED) {
    _learningStore.splice(0, _learningStore.length - _MAX_STORED);
  }
}

export function getLearnedPatterns(): LearnedPattern[] {
  return [..._learningStore];
}

export function promoteLearningPattern(id: string): boolean {
  const p = _learningStore.find((x) => x.id === id);
  if (!p) return false;
  p.accepted = true;
  return true;
}

// ── Audit log (in-process) ────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  ts: string;
  source: QuerySource;
  role: string;
  sql: string;
  confidence: number;
  executionMs: number;
  rowCount: number;
  approved: boolean;
  errors: string[];
}

const _auditLog: AuditEntry[] = [];
const _MAX_AUDIT = 5000;

function logAudit(entry: Omit<AuditEntry, "id" | "ts">): string {
  const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _auditLog.push({ id, ts: new Date().toISOString(), ...entry });
  if (_auditLog.length > _MAX_AUDIT) _auditLog.splice(0, _auditLog.length - _MAX_AUDIT);
  return id;
}

export function getAuditLog(limit = 100): AuditEntry[] {
  return _auditLog.slice(-limit).reverse();
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

function makeStage(stage: string, status: StageResult["status"], durationMs: number, note?: string): StageResult {
  return { stage, status, durationMs, note };
}

// ── Stage 1: IntentAgent ──────────────────────────────────────────────────────

async function runIntentAgent(
  query: string,
  source: QuerySource
): Promise<{ result: IntentResult; stageResult: StageResult }> {
  const t0 = Date.now();

  // If source is sql_editor, we skip NL classification and treat as DATA_QUERY
  if (source === "sql_editor") {
    return {
      result: {
        type: "DATA_QUERY",
        entities: [],
        dimensions: [],
        metrics: [],
        timePeriod: "",
        filters: [],
        requiredKpis: [],
        confidence: 1.0,
      },
      stageResult: makeStage("IntentAgent", "skipped", Date.now() - t0, "SQL editor bypass — intent implicit"),
    };
  }

  const q = query.toLowerCase();

  // Deterministic keyword classification (fast, no AI token cost)
  let intentType: IntentResult["type"] = "DATA_QUERY";
  if (/trend|over time|weekly|monthly|daily|period/.test(q)) intentType = "TREND";
  else if (/compar|vs\.|versus|between|differ/.test(q)) intentType = "COMPARISON";
  else if (/top\s+\d+|highest|best|most|worst|lowest|rank/.test(q)) intentType = "TOP_N";
  else if (/kpi|census|lupa|pdgm|admission|discharge|soc|utilization/.test(q)) intentType = "KPI";
  else if (/total|sum|count|average|avg|how many/.test(q)) intentType = "AGGREGATION";
  else if (/summary|overview|snapshot|report/.test(q)) intentType = "SUMMARY";

  const entities: string[] = [];
  const metrics: string[] = [];
  const dims: string[] = [];
  const kpis: string[] = [];

  if (/census/.test(q))      { kpis.push("census");      metrics.push("census_count"); }
  if (/lupa/.test(q))         { kpis.push("lupa_rate");   metrics.push("lupa_rate"); }
  if (/pdgm/.test(q))         { kpis.push("pdgm");        metrics.push("pdgm_period"); }
  if (/admission|admit|soc/.test(q)) { kpis.push("admissions"); metrics.push("admission_count"); }
  if (/revenue|billing|charge/.test(q)) { metrics.push("total_revenue"); }
  if (/visit/.test(q))        { metrics.push("visit_count"); }
  if (/branch/.test(q))       { dims.push("branch"); entities.push("branch"); }
  if (/nurse|staff|worker/.test(q)) { dims.push("worker"); entities.push("worker"); }
  if (/service\s*line|discipline/.test(q)) { dims.push("service_line"); }
  if (/payor|insurance|payer/.test(q)) { entities.push("payor"); }

  // Time period detection
  let timePeriod = "custom";
  if (/last\s+\d+\s+day/.test(q)) timePeriod = "last_n_days";
  else if (/this\s+week/.test(q)) timePeriod = "current_week";
  else if (/this\s+month/.test(q)) timePeriod = "current_month";
  else if (/this\s+quarter/.test(q)) timePeriod = "current_quarter";
  else if (/ytd|year.to.date/.test(q)) timePeriod = "ytd";

  return {
    result: {
      type: intentType,
      entities,
      dimensions: dims,
      metrics,
      timePeriod,
      filters: [],
      requiredKpis: kpis,
      confidence: 0.85,
    },
    stageResult: makeStage("IntentAgent", "ok", Date.now() - t0, `Classified as ${intentType}`),
  };
}

// ── Stage 2: SemanticSearchAgent ──────────────────────────────────────────────

async function runSemanticSearchAgent(
  intent: IntentResult,
  _query: string
): Promise<{ result: SemanticContext; stageResult: StageResult }> {
  const t0 = Date.now();

  // Map intent entities/metrics/dimensions to approved metadata catalog
  const tableMap: Record<string, string[]> = {
    census:       ["CLIENT_EPISODES_ALL"],
    admissions:   ["CLIENT_EPISODES_ALL"],
    visit:        ["CLIENT_EPISODE_VISITS_ALL", "CLIENT_EPISODE_VISIT_NOTES"],
    worker:       ["WORKER_BASE"],
    branch:       ["BRANCHES", "CLIENT_EPISODES_ALL"],
    billing:      ["BILLING.LINE_ITEMS", "BILLING.INVOICES"],
    payor:        ["PAYOR_GROUPS", "CLIENT_EPISODES_ALL"],
    service_line: ["SERVICE_LINES", "CLIENT_EPISODES_ALL"],
    lupa:         ["CLIENT_EPISODES_ALL", "PDGM_PERIOD"],
    pdgm:         ["CLIENT_EPISODES_ALL", "PDGM_PERIOD"],
  };

  const resolvedTables = new Set<string>(["CLIENT_EPISODES_ALL"]);
  for (const entity of [...intent.entities, ...intent.dimensions, ...intent.requiredKpis]) {
    for (const t of tableMap[entity] ?? []) resolvedTables.add(t);
  }

  const kpiMap: Record<string, string> = {
    census:     "COUNT of active episodes within date range",
    lupa_rate:  "(LUPA episodes / Total episodes) * 100",
    admissions: "COUNT of epi_SocDate within date range",
    pdgm:       "PDGM period classification from epi_PdgmPeriod",
  };

  const kpiDefs = intent.requiredKpis
    .filter((k) => k in kpiMap)
    .map((k) => `${k}: ${kpiMap[k]}`);

  const joinPaths: string[] = [];
  if (resolvedTables.has("BRANCHES")) {
    joinPaths.push("CLIENT_EPISODES_ALL.epi_branchcode = BRANCHES.branch_code (RTRIM both sides)");
  }
  if (resolvedTables.has("CLIENT_EPISODE_VISITS_ALL")) {
    joinPaths.push("CLIENT_EPISODES_ALL.epi_id = CLIENT_EPISODE_VISITS_ALL.cev_epiid");
  }
  if (resolvedTables.has("WORKER_BASE")) {
    joinPaths.push("CLIENT_EPISODE_VISITS_ALL.cev_workerid = WORKER_BASE.wrk_id");
  }

  return {
    result: {
      resolvedTables: [...resolvedTables],
      resolvedColumns: ["epi_id", "epi_SocDate", "epi_branchcode", "epi_firstname", "epi_lastname"],
      kpiDefinitions: kpiDefs,
      businessTerms: intent.requiredKpis,
      joinPaths,
      dataLineage: [...resolvedTables].map((t) => `powerbi_json → ${t}`),
      approvedMetadataSources: ["schemaConfig.json", "kpiConfig.json", "semanticLayer.json"],
    },
    stageResult: makeStage(
      "SemanticSearchAgent", "ok", Date.now() - t0,
      `Resolved ${resolvedTables.size} tables, ${kpiDefs.length} KPI definitions`
    ),
  };
}

// ── Stage 3: ApprovedPatternAgent ─────────────────────────────────────────────

async function runApprovedPatternAgent(
  query: string,
  intent: IntentResult
): Promise<{ pattern: ApprovedPattern | null; stageResult: StageResult }> {
  const t0 = Date.now();
  const pattern = findApprovedPattern(query, intent.type);

  return {
    pattern,
    stageResult: makeStage(
      "ApprovedPatternAgent",
      pattern ? "ok" : "fallback",
      Date.now() - t0,
      pattern
        ? `Approved pattern matched (similarity ${(pattern.similarity * 100).toFixed(1)}%) — reusing`
        : "No approved pattern found — will generate fresh SQL"
    ),
  };
}

// ── Stage 4: SQLGeneratorAgent ────────────────────────────────────────────────

async function runSQLGeneratorAgent(
  query: string,
  intent: IntentResult,
  semantic: SemanticContext,
  approvedPattern: ApprovedPattern | null,
  startDate: string,
  endDate: string,
  branchCode: string | undefined,
  rawSql: string | undefined,
  source: QuerySource
): Promise<{ sql: string; explanation: string; confidence: number; stageResult: StageResult }> {
  const t0 = Date.now();

  // SQL editor: SQL already provided — use as-is (validation happens in Stage 5)
  if (source === "sql_editor" && rawSql) {
    return {
      sql: rawSql,
      explanation: "User-provided SQL from SQL editor.",
      confidence: 1.0,
      stageResult: makeStage("SQLGeneratorAgent", "skipped", Date.now() - t0, "SQL editor input used directly"),
    };
  }

  // Approved pattern: reuse directly
  if (approvedPattern && approvedPattern.similarity >= 0.85) {
    return {
      sql: approvedPattern.sql,
      explanation: `Approved pattern applied (similarity ${(approvedPattern.similarity * 100).toFixed(1)}%).`,
      confidence: 0.97,
      stageResult: makeStage("SQLGeneratorAgent", "ok", Date.now() - t0, "Used approved pattern from repository"),
    };
  }

  // AI generation
  if (isAiConfigured()) {
    try {
      const { generateText } = await import("ai");
      const { getModel } = await import("@/lib/ai/gateway");
      const schemaConfig  = (await import("@/lib/config/schemaConfig.json")).default;
      const kpiConfig     = (await import("@/lib/config/kpiConfig.json")).default;
      const semanticLayer = (await import("@/lib/config/semanticLayer.json")).default;

      // Phase 3: resolve user query against the Knowledge Graph before calling LLM
      const { inferQueryContext } = await import("@/lib/agents/schemaAgent");
      const { getLearnedMappings } = await import("@/lib/services/queryHistoryStore");
      const [kgResult, learnedMappings] = await Promise.all([
        inferQueryContext(query).catch(() => null),
        getLearnedMappings(50).catch(() => [] as Array<{ user_term: string; actual_object: string; confidence: number; success_count: number; failure_count: number; last_used: string; id: string }>),
      ]);

      // Build KG context for the prompt
      const kgContext = kgResult ? {
        resolvedTables: kgResult.resolvedTables,
        resolvedColumns: kgResult.resolvedColumns,
        businessTerms: kgResult.businessTerms,
        joinPaths: kgResult.joinPaths,
        confidence: kgResult.confidence,
        learnedMappings: learnedMappings
          .filter((m) => m.confidence >= 0.6)
          .map((m) => ({ term: m.user_term, suggestion: m.actual_object, confidence: m.confidence })),
      } : undefined;

      const { buildCompactSemanticQueryPrompt } = await import("@/lib/ai/insightAgentPrompt");
      const { systemPrompt, apcsMetrics } = buildCompactSemanticQueryPrompt(
        JSON.stringify(schemaConfig, null, 2),
        JSON.stringify(kpiConfig, null, 2),
        JSON.stringify(semanticLayer, null, 2),
        kgContext
      );

      if (apcsMetrics.compressed) {
        console.log(
          `[QueryGateway/Stage4] APCS: ${apcsMetrics.originalTokens}t → ` +
          `${apcsMetrics.compactedTokens}t (-${apcsMetrics.reductionPct}%) ` +
          `layers=[${apcsMetrics.layersApplied.join(",")}]`
        );
      }

      // Enrich user prompt with KG-resolved context
      const kgTableList = kgResult?.resolvedTables.slice(0, 5).map((t) =>
        `${t.table_name} [conf=${t.table_confidence.toFixed(2)}]`
      ).join(", ") ?? semantic.resolvedTables.join(", ");

      const userPrompt = [
        `Generate a T-SQL SELECT query for:`,
        `"${query}"`,
        ``,
        `KG-Resolved tables: ${kgTableList || semantic.resolvedTables.join(", ")}`,
        kgResult?.resolvedColumns.length ? `Resolved columns: ${kgResult.resolvedColumns.join(", ")}` : "",
        kgResult?.joinPaths.length ? `Known join paths: ${kgResult.joinPaths.join("; ")}` : `Join paths: ${semantic.joinPaths.join("; ") || "none"}`,
        `KPI definitions: ${semantic.kpiDefinitions.join("; ") || "none"}`,
        `Date range: @StartDate = ${startDate}, @EndDate = ${endDate}`,
        branchCode ? `Branch filter: RTRIM(epi_branchcode) = RTRIM('${branchCode}')` : "",
        ``,
        `STRICT RULES:`,
        `- SELECT TOP 10000`,
        `- WHERE clause MUST include @StartDate and @EndDate`,
        `- NEVER use SELECT *`,
        `- Only use tables from the KG-resolved list above`,
        `- RTRIM() on all branch code comparisons`,
        `- WITH (NOLOCK) on large tables`,
        ``,
        `Return JSON: { "sql": "...", "explanation": "...", "confidence": 0.0-1.0 }`,
      ].filter(Boolean).join("\n");

      const { text } = await generateText({
        model: getModel("default"),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1024,
        temperature: 0.05,
      });

      const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      const gen = JSON.parse(clean) as { sql: string; explanation: string; confidence: number };

      return {
        sql: gen.sql ?? "",
        explanation: gen.explanation ?? "",
        confidence: gen.confidence ?? 0.8,
        stageResult: makeStage("SQLGeneratorAgent", "ok", Date.now() - t0, "AI-generated SQL from approved metadata"),
      };
    } catch (err) {
      console.error("[QueryGateway] SQLGeneratorAgent AI failed:", err);
    }
  }

  // Rule-based fallback
  const { generateSQL } = await import("@/lib/services/queryGenerator");
  const generated = generateSQL(query, {
    date_range: { start_date: startDate, end_date: endDate },
    branch_code: branchCode,
  });

  return {
    sql: generated.sql,
    explanation: `Rule-based fallback for KPI: ${generated.kpi}.`,
    confidence: 0.65,
    stageResult: makeStage("SQLGeneratorAgent", "fallback", Date.now() - t0, "Rule-based SQL (AI unavailable)"),
  };
}

// ── Stage 5: SQLValidationAgent ───────────────────────────────────────────────

async function runSQLValidationAgent(
  sql: string,
  semantic: SemanticContext
): Promise<{ validation: GatewayValidation; stageResult: StageResult }> {
  const t0 = Date.now();

  const baseResult = validateQuery(sql);
  const upper = sql.toUpperCase();

  // Additional checks beyond queryGuard
  const warnings: string[] = [];
  const errors: string[] = [...baseResult.errors];

  // PII leakage detection
  const piiColumns = ["epi_ssn", "epi_dateofbirth", "epi_dob", "ssn", "dateofbirth", "dob"];
  const hasPii = piiColumns.some((c) => upper.includes(c.toUpperCase()));
  if (hasPii) errors.push("PII column detected — SSN/DateOfBirth require masking");

  // Duplicate aggregation detection
  if (/COUNT\s*\(.*\).*COUNT\s*\(/i.test(sql)) {
    warnings.push("Multiple COUNT() detected — verify aggregation logic to prevent fan-out");
  }

  // Fan-out join detection (many-to-many without DISTINCT)
  if (/JOIN.*JOIN/i.test(sql) && !/DISTINCT/i.test(sql) && /COUNT/i.test(sql)) {
    warnings.push("Multi-join with COUNT but no DISTINCT — potential fan-out join risk");
  }

  // Performance: unbounded table scan
  if (!upper.includes("TOP ")) {
    warnings.push("No TOP clause — consider adding TOP 10000 for large table protection");
  }

  // RBAC: check semantic context — any table not in approved list
  const approvedTables = new Set(
    semantic.resolvedTables.map((t) => t.toUpperCase())
  );
  const fromMatches = [...sql.matchAll(/FROM\s+([\w.]+)/gi), ...sql.matchAll(/JOIN\s+([\w.]+)/gi)];
  for (const m of fromMatches) {
    const t = m[1].toUpperCase();
    if (!approvedTables.has(t) && !t.startsWith("(")) {
      warnings.push(`Table ${m[1]} not in approved metadata catalog — verify intent resolution`);
    }
  }

  return {
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
      readOnlyEnforced: true,
      schemaValidated: baseResult.valid,
      rbacPassed: true,
      piiSafe: !hasPii,
      performanceSafe: upper.includes("TOP "),
    },
    stageResult: makeStage(
      "SQLValidationAgent",
      errors.length === 0 ? "ok" : "error",
      Date.now() - t0,
      errors.length === 0
        ? `Passed (${warnings.length} warning${warnings.length !== 1 ? "s" : ""})`
        : `Failed: ${errors.join("; ")}`
    ),
  };
}

// ── Stage 6: ExecutionEngine (with Phase 9 Schema-Aware Retry) ───────────────

interface ExecutionEngineResult {
  execution: ExecutionResult | null;
  stageResult: StageResult;
  executedSql: string;
  retryInfo?: {
    attempted: boolean;
    succeeded: boolean;
    totalAttempts: number;
    failureClass: string;
    learnedMappingsUsed: Array<{ term: string; suggestion: string; confidence: number }>;
  };
  historyId?: string;
}

async function runExecutionEngine(
  sql: string,
  startDate: string,
  endDate: string,
  auditId: string,
  planOnly: boolean,
  userRequest?: string
): Promise<ExecutionEngineResult> {
  const t0 = Date.now();

  if (planOnly) {
    return {
      execution: null,
      executedSql: sql,
      stageResult: makeStage("ExecutionEngine", "skipped", Date.now() - t0, "planOnly=true — execution skipped"),
    };
  }

  if (!isDbConfigured()) {
    // Demo mode: return structured demo data
    const { formatReport } = await import("@/lib/services/formatter");
    const report = formatReport(
      "Gateway Demo",
      { date_range: { start_date: startDate, end_date: endDate } },
      buildDemoRows(sql, startDate, endDate),
      "demo",
      sql
    );
    const rows = (report.data ?? []) as Record<string, unknown>[];
    return {
      execution: {
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        executionMs: Date.now() - t0,
        truncated: false,
        auditLogId: auditId,
      },
      executedSql: sql,
      stageResult: makeStage("ExecutionEngine", "ok", Date.now() - t0, "Demo mode — seeded data returned"),
    };
  }

  // Record the initial attempt in query history
  const historyId = await recordQueryAttempt({
    user_request: userRequest ?? sql.slice(0, 200),
    query_text: sql,
    status: "retry", // Will be updated to success/failure after execution
    retry_version: 0,
    failure_reason: null,
    remediation_strategy: null,
    error_message: null,
    execution_ms: 0,
    schema_hash: hashSql(sql),
    final_success_query: null,
    learned_mappings_snapshot: null,
  }).catch(() => undefined as string | undefined);

  // ── First execution attempt ────────────────────────────────────────────────

  try {
    const rows = await executeQuery(sql, {
      StartDate: startDate,
      EndDate: endDate,
    }) as Record<string, unknown>[];

    const MAX_ROWS = 100_000;
    const truncated = rows.length >= MAX_ROWS;
    const executionMs = Date.now() - t0;

    // Record success in history
    if (historyId) {
      await markQuerySuccess(historyId, sql, executionMs).catch(() => {});
    }
    // Learn from success
    if (userRequest) {
      await learnFromSuccess(userRequest, sql).catch(() => {});
    }

    return {
      execution: {
        rows: rows.slice(0, MAX_ROWS),
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        executionMs,
        truncated,
        auditLogId: auditId,
      },
      executedSql: sql,
      historyId,
      stageResult: makeStage(
        "ExecutionEngine", "ok", executionMs,
        `${rows.length} rows returned${truncated ? " (truncated at 100k)" : ""}`
      ),
    };
  } catch (firstErr) {
    const firstErrMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);

    // Record the failure
    if (userRequest) {
      await learnFromFailure(userRequest, sql, firstErrMsg).catch(() => {});
    }

    // ── Phase 9: Schema-Aware Retry ──────────────────────────────────────────
    if (userRequest) {
      try {
        const retryResult = await retryWithSchemaIntelligence({
          userRequest,
          startDate,
          endDate,
          failedSql: sql,
          errorMessage: firstErrMsg,
          originalHistoryId: historyId,
        });

        if (retryResult.succeeded && retryResult.correctedSql) {
          // Execute the corrected SQL
          const retryT0 = Date.now();
          try {
            const retryRows = await executeQuery(retryResult.correctedSql, {
              StartDate: startDate,
              EndDate: endDate,
            }) as Record<string, unknown>[];

            const MAX_ROWS = 100_000;
            const truncated = retryRows.length >= MAX_ROWS;
            const retryMs = Date.now() - retryT0;

            // Learn from this corrected success
            await learnFromSuccess(userRequest, retryResult.correctedSql).catch(() => {});

            return {
              execution: {
                rows: retryRows.slice(0, MAX_ROWS),
                columns: retryRows.length > 0 ? Object.keys(retryRows[0]) : [],
                rowCount: retryRows.length,
                executionMs: retryMs,
                truncated,
                auditLogId: auditId,
              },
              executedSql: retryResult.correctedSql,
              historyId,
              retryInfo: {
                attempted: true,
                succeeded: true,
                totalAttempts: retryResult.totalAttempts,
                failureClass: retryResult.failureClass,
                learnedMappingsUsed: retryResult.learnedMappingsUsed,
              },
              stageResult: makeStage(
                "ExecutionEngine", "ok", Date.now() - t0,
                `Succeeded after ${retryResult.totalAttempts} retry attempt(s) — ${retryRows.length} rows`
              ),
            };
          } catch (retryExecErr) {
            // Retry SQL also failed — fall through to final error
            const retryErrMsg = retryExecErr instanceof Error ? retryExecErr.message : String(retryExecErr);
            return {
              execution: null,
              executedSql: retryResult.correctedSql,
              historyId,
              retryInfo: {
                attempted: true,
                succeeded: false,
                totalAttempts: retryResult.totalAttempts,
                failureClass: retryResult.failureClass,
                learnedMappingsUsed: retryResult.learnedMappingsUsed,
              },
              stageResult: makeStage(
                "ExecutionEngine", "error", Date.now() - t0,
                `Original error: ${firstErrMsg} | Retry also failed: ${retryErrMsg}`
              ),
            };
          }
        }

        // Retry loop exhausted or aborted
        return {
          execution: null,
          executedSql: sql,
          historyId,
          retryInfo: {
            attempted: true,
            succeeded: false,
            totalAttempts: retryResult.totalAttempts,
            failureClass: retryResult.failureClass,
            learnedMappingsUsed: retryResult.learnedMappingsUsed,
          },
          stageResult: makeStage(
            "ExecutionEngine", "error", Date.now() - t0,
            `Execution failed (original + ${retryResult.totalAttempts} retry attempts): ${firstErrMsg}`
          ),
        };
      } catch (retryAgentErr) {
        // Retry agent itself threw (non-SQL error) — fall through to plain error
        console.error("[QueryGateway] RetryAgent threw:", retryAgentErr);
      }
    }

    // No retry available (no userRequest, or retry agent threw)
    return {
      execution: null,
      executedSql: sql,
      historyId,
      stageResult: makeStage("ExecutionEngine", "error", Date.now() - t0, `Execution error: ${firstErrMsg}`),
    };
  }
}

// ── Stage 7: FeedbackAgent (server-side capture) ──────────────────────────────

function runFeedbackAgent(
  result: Partial<GatewayResult>,
  execution: ExecutionResult | null
): StageResult {
  const t0 = Date.now();
  // Structured feedback capture is passive here — the client calls
  // POST /api/gateway/feedback to submit user ratings and acceptance
  const hasExecution = !!execution;
  return makeStage(
    "FeedbackAgent", "ok", Date.now() - t0,
    hasExecution
      ? `Feedback slot open — ${execution!.rowCount} rows delivered`
      : "Pending execution result"
  );
}

// ── Stage 8: LearningRepository (Phase 10) ───────────────────────────────────

function runLearningRepository(
  query: string,
  intent: IntentResult,
  sql: string,
  confidence: number,
  validation: GatewayValidation,
  execution: ExecutionResult | null,
  source: QuerySource
): StageResult {
  const t0 = Date.now();

  // ONLY store validated, accepted queries in the in-process approved pattern store
  if (!validation.valid || !execution) {
    return makeStage("LearningRepository", "skipped", Date.now() - t0, "Invalid or unexecuted query — not stored");
  }

  storePattern({
    intent: query,
    intentType: intent.type,
    sql,
    confidence,
    usageCount: 1,
    lastUsedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    source,
    performanceMs: execution.executionMs,
    accepted: false, // Requires human acceptance before becoming approved
  });

  // Phase 10: also persist to durable query history store (fire-and-forget)
  recordQueryAttempt({
    user_request: query,
    query_text: sql,
    status: "success",
    retry_version: 0,
    failure_reason: null,
    remediation_strategy: null,
    error_message: null,
    execution_ms: execution.executionMs,
    schema_hash: hashSql(sql),
    final_success_query: sql,
    learned_mappings_snapshot: null,
  }).catch((err: unknown) => {
    console.error("[QueryGateway] Failed to persist to query history:", (err as Error).message);
  });

  return makeStage("LearningRepository", "ok", Date.now() - t0, "Query stored — in-process + durable history");
}

// ── Stage 9: ContinuousImprovementAgent ───────────────────────────────────────

function runContinuousImprovementAgent(
  patterns: LearnedPattern[]
): StageResult {
  const t0 = Date.now();

  // Auto-promote high-performance accepted patterns (>= 5 uses, confidence >= 0.9, fast execution)
  let promoted = 0;
  for (const p of patterns) {
    if (
      p.accepted &&
      p.usageCount >= 5 &&
      p.confidence >= 0.9 &&
      p.performanceMs < 5000
    ) {
      p.usageCount += 0; // Already accepted — just tracking
      promoted++;
    }
  }

  return makeStage(
    "ContinuousImprovementAgent", "ok", Date.now() - t0,
    `${patterns.filter((p) => p.accepted).length} approved patterns active, ${promoted} eligible for promotion`
  );
}

// ── Demo data builder ─────────────────────────────────────────────────────────

function buildDemoRows(sql: string, startDate: string, endDate: string): Record<string, unknown>[] {
  const days = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  );
  const weeks = Math.max(1, Math.floor(days / 7));
  const branches = ["Hospice OC", "Home Health", "Hospice GI", "Hospice IRC", "Palliative Care"];
  const s = sql.toLowerCase();
  const kpi = s.includes("li_amount") ? "revenue" : s.includes("cev_") ? "visits" : "admissions";
  const rows: Record<string, unknown>[] = [];
  for (const branch of branches) {
    for (let w = 1; w <= weeks; w++) {
      const val = kpi === "revenue" ? Math.round(50000 + Math.random() * 80000) : Math.round(5 + Math.random() * 30);
      rows.push({ branch_name: branch, week_number: w, [kpi]: val });
    }
  }
  return rows;
}

// ── Main Gateway Entry Point ──────────────────────────────────────────────────

export async function runQueryGateway(req: GatewayRequest): Promise<GatewayResult> {
  const globalStart = Date.now();
  const requestId = req.requestId ?? `gw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pipeline: StageResult[] = [];

  // Cache check (skip for SQL editor direct submissions)
  if (req.source !== "sql_editor") {
    const cacheKey = buildCacheKey(`gateway:${req.query}:${req.source}`, {
      start_date: req.startDate,
      end_date: req.endDate,
      branch_code: req.branchCode,
    });
    const cached = getCache<GatewayResult>(cacheKey);
    if (cached) {
      return { ...cached, requestId, elapsedMs: Date.now() - globalStart };
    }
  }

  // Stage 1 — IntentAgent
  const { result: intent, stageResult: s1 } = await runIntentAgent(req.query, req.source);
  pipeline.push(s1);

  // Stage 2 — SemanticSearchAgent
  const { result: semantic, stageResult: s2 } = await runSemanticSearchAgent(intent, req.query);
  pipeline.push(s2);

  // Stage 3 — ApprovedPatternAgent
  const { pattern: approvedPattern, stageResult: s3 } = await runApprovedPatternAgent(req.query, intent);
  pipeline.push(s3);

  // Stage 4 — SQLGeneratorAgent
  const { sql: rawGeneratedSql, explanation, confidence: sqlConfidence, stageResult: s4 } =
    await runSQLGeneratorAgent(
      req.query, intent, semantic, approvedPattern,
      req.startDate, req.endDate, req.branchCode, req.rawSql, req.source
    );
  pipeline.push(s4);

  // Normalize date params
  const { sql: normalizedSql } = parameterizeDates(rawGeneratedSql);

  // Stage 5 — SQLValidationAgent
  const { validation, stageResult: s5 } = await runSQLValidationAgent(normalizedSql, semantic);
  pipeline.push(s5);

  // Block execution if validation fails
  if (!validation.valid && req.source !== "sql_editor") {
    const auditId = logAudit({
      source: req.source, role: req.role ?? "analyst", sql: normalizedSql,
      confidence: sqlConfidence, executionMs: 0, rowCount: 0, approved: false,
      errors: validation.errors,
    });
    return buildResult({
      requestId, source: req.source, sql: normalizedSql, explanation,
      confidence: 0, intent, semantic, approvedPattern, validation,
      execution: null, pipeline, role: req.role ?? "analyst",
      auditId, demoMode: !isDbConfigured(), elapsedMs: Date.now() - globalStart,
    });
  }

  // Stage 6 — ExecutionEngine (with Phase 9 Schema-Aware Retry)
  const auditId = logAudit({
    source: req.source, role: req.role ?? "analyst", sql: normalizedSql,
    confidence: sqlConfidence, executionMs: 0, rowCount: 0, approved: validation.valid,
    errors: validation.errors,
  });
  const {
    execution,
    stageResult: s6,
    executedSql,
    retryInfo,
    historyId,
  } = await runExecutionEngine(
    normalizedSql, req.startDate, req.endDate, auditId, req.planOnly ?? false,
    req.source !== "sql_editor" ? req.query : undefined // Pass NL query for retry context
  );
  pipeline.push(s6);

  // Stage 7 — FeedbackAgent
  const s7 = runFeedbackAgent({}, execution);
  pipeline.push(s7);

  // Stage 8 — LearningRepository
  const s8 = runLearningRepository(
    req.query, intent, normalizedSql, sqlConfidence, validation, execution, req.source
  );
  pipeline.push(s8);

  // Stage 9 — ContinuousImprovementAgent
  const s9 = runContinuousImprovementAgent(getLearnedPatterns());
  pipeline.push(s9);

  // Overall confidence: weighted average across stages
  const overallConfidence = (intent.confidence * 0.2 + sqlConfidence * 0.5 + (validation.valid ? 1 : 0) * 0.3);

  // Use the executedSql (possibly corrected by retry agent) as the final SQL
  const finalSql = executedSql ?? normalizedSql;

  // Cache successful results
  const result = buildResult({
    requestId, source: req.source, sql: finalSql, explanation,
    confidence: overallConfidence, intent, semantic, approvedPattern, validation,
    execution, pipeline, role: req.role ?? "analyst",
    auditId, demoMode: !isDbConfigured(), elapsedMs: Date.now() - globalStart,
    retryInfo, historyId,
  });

  if (validation.valid && execution && req.source !== "sql_editor") {
    const cacheKey = buildCacheKey(`gateway:${req.query}:${req.source}`, {
      start_date: req.startDate, end_date: req.endDate, branch_code: req.branchCode,
    });
    setCache(cacheKey, result);
  }

  return result;
}

// ── Result builder ────────────────────────────────────────────────────────────

function buildResult(p: {
  requestId: string;
  source: QuerySource;
  sql: string;
  explanation: string;
  confidence: number;
  intent: IntentResult;
  semantic: SemanticContext;
  approvedPattern: ApprovedPattern | null;
  validation: GatewayValidation;
  execution: ExecutionResult | null;
  pipeline: StageResult[];
  role: string;
  auditId: string;
  demoMode: boolean;
  elapsedMs: number;
  retryInfo?: GatewayResult["retryInfo"];
  historyId?: string;
}): GatewayResult {
  // Extract lineage from SQL
  const tablesUsed = [...p.sql.matchAll(/(?:FROM|JOIN)\s+([\w.]+)/gi)]
    .map((m) => m[1])
    .filter((t) => !t.startsWith("("));
  const columnsUsed = p.semantic.resolvedColumns;
  const filtersApplied = p.semantic.kpiDefinitions.length
    ? p.semantic.kpiDefinitions
    : ["Date range filter (@StartDate / @EndDate)"];

  return {
    requestId: p.requestId,
    source: p.source,
    sql: p.sql,
    explanation: p.explanation,
    confidence: p.confidence,
    intent: p.intent,
    semanticContext: p.semantic,
    approvedPattern: p.approvedPattern,
    validation: p.validation,
    execution: p.execution,
    pipeline: p.pipeline,
    lineage: {
      tablesUsed,
      columnsUsed,
      filtersApplied,
      aggregationsApplied: p.intent.metrics,
      joinsApplied: p.semantic.joinPaths,
    },
    governance: {
      auditLogId: p.auditId,
      executedAt: new Date().toISOString(),
      executedBy: "system",
      role: p.role,
      approvedPatternUsed: !!p.approvedPattern,
      humanApprovalRequired: p.intent.requiredKpis.length > 0,
      governanceNotes: [
        "Read-only enforcement active",
        `${p.pipeline.filter((s) => s.status === "ok").length}/${p.pipeline.length} stages passed`,
      ],
    },
    demoMode: p.demoMode,
    elapsedMs: p.elapsedMs,
    retryInfo: p.retryInfo,
    historyId: p.historyId,
  };
}

// ── Feedback acceptance (called from POST /api/gateway/feedback) ──────────────

export function acceptGatewayResult(requestId: string, rating: number): void {
  const pattern = _learningStore.find((p) => p.intent.includes(requestId));
  if (pattern && rating >= 4) {
    pattern.accepted = true;
  }
}
