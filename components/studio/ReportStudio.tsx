"use client";

import { useState, useEffect, useRef } from "react";
import { Bookmark, Check, Loader2, X, AlertTriangle, GitMerge, Wand2, MessageSquareWarning } from "lucide-react";
import { AskAI } from "./AskAI";
import { SQLEditor } from "./SQLEditor";
import { QueryExplanation } from "./QueryExplanation";
import { ResultsTable } from "./ResultsTable";
import { PostQueryAnalytics } from "./PostQueryAnalytics";
import { SemanticQueryPanel } from "./SemanticQueryPanel";
import { SavedReports } from "./SavedReports";
import { VisualQueryBuilder } from "./VisualQueryBuilder";
import { ResultRecoveryPanel } from "./ResultRecoveryPanel";
import type { QueryPlan } from "./AskAI";
import type { ReportResult } from "./ResultsTable";
import { fetchWithTimeout, requestErrorMessage } from "@/lib/client/fetchWithTimeout";

type StudioTab = "ask" | "semantic" | "builder" | "saved";

export interface LoadedReport {
  sql: string;
  prompt: string;
  kpi: string;
  name: string;
}

interface ReportStudioProps {
  initialReport?:  LoadedReport | null;
  initialTab?:     StudioTab;
  onNavigate?:     (view: string) => void;
}

