"use client";

import { useState, useRef, useEffect } from "react";
import {
  Cpu,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Play,
  RotateCcw,
  Layers,
  ArrowRight,
  Info,
} from "lucide-react";
import type { SemanticResponse, LogicalPlan, IntentType } from "@/lib/agents/semanticQueryEngine";
import type { QueryPlan } from "./AskAI";
import { recordQuery } from "@/lib/agents/queryLearner";

// ── Constants ─────────────────────────────────────────────────────────────────

const INTENT_COLORS: Record<IntentType, string> = {
  DATA_QUERY:   "text-chart-1 bg-chart-1/10 border-chart-1/25",
  AGGREGATION:  "text-chart-2 bg-chart-2/10 border-chart-2/25",
  SUMMARY:      "text-chart-3 bg-chart-3/10 border-chart-3/25",
  TREND:        "text-chart-1 bg-chart-1/10 border-chart-1/25",
  COMPARISON:   "text-chart-4 bg-chart-4/10 border-chart-4/25",
  TOP_N:        "text-primary bg-primary/10 border-primary/25",
  RANKING:      "text-primary bg-primary/10 border-primary/25",
  CLARIFICATION:"text-chart-5 bg-chart-5/10 border-chart-5/25",
};

const STAGE_LABELS: Record<string, string> = {
  interpret_query:        "Interpret Query",
  resolve_context:        "Resolve Context",
  classify_intent:        "Classify Intent",
  validate_against_schema:"Validate Schema",
  detect_ambiguity:       "Detect Ambiguity",
  generate_logical_plan:  "Generate Plan",
  format_response:        "Format Response",
};

