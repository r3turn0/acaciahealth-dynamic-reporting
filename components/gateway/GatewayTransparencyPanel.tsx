"use client";

/**
 * GatewayTransparencyPanel
 *
 * Displays the full 9-stage QueryGateway pipeline trace next to any query
 * result. Shows per-stage status, confidence scores, SQL, validation results,
 * data lineage, governance metadata, and feedback controls.
 *
 * Drop this beside any query result that returns a `gateway` property from
 * any of the gateway-backed API routes.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GatewayResult, StageResult } from "@/lib/gateway/QueryGateway";

// ── Stage metadata (display labels, descriptions) ────────────────────────────

const STAGE_META: Record<string, { label: string; description: string }> = {
  IntentAgent:                { label: "Intent Analysis",        description: "Classifies business intent, extracts entities, metrics, dimensions, and required KPIs." },
  SemanticSearchAgent:        { label: "Semantic Search",         description: "Resolves approved metadata catalog, KPI registry, business glossary, and join paths." },
  ApprovedPatternAgent:       { label: "Approved Pattern Lookup", description: "Searches the learning repository for pre-approved patterns (similarity ≥ 0.85 triggers reuse)." },
  SQLGeneratorAgent:          { label: "SQL Generation",          description: "Generates SQL only from approved metadata. Never hallucinating tables, columns, or KPIs." },
  SQLValidationAgent:         { label: "SQL Validation",          description: "Enforces read-only, schema, RBAC, RLS, PII, fan-out detection, and performance checks." },
  ExecutionEngine:            { label: "Execution Engine",        description: "Executes only validated SQL. Read-only mode. Audit-logged, 60s timeout, 100k row cap." },
  FeedbackAgent:              { label: "Feedback Capture",        description: "Captures user rating, acceptance, edits, runtime, and errors for quality tracking." },
  LearningRepository:         { label: "Learning Repository",     description: "Stores only validated and accepted queries. Never learns from failed or rejected SQL." },
  ContinuousImprovementAgent: { label: "Continuous Improvement",  description: "Promotes high-performing patterns. Cannot change KPI logic, schema, or business rules without governance approval." },
};

const STAGE_ORDER = Object.keys(STAGE_META);

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StageResult["status"] }) {
  const styles: Record<StageResult["status"], string> = {
    ok:       "bg-emerald-100 text-emerald-800 border border-emerald-200",
    skipped:  "bg-slate-100 text-slate-600 border border-slate-200",
    fallback: "bg-amber-100 text-amber-800 border border-amber-200",
    error:    "bg-red-100 text-red-700 border border-red-200",
  };
  const labels: Record<StageResult["status"], string> = {
    ok: "Passed", skipped: "Skipped", fallback: "Fallback", error: "Blocked",
  };
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", styles[status])}>
      {labels[status]}
    </span>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-600 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  result: Partial<GatewayResult> & {
    pipeline?: StageResult[];
    confidence?: number;
    sql?: string;
    explanation?: string;
    validation?: GatewayResult["validation"];
    lineage?: GatewayResult["lineage"];
    governance?: GatewayResult["governance"];
    intent?: GatewayResult["intent"];
    semanticContext?: GatewayResult["semanticContext"];
    approvedPattern?: GatewayResult["approvedPattern"];
    requestId?: string;
    demoMode?: boolean;
  };
  defaultOpen?: boolean;
  className?: string;
}

type Tab = "pipeline" | "sql" | "validation" | "lineage" | "governance" | "feedback";

export function GatewayTransparencyPanel({ result, defaultOpen = false, className }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<Tab>("pipeline");
  const [rating, setRating] = useState(0);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const pipeline = result.pipeline ?? [];
  const passedCount = pipeline.filter((s) => s.status === "ok").length;
  const hasErrors = pipeline.some((s) => s.status === "error") || !(result.validation?.valid ?? true);

  async function submitFeedback(accepted: boolean) {
    if (!result.requestId || rating === 0) return;
    try {
      await fetch("/api/gateway/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: result.requestId,
          rating,
          accepted,
        }),
      });
      setFeedbackSent(true);
    } catch {
      // Silent — feedback is non-blocking
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline",   label: "Pipeline" },
    { id: "sql",        label: "SQL" },
    { id: "validation", label: "Validation" },
    { id: "lineage",    label: "Lineage" },
    { id: "governance", label: "Governance" },
    { id: "feedback",   label: "Feedback" },
  ];

  return (
    <div className={cn("border border-slate-200 rounded-lg bg-white overflow-hidden", className)}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        aria-expanded={open}
        aria-controls="gateway-panel-body"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Query Gateway
          </span>
          {result.demoMode && (
            <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
              Demo
            </span>
          )}
          {result.approvedPattern && (
            <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
              Approved Pattern
            </span>
          )}
          {hasErrors ? (
            <span className="text-xs bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium">
              Blocked
            </span>
          ) : (
            <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
              {passedCount}/{Math.max(pipeline.length, STAGE_ORDER.length)} stages
            </span>
          )}
          {typeof result.confidence === "number" && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>Confidence</span>
              <ConfidenceBar value={result.confidence} />
            </div>
          )}
        </div>
        <svg
          className={cn("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {open && (
        <div id="gateway-panel-body">
          {/* Tab bar */}
          <div className="flex border-b border-slate-200 bg-white px-4 gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "text-xs font-medium px-3 py-2.5 border-b-2 transition-colors whitespace-nowrap",
                  activeTab === t.id
                    ? "border-slate-800 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">

            {/* ── Pipeline tab ─────────────────────────────────────────── */}
            {activeTab === "pipeline" && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 mb-3">
                  Every request passes through all 9 mandatory stages. No SQL execution
                  is permitted until all stages succeed.
                </p>
                {STAGE_ORDER.map((stageName, idx) => {
                  const stageResult = pipeline.find((s) => s.stage === stageName);
                  const meta = STAGE_META[stageName];
                  return (
                    <div key={stageName} className="flex gap-3 items-start">
                      <div className="flex flex-col items-center">
                        <div
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border",
                            stageResult?.status === "ok"       && "bg-emerald-100 text-emerald-800 border-emerald-300",
                            stageResult?.status === "skipped"  && "bg-slate-100 text-slate-500 border-slate-300",
                            stageResult?.status === "fallback" && "bg-amber-100 text-amber-800 border-amber-300",
                            stageResult?.status === "error"    && "bg-red-100 text-red-700 border-red-300",
                            !stageResult                       && "bg-slate-100 text-slate-400 border-slate-200",
                          )}
                        >
                          {idx + 1}
                        </div>
                        {idx < STAGE_ORDER.length - 1 && (
                          <div className="w-px flex-1 min-h-4 bg-slate-200 mt-1" />
                        )}
                      </div>
                      <div className="flex-1 pb-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-800">{meta.label}</span>
                          {stageResult ? (
                            <div className="flex items-center gap-2">
                              <StatusBadge status={stageResult.status} />
                              <span className="text-xs text-slate-400 font-mono">
                                {stageResult.durationMs}ms
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Not run</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                        {stageResult?.note && (
                          <p className="text-xs text-slate-600 mt-1 bg-slate-50 border border-slate-100 rounded px-2 py-1 font-mono">
                            {stageResult.note}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SQL tab ───────────────────────────────────────────────── */}
            {activeTab === "sql" && (
              <div className="space-y-3">
                {result.explanation && (
                  <div className="text-sm text-slate-700 bg-blue-50 border border-blue-100 rounded p-3">
                    <span className="font-medium text-blue-800">Explanation: </span>
                    {result.explanation}
                  </div>
                )}
                {result.intent && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 border border-slate-100 rounded p-2">
                      <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold block mb-1">Intent Type</span>
                      <span className="font-mono text-slate-800">{result.intent.type}</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded p-2">
                      <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold block mb-1">Confidence</span>
                      <ConfidenceBar value={result.intent.confidence} />
                    </div>
                    {result.intent.requiredKpis.length > 0 && (
                      <div className="col-span-2 bg-slate-50 border border-slate-100 rounded p-2">
                        <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold block mb-1">KPIs Detected</span>
                        <div className="flex flex-wrap gap-1">
                          {result.intent.requiredKpis.map((k) => (
                            <span key={k} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5 font-mono text-slate-700">{k}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {result.approvedPattern && (
                  <div className="bg-blue-50 border border-blue-100 rounded p-3 text-xs">
                    <span className="font-semibold text-blue-800">Approved Pattern Used — </span>
                    <span className="text-blue-700">
                      Similarity {(result.approvedPattern.similarity * 100).toFixed(1)}% to stored pattern
                      (used {result.approvedPattern.usageCount}x).
                    </span>
                  </div>
                )}
                {result.sql && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Generated SQL</div>
                    <pre className="bg-slate-900 text-emerald-300 rounded p-3 overflow-x-auto text-xs font-mono whitespace-pre-wrap break-words">
                      {result.sql}
                    </pre>
                  </div>
                )}
                {result.semanticContext && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Approved Metadata Sources</div>
                    <div className="flex flex-wrap gap-1">
                      {result.semanticContext.approvedMetadataSources.map((s) => (
                        <span key={s} className="text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded px-2 py-0.5">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Validation tab ────────────────────────────────────────── */}
            {activeTab === "validation" && result.validation && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-semibold",
                    result.validation.valid ? "text-emerald-700" : "text-red-700"
                  )}>
                    {result.validation.valid ? "Validation Passed" : "Validation Failed"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "Read-Only Enforced",  value: result.validation.readOnlyEnforced },
                    { label: "Schema Validated",    value: result.validation.schemaValidated },
                    { label: "RBAC Passed",         value: result.validation.rbacPassed },
                    { label: "PII Safe",            value: result.validation.piiSafe },
                    { label: "Performance Safe",    value: result.validation.performanceSafe },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded px-3 py-2">
                      <span className="text-slate-600">{label}</span>
                      <span className={value ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {value ? "Pass" : "Fail"}
                      </span>
                    </div>
                  ))}
                </div>
                {result.validation.errors.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">Errors</div>
                    <ul className="space-y-1">
                      {result.validation.errors.map((e, i) => (
                        <li key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-1.5">{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.validation.warnings.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1">Warnings</div>
                    <ul className="space-y-1">
                      {result.validation.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-1.5">{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Lineage tab ───────────────────────────────────────────── */}
            {activeTab === "lineage" && result.lineage && (
              <div className="space-y-3 text-xs">
                {[
                  { label: "Tables Used",           items: result.lineage.tablesUsed },
                  { label: "Columns Resolved",      items: result.lineage.columnsUsed },
                  { label: "Filters Applied",        items: result.lineage.filtersApplied },
                  { label: "Aggregations Applied",   items: result.lineage.aggregationsApplied },
                  { label: "Joins Applied",          items: result.lineage.joinsApplied },
                ].map(({ label, items }) =>
                  items.length > 0 ? (
                    <div key={label}>
                      <div className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] mb-1">{label}</div>
                      <div className="flex flex-wrap gap-1">
                        {items.map((item, i) => (
                          <span key={i} className="bg-slate-100 border border-slate-200 text-slate-700 rounded px-2 py-0.5 font-mono">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
                {result.semanticContext?.dataLineage && result.semanticContext.dataLineage.length > 0 && (
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] mb-1">Data Lineage</div>
                    <div className="flex flex-wrap gap-1">
                      {result.semanticContext.dataLineage.map((l, i) => (
                        <span key={i} className="bg-blue-50 border border-blue-100 text-blue-700 rounded px-2 py-0.5">{l}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Governance tab ────────────────────────────────────────── */}
            {activeTab === "governance" && result.governance && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Audit Log ID",         value: result.governance.auditLogId },
                    { label: "Executed At",          value: new Date(result.governance.executedAt).toLocaleString() },
                    { label: "Role",                 value: result.governance.role },
                    { label: "Request ID",           value: result.requestId ?? "—" },
                    { label: "Approved Pattern",     value: result.governance.approvedPatternUsed ? "Yes" : "No" },
                    { label: "Human Approval Req.",  value: result.governance.humanApprovalRequired ? "Yes" : "No" },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 border border-slate-100 rounded px-3 py-2">
                      <div className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">{label}</div>
                      <div className="text-slate-700 font-mono break-all">{value}</div>
                    </div>
                  ))}
                </div>
                {result.governance.governanceNotes.length > 0 && (
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] mb-1">Governance Notes</div>
                    <ul className="space-y-1">
                      {result.governance.governanceNotes.map((n, i) => (
                        <li key={i} className="text-slate-600 bg-slate-50 border border-slate-100 rounded px-3 py-1.5">{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Feedback tab ──────────────────────────────────────────── */}
            {activeTab === "feedback" && (
              <div className="space-y-4">
                {feedbackSent ? (
                  <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded p-3 text-center">
                    Feedback recorded. Thank you.
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">
                      Your feedback helps the Learning Repository promote high-quality patterns.
                      Only accepted, high-rated queries are stored.
                    </p>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 mb-2">Rate this result</div>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            onClick={() => setRating(n)}
                            className={cn(
                              "w-9 h-9 rounded-lg border text-sm font-semibold transition-all",
                              rating >= n
                                ? "bg-slate-800 text-white border-slate-800"
                                : "bg-white text-slate-400 border-slate-200 hover:border-slate-400"
                            )}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        1 = Incorrect result &nbsp;·&nbsp; 5 = Perfect
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitFeedback(true)}
                        disabled={rating === 0}
                        className="flex-1 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Accept result
                      </button>
                      <button
                        onClick={() => submitFeedback(false)}
                        disabled={rating === 0}
                        className="flex-1 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-slate-200"
                      >
                        Reject result
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
