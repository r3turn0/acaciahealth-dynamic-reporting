"use client";

import { useState, useEffect, useRef } from "react";
import { Bookmark, Check, Loader2, X } from "lucide-react";
import { AskAI } from "./AskAI";
import { SQLEditor } from "./SQLEditor";
import { QueryExplanation } from "./QueryExplanation";
import { ResultsTable } from "./ResultsTable";
import { SavedReports } from "./SavedReports";
import { VisualQueryBuilder } from "./VisualQueryBuilder";
import type { QueryPlan } from "./AskAI";
import type { ReportResult } from "./ResultsTable";

type StudioTab = "ask" | "builder" | "saved";

export interface LoadedReport {
  sql: string;
  prompt: string;
  kpi: string;
  name: string;
}

interface ReportStudioProps {
  initialReport?: LoadedReport | null;
}

export function ReportStudio({ initialReport }: ReportStudioProps) {
  const [tab, setTab] = useState<StudioTab>("ask");
  // Dates initialized empty to avoid SSR/client mismatch; populated in useEffect
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  }, []);

  // SQL Editor state — pre-populate from initialReport if provided
  const [sql, setSql] = useState(initialReport?.sql ?? "");
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

  // Sync when an external saved report is pushed in after initial render
  useEffect(() => {
    if (!initialReport) return;
    setSql(initialReport.sql);
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
    setSql(plan.sql);
    setStartDate(sd);
    setEndDate(ed);
    setResult(null);
    setExecError(null);
  }

  async function executeSQL() {
    if (!sql.trim()) return;
    setExecuting(true);
    setExecError(null);
    setResult(null);

    try {
      const res = await fetch("/api/run-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql,
          start_date: startDate,
          end_date: endDate,
          report_name: currentPlan?.kpi_detected
            ? `${currentPlan.kpi_detected} Report`
            : "Custom Query",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setExecError(json.error ?? "Execution failed");
        return;
      }
      setResult(json);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Network error");
    } finally {
      setExecuting(false);
    }
  }

  function handleLoadSaved(report: { sql: string; prompt: string; kpi: string; name: string }) {
    setSql(report.sql);
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
            <div className="bg-card border border-border rounded-lg p-5">
              <SQLEditor
                sql={sql}
                onChange={setSql}
                onRun={executeSQL}
                loading={executing}
                startDate={startDate}
                endDate={endDate}
              />
            </div>
          )}

          {/* Execution error */}
          {execError && (
            <div className="flex flex-col gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-4">
              <p className="text-sm font-medium text-destructive">Execution failed</p>
              <p className="text-xs text-destructive/80">{execError}</p>
              {currentPlan && (
                <p className="text-xs text-muted-foreground mt-1">
                  Tip: Try rephrasing your prompt or check the SQL for syntax errors.
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
            }}
            loading={executing}
          />
        </div>
      )}

      {tab === "saved" && (
        <div className="bg-card border border-border rounded-lg p-5">
          <SavedReports
            onLoad={handleLoadSaved}
            pendingSave={pendingSave}
            onSaveDone={() => setPendingSave(null)}
          />
        </div>
      )}
    </div>
  );
}