const EXAMPLE_QUERIES = [
  "LUPA rate by branch last 30 days",
  "Admissions trend by SOC month for Q1 2026",
  "Average visits per PDGM period by discipline",
  "Which branch had the highest census this week?",
  "HH-CAHPS scores compared to national benchmark",
  "Revenue by PDGM period — routine vs. hospice",
  "Top 10 diagnoses by ICD code this quarter",
  "OASIS completion rate by clinician",
  "Claim submission lag by branch last 90 days",
  "Patients with more than 8 skilled nurse visits per episode",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal QueryPlan shell from a SemanticResponse so it can be sent to the SQL editor */
function semanticToQueryPlan(res: SemanticResponse): QueryPlan {
  const plan = res.logicalPlan;
  const selects = [
    ...(plan?.select ?? []),
    ...(plan?.aggregations?.map((a) => a.alias ?? a.metric) ?? []),
  ];
  const groupBy = plan?.groupBy ?? [];
  const orderBy = plan?.orderBy ?? [];
  const limit   = plan?.limit ?? 100;

  const selectClause  = selects.length ? selects.join(", ") : "*";
  const groupClause   = groupBy.length ? `\nGROUP BY ${groupBy.join(", ")}` : "";
  const orderClause   = orderBy.length
    ? `\nORDER BY ${orderBy.map((o) => `${o.field} ${o.direction}`).join(", ")}`
    : "";
  const whereClause   = "\nWHERE epi_SocDate BETWEEN @StartDate AND @EndDate";

  const sql = `SELECT TOP ${limit}
  ${selectClause}
FROM ${plan?.table ?? "CLIENT_EPISODES_ALL"}${whereClause}${groupClause}${orderClause}`;

  return {
    sql,
    explanation: res.resolvedQuery,
    tables_used: [plan?.table ?? ""],
    filters_applied: res.context.filters,
    kpi_detected: null,
    strategy: "sql",
    api_fallback_reason: null,
    cost_warning: null,
    optimized_suggestion: null,
    ai_powered: true,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PipelineStepper({ stages }: { stages: SemanticResponse["pipelineStages"] }) {
  return (
    <div className="flex flex-col gap-0">
      {stages.map((s, i) => (
        <div key={s.stage} className="flex items-start gap-3">
          {/* connector line */}
          <div className="flex flex-col items-center shrink-0">
            <div
              className={[
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold",
                s.status === "ok"
                  ? "bg-chart-1/15 border-chart-1/30 text-chart-1"
                  : s.status === "ambiguous"
                  ? "bg-chart-5/15 border-chart-5/30 text-chart-5"
                  : "bg-muted border-border text-muted-foreground",
              ].join(" ")}
            >
              {s.status === "ok" ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : s.status === "ambiguous" ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className="w-px h-4 bg-border mt-0.5" />
            )}
          </div>
          {/* label */}
          <div className="pt-1 pb-4 flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground leading-none">
              {STAGE_LABELS[s.stage] ?? s.stage}
            </p>
            {s.note && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.note}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogicalPlanViewer({ plan }: { plan: LogicalPlan }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-0 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between px-4 py-3 bg-muted/60 hover:bg-muted transition-colors text-sm font-medium text-foreground"
      >
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Logical Plan
          <span className="text-[10px] text-muted-foreground font-normal">
            {plan.table} · {plan.select.length + plan.aggregations.length} fields · limit {plan.limit}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-0 divide-x divide-border border-t border-border">
          {/* Left: structured fields */}
          <div className="flex flex-col gap-3 p-4 text-xs">
            <PlanRow label="Table"   value={plan.table} />
            {plan.select.length > 0 && (
              <PlanRow label="Select" value={plan.select.join(", ")} />
            )}
            {plan.aggregations.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Aggregations</span>
                {plan.aggregations.map((a, i) => (
                  <span key={i} className="text-foreground font-mono text-[11px]">
                    {a.function}({a.metric}){a.alias ? ` AS ${a.alias}` : ""}
                  </span>
                ))}
              </div>
            )}
            {plan.groupBy.length > 0 && (
              <PlanRow label="Group By" value={plan.groupBy.join(", ")} />
            )}
            {plan.orderBy.length > 0 && (
              <PlanRow
                label="Order By"
                value={plan.orderBy.map((o) => `${o.field} ${o.direction}`).join(", ")}
              />
            )}
            <PlanRow label="Limit" value={String(plan.limit)} />
          </div>
          {/* Right: JSON */}
          <pre className="p-4 text-[10px] text-muted-foreground overflow-auto bg-muted/30 leading-relaxed whitespace-pre-wrap max-h-64 font-mono">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</span>
      <span className="text-foreground font-mono text-[11px] break-all">{value}</span>
    </div>
  );
}

function ClarificationCard({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
}) {
  const [custom, setCustom] = useState("");

  return (
    <div className="flex flex-col gap-3 bg-chart-5/8 border border-chart-5/25 rounded-lg p-4">
      <div className="flex items-start gap-2.5">
        <HelpCircle className="w-4 h-4 text-chart-5 shrink-0 mt-0.5" />
        <p className="text-sm text-foreground font-medium">{question}</p>
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => onAnswer(opt)}
              className="text-xs px-3 py-1.5 rounded-full border border-chart-5/30 bg-chart-5/10 text-chart-5 hover:bg-chart-5/20 transition-colors"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && custom.trim()) {
              onAnswer(custom.trim());
            }
          }}
          placeholder="Or type your answer..."
          className="flex-1 bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          disabled={!custom.trim()}
          onClick={() => custom.trim() && onAnswer(custom.trim())}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SemanticQueryPanelProps {
  onPlanReady?: (plan: QueryPlan) => void;
  startDate?: string;
  endDate?: string;
  branchCode?: string;
}

export function SemanticQueryPanel({
  onPlanReady,
  startDate,
  endDate,
  branchCode,
}: SemanticQueryPanelProps) {
  const [query, setQuery]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [response, setResponse]         = useState<SemanticResponse | null>(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [elapsed, setElapsed]           = useState<number | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [query]);

  async function run(overrideQuery?: string, extraAnswers?: Record<string, string>) {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/semantic/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          startDate,
          endDate,
          branchCode,
          clarificationAnswers: extraAnswers ?? clarificationAnswers,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Semantic pipeline failed");
        return;
      }
      const semanticRes = json as SemanticResponse;
      setResponse(semanticRes);
      setElapsed(json.elapsed_ms ?? null);
      setShowPipeline(true);

      // Record this successful query in the adaptive learner so future searches
      // can boost frequently-resolved tables and tags (client-side, sessionStorage only)
      if (semanticRes.intent?.type !== "CLARIFICATION") {
        const resolvedTableIds = semanticRes.context?.table
          ? [semanticRes.context.table]
          : (semanticRes.logicalPlan?.table ? [semanticRes.logicalPlan.table] : []);
        const resolvedTags = semanticRes.context?.metrics ?? [];
        recordQuery(q, resolvedTableIds, resolvedTags);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleClarificationAnswer(answer: string) {
    if (!response?.clarification) return;
    const next = { ...clarificationAnswers, [response.clarification.question]: answer };
    setClarificationAnswers(next);
    run(query, next);
  }

  function reset() {
    setQuery("");
    setResponse(null);
    setError(null);
    setElapsed(null);
    setClarificationAnswers({});
    setShowPipeline(false);
  }

  const isClarification = response?.intent?.type === "CLARIFICATION";

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
          <Cpu className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Semantic Query Engine</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
          7-Stage Pipeline
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="w-3 h-3" />
          Schema-grounded · No SQL required
        </div>
      </div>

      {/* Input */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={2}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                run();
              }
            }}
            placeholder='Ask a data question, e.g. "Top 5 nurses by patient count"'
            className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed pr-32"
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {response && (
              <button
                onClick={reset}
                className="p-1.5 rounded hover:bg-muted-foreground/20 transition-colors text-muted-foreground"
                title="Reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => run()}
              disabled={loading || !query.trim()}
              className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {loading ? "Running..." : "Run"}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/60">Ctrl+Enter to run</p>
      </div>

      {/* Example chips */}
      {!response && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground font-medium">Example queries</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => { setQuery(q); }}
                className="text-[11px] px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Pipeline error</p>
            <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Response */}
      {response && !loading && (
        <div className="flex flex-col gap-4">

          {/* Intent + meta row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={[
              "text-[11px] px-2.5 py-1 rounded-full border font-medium",
              INTENT_COLORS[response.intent.type],
            ].join(" ")}>
              {response.intent.type}
              {response.intent.operation ? ` · ${response.intent.operation}` : ""}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted text-muted-foreground">
              {response.response.type}
            </span>
            {response.logicalPlan && (
              <span className="text-[11px] text-muted-foreground">
                {response.logicalPlan.table}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              confidence {Math.round(response.metadata.confidence * 100)}%
              {elapsed ? ` · ${elapsed}ms` : ""}
            </span>
          </div>

          {/* Resolved query */}
          <div className="flex items-start gap-2 bg-muted/50 rounded-lg px-3 py-2.5 border border-border">
            <ArrowRight className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-foreground italic">&ldquo;{response.resolvedQuery}&rdquo;</p>
          </div>

          {/* Clarification */}
          {isClarification && response.clarification && (
            <ClarificationCard
              question={response.clarification.question}
              options={response.clarification.options}
              onAnswer={handleClarificationAnswer}
            />
          )}

          {/* Logical plan */}
          {response.logicalPlan && (
            <LogicalPlanViewer plan={response.logicalPlan} />
          )}

          {/* Context summary */}
          <div className="grid grid-cols-3 gap-3">
            <ContextCard label="Table"      items={[response.context.table]} />
            <ContextCard label="Dimensions" items={response.context.dimensions} />
            <ContextCard label="Metrics"    items={response.context.metrics} />
          </div>

          {/* Warnings */}
          {response.metadata.warnings?.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-chart-5/8 border border-chart-5/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-5 shrink-0 mt-0.5" />
              <p className="text-xs text-chart-5">{w}</p>
            </div>
          ))}

          {/* Pipeline trace */}
          <div className="flex flex-col gap-0 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setShowPipeline((v) => !v)}
              className="flex items-center justify-between px-4 py-3 bg-muted/60 hover:bg-muted transition-colors text-sm font-medium text-foreground"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary" />
                Pipeline Trace
                <span className="text-[10px] text-muted-foreground font-normal">
                  {response.pipelineStages.filter((s) => s.status === "ok").length}/{response.pipelineStages.length} stages passed
                </span>
              </div>
              {showPipeline
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showPipeline && (
              <div className="px-4 py-4 border-t border-border">
                <PipelineStepper stages={response.pipelineStages} />
              </div>
            )}
          </div>

          {/* Send to Editor button — sends the logical plan to the SQL editor without immediately running */}
          {response.logicalPlan && onPlanReady && !isClarification && (
            <button
              onClick={() => onPlanReady(semanticToQueryPlan(response))}
              className="self-start flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Send to Editor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ContextCard({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5 bg-muted/40 border border-border rounded-lg p-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</span>
      {items.length > 0 ? (
        items.map((item) => (
          <span key={item} className="text-xs text-foreground font-mono truncate">{item}</span>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}