export function ReportStudio({ initialReport, initialTab, onNavigate }: ReportStudioProps) {
  const [tab, setTab] = useState<StudioTab>(initialTab ?? "ask");
  // Lazy initializers — safe in a client component; avoids SSR/client mismatch
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  // SQL Editor state — pre-populate from initialReport if provided
  const [sql, setSql] = useState(initialReport?.sql ?? "");
  const [sqlDirty, setSqlDirty] = useState(false);   // user has edited beyond the AI-generated version
  const [sqlLocked, setSqlLocked] = useState(false);  // editor is locked — AI cannot overwrite
  // When the AI wants to overwrite a user-edited query, we surface this banner instead
  const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);
  const sqlEditorRef = useRef<HTMLDivElement>(null);
  const [currentPlan, setCurrentPlan] = useState<QueryPlan | null>(
    initialReport
      ? {
          sql: initialReport.sql,
          explanation: `Loaded: "${initialReport.name}". Prompt: "${initialReport.prompt}"`,
          tables_used: [],
          filters_applied: [],
          kpi_detected: initialReport.kpi,
          strategy: "sql",
          api_fallback_reason: null,
          cost_warning: null,
          optimized_suggestion: null,
        }
      : null
  );
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [autoFixing, setAutoFixing] = useState(false);
  const executionRequestRef = useRef<{ controller: AbortController; id: number; key: string } | null>(null);
  const executionRequestIdRef = useRef(0);
  const autoFixRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const autoFixRequestIdRef = useRef(0);
  // Set when the server rewrote hardcoded date literals to @StartDate/@EndDate
  const [dateLinkNote, setDateLinkNote] = useState(false);

  // Save state
  const [pendingSave, setPendingSave] = useState<{
    name: string;
    sql: string;
    prompt: string;
    kpi: string;
  } | null>(null);

  // Inline save modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalName, setSaveModalName] = useState("");
  const [saveModalDesc, setSaveModalDesc] = useState("");
  const [saveModalSaving, setSaveModalSaving] = useState(false);
  const [saveModalDone, setSaveModalDone] = useState(false);
  const saveNameRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      executionRequestRef.current?.controller.abort();
      autoFixRequestRef.current?.controller.abort();
    },
    []
  );

  // Respond to parent navigation while this component is already mounted
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Sync when an external saved report is pushed in after initial render
  useEffect(() => {
    if (!initialReport) return;
    setSql(initialReport.sql);
    setSqlDirty(false);
    setPendingOverwrite(null);
    setCurrentPlan({
      sql: initialReport.sql,
      explanation: `Loaded: "${initialReport.name}". Prompt: "${initialReport.prompt}"`,
      tables_used: [],
      filters_applied: [],
      kpi_detected: initialReport.kpi,
      strategy: "sql",
      api_fallback_reason: null,
      cost_warning: null,
      optimized_suggestion: null,
    });
    setResult(null);
    setExecError(null);
    setTab("ask");
  }, [initialReport]);

  function handlePlanReady(plan: QueryPlan, sd: string, ed: string) {
    setCurrentPlan(plan);
    setStartDate(sd);
    setEndDate(ed);
    setResult(null);
    setExecError(null);

    // If editor is locked or user has made edits, show the overwrite banner instead
    if ((sqlLocked || sqlDirty) && sql.trim() && sql.trim() !== plan.sql.trim()) {
      setPendingOverwrite(plan.sql);
      return;
    }
    setSql(plan.sql);
    setSqlDirty(false);
    setPendingOverwrite(null);
    // Scroll the SQL editor into view so the lock button and generated query are visible
    setTimeout(() => sqlEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function handleSqlChange(newSql: string) {
    setSql(newSql);
    setSqlDirty(true);
  }

  function acceptOverwrite() {
    if (pendingOverwrite) {
      setSql(pendingOverwrite);
      setSqlDirty(false);
    }
    setPendingOverwrite(null);
    setSqlLocked(false);
  }

  function rejectOverwrite() {
    setPendingOverwrite(null);
  }

  async function executeSQL(overrideSql?: string, sd?: string, ed?: string) {
    const runSql = (overrideSql ?? sql).trim();
    if (!runSql) return;

    const effectiveStartDate = sd ?? startDate;
    const effectiveEndDate = ed ?? endDate;
    const requestKey = JSON.stringify([runSql, effectiveStartDate, effectiveEndDate]);
    if (executionRequestRef.current?.key === requestKey) return;

    executionRequestRef.current?.controller.abort(new DOMException("Superseded by newer query", "AbortError"));
    const controller = new AbortController();
    const requestId = ++executionRequestIdRef.current;
    executionRequestRef.current = { controller, id: requestId, key: requestKey };
    setExecuting(true);
    setExecError(null);
    setResult(null);
    setDateLinkNote(false);

    try {
      const res = await fetchWithTimeout("/api/run-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql: runSql,
          start_date: effectiveStartDate,
          end_date: effectiveEndDate,
          report_name: currentPlan?.kpi_detected
            ? `${currentPlan.kpi_detected} Report`
            : "Custom Query",
          // Pass the original prompt so the correction loop has context
          original_prompt: currentPlan?.explanation ?? "",
        }),
        signal: controller.signal,
        timeoutMs: 25_000,
      });
      const json = await res.json().catch(() => ({}));
      if (executionRequestRef.current?.id !== requestId) return;
      if (!res.ok) {
        setExecError(json.error ?? "Execution failed");
        return;
      }
      // If the server linked hardcoded dates to the pickers, reflect the
      // rewritten SQL in the editor and let the user know.
      if (json.date_params_applied && typeof json.executed_sql === "string") {
        setSql(json.executed_sql);
        setDateLinkNote(true);
      }
      // If the self-healing correction loop was used, surface it in the plan meta
      if (json.correction_applied && currentPlan) {
        setCurrentPlan((prev) =>
          prev
            ? {
                ...prev,
                correction_applied: true,
                correction_attempts: json.correction_attempts ?? 1,
                // Update SQL to the corrected version
                sql: json.executed_sql ?? prev.sql,
              }
            : prev
        );
        if (typeof json.executed_sql === "string") {
          setSql(json.executed_sql);
        }
      }
      // Normalize the gateway response into the ReportResult shape expected by ResultsTable.
      // The gateway returns { rows, columns, rowCount, ... } but ResultsTable expects
      // { data, summary: { columns, row_count }, ... }.
      const rows: Record<string, unknown>[] = json.rows ?? json.data ?? [];
      const cols: string[] = json.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
      const normalized: ReportResult = {
        report_name: currentPlan?.kpi_detected
          ? `${currentPlan.kpi_detected} Report`
          : "Custom Query",
        generated_at: new Date().toISOString(),
        kpi: currentPlan?.kpi_detected ?? "custom",
        sql_used: json.executed_sql ?? sql,
        data: rows,
        result_sets: Array.isArray(json.resultSets) ? json.resultSets : undefined,
        summary: {
          row_count: json.rowCount ?? rows.length,
          columns: cols,
          aggregates: undefined,
        },
        cache_hit: json.cache_hit ?? false,
        demo_mode: json.demo_mode ?? false,
        execution_ms: json.execution_ms,
      };
      setResult(normalized);
    } catch (e) {
      if (executionRequestRef.current?.id !== requestId || controller.signal.aborted) return;
      setExecError(
        requestErrorMessage(
          e,
          "Query execution took too long. Narrow the date range or simplify the SQL."
        )
      );
    } finally {
      if (executionRequestRef.current?.id === requestId) {
        executionRequestRef.current = null;
        setExecuting(false);
      }
    }
  }

  function cancelExecution() {
    executionRequestRef.current?.controller.abort(new DOMException("Cancelled by user", "AbortError"));
    executionRequestRef.current = null;
    setExecuting(false);
  }

  async function autoFixSQL() {
    if (!sql.trim() || !execError) return;

    autoFixRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++autoFixRequestIdRef.current;
    autoFixRequestRef.current = { controller, id: requestId };
    setAutoFixing(true);
    try {
      const res = await fetchWithTimeout("/api/generate-query/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrompt: currentPlan?.explanation ?? "Repair this reporting query",
          failedSQL: sql,
          errorMessage: execError,
          startDate,
          endDate,
        }),
        signal: controller.signal,
        timeoutMs: 60_000,
      });
      const json = await res.json().catch(() => ({}));
      if (autoFixRequestRef.current?.id !== requestId) return;
      const correctedPlan = json.correctedPlan as QueryPlan | undefined;
      if (res.ok && json.succeeded && correctedPlan?.sql) {
        setSql(correctedPlan.sql);
        setSqlDirty(false);
        setExecError(null);
        setCurrentPlan({ ...correctedPlan, correction_applied: true });
      } else {
        setExecError(
          json.finalError ?? json.error ?? "AI could not verify a safe repair. Edit the SQL or retry."
        );
      }
    } catch (error) {
      if (autoFixRequestRef.current?.id !== requestId || controller.signal.aborted) return;
      setExecError(
        requestErrorMessage(error, "AI repair took too long. Edit the SQL or retry.")
      );
    } finally {
      if (autoFixRequestRef.current?.id === requestId) {
        autoFixRequestRef.current = null;
        setAutoFixing(false);
      }
    }
  }

  function handleLoadSaved(report: { sql: string; prompt: string; kpi: string; name: string }) {
    setSql(report.sql);
    setSqlDirty(false);
    setPendingOverwrite(null);
    setCurrentPlan({
      sql: report.sql,
      explanation: `Loaded saved report: ${report.name}. Prompt: "${report.prompt}"`,
      tables_used: [],
      filters_applied: [],
      kpi_detected: report.kpi,
      strategy: "sql",
      api_fallback_reason: null,
      cost_warning: null,
      optimized_suggestion: null,
    });
    setResult(null);
    setExecError(null);
    setTab("ask");
  }

  function triggerSave() {
    if (!sql.trim()) return;
    setPendingSave({
      name: currentPlan?.kpi_detected
        ? `${currentPlan.kpi_detected} Report`
        : "Custom Report",
      sql,
      prompt: currentPlan?.explanation ?? "",
      kpi: currentPlan?.kpi_detected ?? "custom",
    });
    setTab("saved");
  }

  function openSaveModal() {
    if (!sql.trim()) return;
    setSaveModalName(
      currentPlan?.kpi_detected ? `${currentPlan.kpi_detected} Report` : "Custom Report"
    );
    setSaveModalDesc("");
    setSaveModalDone(false);
    setShowSaveModal(true);
    setTimeout(() => saveNameRef.current?.focus(), 50);
  }

  async function submitSaveModal() {
    if (!saveModalName.trim() || saveModalSaving) return;
    setSaveModalSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveModalName.trim(),
          description: saveModalDesc.trim(),
          prompt: currentPlan?.explanation ?? "",
          sql,
          kpi: currentPlan?.kpi_detected ?? "custom",
          tags: currentPlan?.kpi_detected ? [currentPlan.kpi_detected] : [],
          created_by: "analyst",
        }),
      });
      if (res.ok) {
        setSaveModalDone(true);
        setTimeout(() => setShowSaveModal(false), 1400);
      }
    } finally {
      setSaveModalSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit border border-border">
        {(
          [
            { id: "ask", label: "Ask AI / SQL" },
            { id: "semantic", label: "Semantic Engine" },
            { id: "builder", label: "Visual Builder" },
            { id: "saved", label: "Saved Reports" },
          ] as { id: StudioTab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === id
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ask" && (
        <div className="flex flex-col gap-6">
          {/* Ask AI panel */}
          <div className="bg-card border border-border rounded-lg p-5">
            <AskAI
              onPlanReady={handlePlanReady}
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />
          </div>

          {/* SQL Editor — always visible once a plan exists */}
          {(sql || currentPlan) && (
            <div ref={sqlEditorRef} className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
              {/* AI overwrite pending banner */}
              {pendingOverwrite && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-chart-4/10 border border-chart-4/30">
                  <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 shrink-0" />
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="text-xs font-semibold text-foreground">
                      AI generated a new query
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Your current SQL has edits. Accept the AI&apos;s version or keep yours.
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={acceptOverwrite}
                        className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <GitMerge className="w-3 h-3" />
                        Accept AI version
                      </button>
                      <button
                        onClick={rejectOverwrite}
                        className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                      >
                        Keep mine
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <SQLEditor
                sql={sql}
                onChange={handleSqlChange}
  onRun={() => executeSQL()}
  onCancel={cancelExecution}
  loading={executing}
                startDate={startDate}
                endDate={endDate}
                locked={sqlLocked}
                onToggleLock={setSqlLocked}
                dirty={sqlDirty}
              />
              {dateLinkNote && (
                <p className="mt-3 text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-chart-1 mt-px shrink-0" />
                  <span>
                    Linked the hardcoded dates in this query to your date pickers — they now use{" "}
                    <code className="font-mono text-primary">@StartDate</code> and{" "}
                    <code className="font-mono text-primary">@EndDate</code>, so changing the range
                    above updates the results.
                  </span>
                </p>
              )}
            </div>
          )}

          {/* SQL Feedback dialogue */}
          {execError && (
            <div className="flex flex-col gap-3 bg-destructive/8 border border-destructive/30 rounded-lg p-4">
              {/* Header */}
              <div className="flex items-start gap-2.5">
                <MessageSquareWarning className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-destructive">SQL execution failed</p>
                  <p className="text-xs text-destructive/80 mt-1 font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {execError}
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-destructive/15" />

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={autoFixSQL}
                  disabled={autoFixing}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-medium"
                >
                  {autoFixing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wand2 className="w-3 h-3" />
                  )}
                  {autoFixing ? "Fixing..." : "Fix with AI"}
                </button>
                <p className="text-[11px] text-muted-foreground">
                  AI will rewrite the query to correct this error automatically.
                </p>
              </div>

              {currentPlan && !autoFixing && (
                <p className="text-[11px] text-muted-foreground/70">
                  Tip: You can also edit the SQL directly above or rephrase your prompt to regenerate.
                </p>
              )}
            </div>
          )}

          {/* Query Explanation */}
          {currentPlan && <QueryExplanation plan={currentPlan} />}

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-3">
        <ResultsTable result={result} />

        {result.summary.row_count === 0 && (
          <ResultRecoveryPanel
            onRecover={async () => {
              const recoveredStart = new Date(`${startDate}T00:00:00`);
              recoveredStart.setFullYear(recoveredStart.getFullYear() - 1);
              await executeSQL(sql, recoveredStart.toISOString().slice(0, 10), endDate);
            }}
          />
        )}

        {/* Post-Query Analytics Engine */}
              <PostQueryAnalytics result={result} />

              {/* Save button */}
              <button
                onClick={openSaveModal}
                className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border hover:border-primary/40"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save this report
              </button>
            </div>
          )}

          {/* Inline save modal */}
          {showSaveModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4">
                {saveModalDone ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-10 h-10 rounded-full bg-chart-1/15 border border-chart-1/30 flex items-center justify-center">
                      <Check className="w-5 h-5 text-chart-1" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Report saved</p>
                    <p className="text-xs text-muted-foreground text-center">
                      &ldquo;{saveModalName}&rdquo; has been added to your Saved Reports.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bookmark className="w-4 h-4 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">Save Report</h3>
                      </div>
                      <button
                        onClick={() => setShowSaveModal(false)}
                        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-foreground">Report name</label>
                        <input
                          ref={saveNameRef}
                          type="text"
                          value={saveModalName}
                          onChange={(e) => setSaveModalName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) submitSaveModal(); }}
                          placeholder="e.g. Monthly Admissions by Branch"
                          className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-foreground">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <input
                          type="text"
                          value={saveModalDesc}
                          onChange={(e) => setSaveModalDesc(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) submitSaveModal(); }}
                          placeholder="What does this report show?"
                          className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      {currentPlan?.kpi_detected && (
                        <p className="text-[11px] text-muted-foreground">
                          KPI: <span className="text-primary font-mono">{currentPlan.kpi_detected}</span>
                          {" "}&middot; tag will be added automatically
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={submitSaveModal}
                        disabled={saveModalSaving || !saveModalName.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saveModalSaving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Bookmark className="w-3.5 h-3.5" />
                        )}
                        Save
                      </button>
                      <button
                        onClick={() => setShowSaveModal(false)}
                        className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "builder" && (
        <div className="bg-card border border-border rounded-lg p-5">
          <VisualQueryBuilder
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onPlanReady={(plan, sd, ed) => {
              handlePlanReady(plan, sd, ed);
              setTab("ask");
              // Immediately generate the report so the builder produces results,
              // not just a query sitting in the editor.
              void executeSQL(plan.sql, sd, ed);
            }}
            loading={executing}
          />
        </div>
      )}

      {tab === "semantic" && (
        <div className="bg-card border border-border rounded-lg p-5">
          <SemanticQueryPanel
            startDate={startDate}
            endDate={endDate}
            onPlanReady={(plan) => {
              setSql(plan.sql);
              setCurrentPlan(plan);
              setTab("ask");
            }}
          />
        </div>
      )}

      {tab === "saved" && (
        <div className="bg-card border border-border rounded-lg p-5">
          <SavedReports
            onLoad={handleLoadSaved}
            pendingSave={pendingSave}
            onSaveDone={() => setPendingSave(null)}
            onInterpretKpi={
              onNavigate
                ? (kpi) => onNavigate(`kpi:interpret:${kpi}`)
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
