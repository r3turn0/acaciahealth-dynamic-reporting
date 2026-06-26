"use client";

import { useState, useEffect } from "react";
import { Bookmark } from "lucide-react";
import { AskAI } from "./AskAI";
import { SQLEditor } from "./SQLEditor";
import { QueryExplanation } from "./QueryExplanation";
import { ResultsTable } from "./ResultsTable";
import { SavedReports } from "./SavedReports";
import type { QueryPlan } from "./AskAI";
import type { ReportResult } from "./ResultsTable";

type StudioTab = "ask" | "saved";

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

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit border border-border">
        {(["ask", "saved"] as StudioTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
              tab === t
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "ask" ? "Ask AI / SQL Editor" : "Saved Reports"}
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
                onClick={triggerSave}
                className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border hover:border-primary/40"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save this report
              </button>
            </div>
          )}
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
