"use client";

/**
 * WorkspacePage
 *
 * Full-featured SQL analytics workspace with:
 * - Multi-tab in-memory state (Zustand) — no refresh loss
 * - Vector-augmented SQL generation via /api/generate-sql
 * - Self-healing via /api/fix-query (with auto-retry on high confidence)
 * - "Save as Report" with vector corpus injection
 * - Saved reports sidebar — reopen without recomputing
 * - Per-tab Refresh + global Refresh All
 * - Full query history (cross-tab)
 * - AI explanation panel + confidence indicator
 * - Observability: tracks failed tables / confusion sources
 */

import { useCallback, useMemo, useState } from "react";
import {
  Play,
  Loader2,
  AlertTriangle,
  MessageSquarePlus,
  Sparkles,
  Table2,
  Clock,
  CheckCircle2,
  XCircle,
  BookMarked,
  Bookmark,
  ChevronDown,
  Trash2,
  RefreshCw,
  History,
  BarChart3,
  Info,
  X,
  Search,
  SidebarClose,
  SidebarOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/store/useWorkspaceStore";
import type { WorkspaceTab, SavedQueryReport } from "@/lib/store/useWorkspaceStore";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { FeedbackModal, type FixResult } from "./FeedbackModal";
import { AiFixPanel } from "./AiFixPanel";
import { useQueryFeedbackLog } from "@/lib/hooks/useQueryFeedbackLog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toast_noop() {} // replaced by component's toast

// ── Tab content panel ─────────────────────────────────────────────────────────

interface TabPanelProps {
  tab: WorkspaceTab;
  onToast: (msg: string) => void;
}

function TabPanel({ tab, onToast }: TabPanelProps) {
  const {
    updateTab,
    startGenerating,
    startRunning,
    startFixing,
    setSuccess,
    setError,
    setFix,
    pushHistory,
    saveReport,
  } = useWorkspaceStore();

  const { addEntry, markRetryResult } = _useFeedbackLog();
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Generate SQL ────────────────────────────────────────────────────────────
  async function generateSQL() {
    const q = tab.userQuery.trim();
    if (!q) return;

    startGenerating(tab.id);
    updateTab(tab.id, { title: q.slice(0, 30) || "Query" });

    const { savedReports, history } = useWorkspaceStore.getState();

    // Build a compact fix-log from history for vector corpus
    const fixLog = history
      .filter((h) => h.status === "fixed")
      .slice(0, 30)
      .map((h) => ({
        id: h.id,
        originalSQL: "",
        fixedSQL: h.generatedSQL,
        error: "",
        userIntent: h.userQuery,
        timestamp: h.timestamp,
      }));

    try {
      const res = await fetch("/api/generate-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuery: q,
          savedReports: savedReports.map((r) => ({
            id: r.id,
            name: r.name,
            userQuery: r.userQuery,
            sql: r.sql,
            columns: r.columns,
            createdAt: r.createdAt,
            vectorSources: r.vectorSources,
          })),
          fixLog,
        }),
      });
      const json = await res.json();
      const sql: string = json.sql ?? "";
      const explanation: string = json.explanation ?? "";
      const confidence: number = json.confidence ?? 0.7;
      const sources: string[] = json.sourcesUsed ?? [];

      updateTab(tab.id, {
        generatedSQL: sql,
        status: "idle",
        fixExplanation: undefined,
        fixedSQL: undefined,
        vectorSources: sources,
        // Show AI explanation in the tab
        fixChanges: undefined,
        showFixPanel: false,
      });

      // Surface the explanation to the user via a lightweight inline note
      // stored in fixExplanation (reused for SQL explanation display)
      updateTab(tab.id, {
        fixExplanation: `${confidence >= 0.85 ? "High" : confidence >= 0.65 ? "Medium" : "Low"} confidence (${Math.round(confidence * 100)}%) — ${explanation}`,
      });

      onToast("SQL generated from vector context");
    } catch {
      updateTab(tab.id, { status: "idle", generatedSQL: "" });
      onToast("Generation failed — check AI configuration");
    }
  }

  // ── Run SQL ─────────────────────────────────────────────────────────────────
  async function runSQL(sqlOverride?: string) {
    const sql = (sqlOverride ?? tab.generatedSQL).trim();
    if (!sql) return;

    startRunning(tab.id);
    const start = Date.now();

    try {
      const res = await fetch("/api/datasets/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const json = await res.json();
      const durationMs = Date.now() - start;

      if (!res.ok || json.error) {
        setError(
          tab.id,
          `${res.status} ${res.statusText}`,
          json.error ?? json.details ?? "Unknown database error"
        );
        pushHistory({ tabId: tab.id, userQuery: tab.userQuery, generatedSQL: sql, status: "error", durationMs });
        return;
      }

      const rows: Record<string, unknown>[] = Array.isArray(json.rows)
        ? json.rows
        : Array.isArray(json.data)
        ? json.data
        : [];

      setSuccess(tab.id, rows, durationMs);
      pushHistory({ tabId: tab.id, userQuery: tab.userQuery, generatedSQL: sql, status: "success", durationMs });
      onToast(`${rows.length} row${rows.length !== 1 ? "s" : ""} in ${durationMs}ms`);
    } catch (e) {
      const durationMs = Date.now() - start;
      setError(tab.id, "Network error", e instanceof Error ? e.message : String(e));
      pushHistory({ tabId: tab.id, userQuery: tab.userQuery, generatedSQL: tab.generatedSQL, status: "error", durationMs });
    }
  }

  // ── Handle fix result ───────────────────────────────────────────────────────
  function handleFixResult(fix: FixResult) {
    setFix(tab.id, fix);
    onToast(fix.autoRetry ? "Fix ready — auto-retrying…" : "Fix ready — review below");
    if (fix.autoRetry) {
      handleRetry(fix.fixedSQL, fix);
    }
  }

  async function handleRetry(fixedSQL: string, fix?: FixResult) {
    const usedFix = fix;
    startFixing(tab.id);

    const logId = usedFix
      ? addEntry({
          userIntent: tab.userQuery,
          originalSQL: tab.generatedSQL,
          fixedSQL,
          error: [tab.apiError, tab.dbErrorLogs].filter(Boolean).join("\n"),
          userFeedback: "",
          confidence: usedFix.confidence,
          changes: usedFix.changes,
        }).id
      : undefined;

    const start = Date.now();
    try {
      const res = await fetch("/api/datasets/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: fixedSQL }),
      });
      const json = await res.json();
      const durationMs = Date.now() - start;

      if (!res.ok || json.error) {
        setError(
          tab.id,
          `${res.status} ${res.statusText}`,
          json.error ?? "Unknown error after retry"
        );
        if (logId) markRetryResult(logId, false);
        pushHistory({ tabId: tab.id, userQuery: tab.userQuery, generatedSQL: fixedSQL, status: "error", durationMs });
        onToast("Retry failed — open feedback to refine");
        return;
      }

      const rows: Record<string, unknown>[] = Array.isArray(json.rows)
        ? json.rows
        : Array.isArray(json.data)
        ? json.data
        : [];

      updateTab(tab.id, { generatedSQL: fixedSQL, showFixPanel: false, fixedSQL: undefined });
      setSuccess(tab.id, rows, durationMs);
      if (logId) markRetryResult(logId, true);
      pushHistory({ tabId: tab.id, userQuery: tab.userQuery, generatedSQL: fixedSQL, status: "fixed", durationMs });
      onToast(`Fixed and retried — ${rows.length} rows`);
    } catch (e) {
      if (logId) markRetryResult(logId, false);
      setError(tab.id, "Network error during retry", e instanceof Error ? e.message : String(e));
      onToast("Retry failed — network error");
    }
  }

  // ── Save report ─────────────────────────────────────────────────────────────
  async function doSaveReport() {
    if (!saveName.trim() || !tab.generatedSQL.trim()) return;
    setSaving(true);

    const columns = tab.rows.length > 0 ? Object.keys(tab.rows[0]) : [];

    try {
      const res = await fetch("/api/save-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          userQuery: tab.userQuery,
          sql: tab.generatedSQL,
          columns,
          rowCount: tab.rowCount,
          vectorSources: tab.vectorSources ?? [],
        }),
      });
      const json = await res.json();
      if (json.report) {
        saveReport(json.report);
        onToast(`Report "${saveName}" saved`);
        setShowSaveModal(false);
        setSaveName("");
      }
    } catch {
      onToast("Failed to save report");
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo(
    () => (tab.rows.length > 0 ? Object.keys(tab.rows[0]) : []),
    [tab.rows]
  );

  const isRunning = tab.status === "running" || tab.status === "fixing";
  const isGenerating = tab.status === "generating";

  return (
    <div className="flex flex-col gap-4 relative min-h-0">
      {/* Query input */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {tab.inputMode === "nl" ? (
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <BarChart3 className="w-4 h-4 text-chart-3 shrink-0" />
          )}
          <h2 className="text-sm font-semibold text-foreground">
            {tab.inputMode === "nl" ? "Natural Language Query" : "SQL Editor"}
          </h2>

          {/* NL / SQL mode toggle */}
          <div className="ml-auto flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              onClick={() => updateTab(tab.id, { inputMode: "nl" })}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                tab.inputMode === "nl"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              NL
            </button>
            <button
              onClick={() => updateTab(tab.id, { inputMode: "sql" })}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                tab.inputMode === "sql"
                  ? "bg-chart-3 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              SQL
            </button>
          </div>

          {tab.vectorSources && tab.vectorSources.length > 0 && tab.inputMode === "nl" && (
            <span className="flex items-center gap-1 text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              <Search className="w-2.5 h-2.5" />
              {tab.vectorSources.length} context sources
            </span>
          )}
        </div>

        {/* NL mode: natural language input */}
        {tab.inputMode === "nl" && (
        <div className="flex gap-2">
          <textarea
            value={tab.userQuery}
            onChange={(e) => updateTab(tab.id, { userQuery: e.target.value })}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                generateSQL();
              }
            }}
            placeholder='Ask in plain English — e.g. "Total cash deposits by branch last month"'
            rows={2}
            className="flex-1 px-3 py-2.5 rounded-lg bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors leading-relaxed"
          />
          <button
            onClick={generateSQL}
            disabled={isGenerating || !tab.userQuery.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 self-start"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate
          </button>
        </div>
        )}

        {/* SQL mode: direct SQL editor with Run button */}
        {tab.inputMode === "sql" && (
        <div className="flex flex-col gap-2">
          <textarea
            value={tab.generatedSQL}
            onChange={(e) => updateTab(tab.id, { generatedSQL: e.target.value })}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                runSQL();
              }
            }}
            placeholder={"-- Write T-SQL directly\nSELECT TOP 100 ...\nFROM dbo.CLIENT_EPISODES_ALL\nWHERE epi_SocDate >= DATEADD(month, -1, GETDATE())"}
            rows={6}
            spellCheck={false}
            className="w-full px-3 py-2.5 rounded-lg bg-muted/60 border border-border font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 resize-y focus:outline-none focus:border-chart-3 transition-colors leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => runSQL()}
              disabled={isRunning || !tab.generatedSQL.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-chart-3 text-white text-sm font-medium hover:bg-chart-3/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? "Running…" : "Run Query"}
            </button>
            <span className="text-[10px] text-muted-foreground">Ctrl + Enter to run</span>
          </div>
        </div>
        )}

        {/* AI Explanation */}
        {tab.fixExplanation && tab.generatedSQL && !tab.showFixPanel && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/6 border border-primary/20 text-[11px] text-primary leading-relaxed">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {tab.fixExplanation}
          </div>
        )}

        {/* SQL Editor */}
        {tab.generatedSQL && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Generated SQL
              </span>
              <span className="text-[10px] text-muted-foreground">Edit before running if needed</span>
            </div>
            <textarea
              value={tab.generatedSQL}
              onChange={(e) => updateTab(tab.id, { generatedSQL: e.target.value })}
              rows={5}
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-lg bg-muted/60 border border-border font-mono text-[12px] text-foreground resize-y focus:outline-none focus:border-primary transition-colors leading-relaxed"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => runSQL()}
                disabled={isRunning || isGenerating || !tab.generatedSQL.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-chart-3 text-white text-sm font-medium hover:bg-chart-3/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isRunning ? "Running…" : "Run Query"}
              </button>

              {/* Refresh this tab */}
              <button
                onClick={() => runSQL()}
                disabled={isRunning || !tab.generatedSQL.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Refresh this tab"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>

              {/* Save as Report */}
              {tab.rows.length > 0 && (
                <button
                  onClick={() => {
                    setSaveName(tab.title || tab.userQuery.slice(0, 40) || "Untitled Report");
                    setShowSaveModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 bg-primary/6 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Save as Report
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error panel */}
      {tab.status === "error" && tab.apiError && (
        <div className="bg-card border border-destructive/30 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-destructive/15 text-destructive shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Query Failed</span>

            {/* Auto-Fix: calls pipeline without opening modal */}
            <button
              onClick={async () => {
                startFixing(tab.id);
                try {
                  const res = await fetch("/api/fix-query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      userQuery: tab.userQuery,
                      generatedSQL: tab.generatedSQL,
                      apiError: tab.apiError,
                      dbErrorLogs: tab.dbErrorLogs,
                    }),
                  });
                  const json = await res.json();
                  if (res.ok && json.fixedSQL) {
                    handleFixResult({ ...json, autoRetry: json.autoRetry ?? false });
                  } else {
                    updateTab(tab.id, { status: "error" });
                    onToast("Auto-fix could not produce a repair — try Fix with AI");
                  }
                } catch {
                  updateTab(tab.id, { status: "error" });
                  onToast("Auto-fix failed — check connection");
                }
              }}
              disabled={tab.status === "fixing"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-chart-3/40 bg-chart-3/8 text-chart-3 text-xs font-medium hover:bg-chart-3/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {tab.status === "fixing" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {tab.status === "fixing" ? "Analyzing…" : "Auto-Fix"}
            </button>

            <button
              onClick={() => updateTab(tab.id, { showFeedbackModal: true })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/8 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Fix with AI
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20">
              <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
              <span className="text-xs text-destructive leading-relaxed font-mono">{tab.apiError}</span>
            </div>
            {tab.dbErrorLogs && (
              <pre className="text-[11px] font-mono text-destructive/80 bg-destructive/5 border border-destructive/15 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {tab.dbErrorLogs}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* AI Fix Panel */}
      {tab.showFixPanel && tab.fixedSQL && (
        <AiFixPanel
          result={{
            fixedSQL: tab.fixedSQL,
            explanation: tab.fixExplanation ?? "",
            confidence: tab.fixConfidence ?? 0.5,
            changes: tab.fixChanges ?? [],
            autoRetry: (tab.fixConfidence ?? 0) >= 0.9,
            tier: tab.fixTier,
          }}
          originalSQL={tab.generatedSQL}
          retrying={tab.status === "fixing"}
          onRetry={(fixedSQL) => handleRetry(fixedSQL)}
          onDismiss={() => updateTab(tab.id, { showFixPanel: false })}
        />
      )}

      {/* Results */}
      {tab.rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
            <Table2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground">Results</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-chart-3/15 text-chart-3 font-medium">
              {tab.rowCount} row{tab.rowCount !== 1 ? "s" : ""}
            </span>
            {tab.durationMs !== undefined && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                {tab.durationMs}ms
              </span>
            )}
            {tab.lastRun && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                Last run {new Date(tab.lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-muted/50 sticky top-0">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap font-mono text-[11px]"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={cn(
                      "border-b border-border/40 hover:bg-muted/30 transition-colors",
                      ri % 2 === 0 ? "bg-background" : "bg-muted/10"
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate"
                      >
                        {row[col] === null || row[col] === undefined ? (
                          <span className="text-muted-foreground/40 italic text-[10px]">null</span>
                        ) : (
                          String(row[col])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Feedback modal */}
      <FeedbackModal
        open={tab.showFeedbackModal}
        onClose={() => updateTab(tab.id, { showFeedbackModal: false })}
        userQuery={tab.userQuery}
        generatedSQL={tab.generatedSQL}
        apiError={tab.apiError}
        dbErrorLogs={tab.dbErrorLogs}
        onFixResult={handleFixResult}
      />

      {/* Save Report Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Save as Report</h3>
              <button
                onClick={() => setShowSaveModal(false)}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Report Name</label>
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) doSaveReport();
                }}
                className="px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                placeholder="e.g. Monthly Claims Revenue"
              />
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span>Query: <span className="text-foreground">{tab.userQuery.slice(0, 80)}</span></span>
              <span>Columns: <span className="text-foreground font-mono">{columns.slice(0, 5).join(", ")}</span></span>
              <span>{tab.rowCount} rows — will be added to the vector context for future queries</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSaveReport}
                disabled={saving || !saveName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookMarked className="w-3.5 h-3.5" />}
                Save Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Saved Reports Sidebar ───────────────────────────────────────────��─────────

interface ReportsSidebarProps {
  reports: SavedQueryReport[];
  onOpen: (report: SavedQueryReport) => void;
  onDelete: (id: string) => void;
}

function ReportsSidebar({ reports, onOpen, onDelete }: ReportsSidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) => r.name.toLowerCase().includes(q) || r.userQuery.toLowerCase().includes(q)
    );
  }, [reports, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 border-b border-border flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BookMarked className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Saved Reports</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {reports.length}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="w-full pl-6 pr-2 py-1.5 rounded-md bg-muted/40 border border-border text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground leading-relaxed">
            {reports.length === 0
              ? "No saved reports yet. Run a query and click Save as Report."
              : "No reports match your search."}
          </div>
        )}
        {filtered.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpen(r)}
            className="w-full flex flex-col gap-0.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/40 group"
          >
            <div className="flex items-center gap-1.5">
              <BookMarked className="w-3 h-3 text-primary/60 shrink-0" />
              <span className="text-[12px] font-medium text-foreground truncate flex-1">{r.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(r.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                aria-label="Delete report"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground truncate pl-4">{r.userQuery}</span>
            <div className="flex items-center gap-2 pl-4 mt-0.5">
              <span className="text-[9px] text-muted-foreground">{r.rowCount} rows</span>
              <span className="text-[9px] text-muted-foreground">·</span>
              <span className="text-[9px] text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────

function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { history, clearHistory, tabs, switchTab, updateTab } = useWorkspaceStore();

  function restoreEntry(entry: (typeof history)[0]) {
    // Find if there's already a tab for this tabId
    const existingTab = tabs.find((t) => t.id === entry.tabId);
    if (existingTab) {
      updateTab(existingTab.id, {
        userQuery: entry.userQuery,
        generatedSQL: entry.generatedSQL,
      });
      switchTab(existingTab.id);
    }
    onClose();
  }

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col max-h-80">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <History className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Query History</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {history.length}
        </span>
        <button
          onClick={clearHistory}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 divide-y divide-border/50">
        {history.slice(0, 50).map((h) => (
          <button
            key={h.id}
            onClick={() => restoreEntry(h)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left w-full"
          >
            {h.status === "success" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-chart-3 shrink-0" />
            ) : h.status === "fixed" ? (
              <BarChart3 className="w-3.5 h-3.5 text-primary shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
            )}
            <span className="text-[12px] text-foreground truncate flex-1">
              {h.userQuery || h.generatedSQL.slice(0, 60)}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {new Date(h.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {h.durationMs !== undefined && (
              <span className="text-[10px] text-muted-foreground shrink-0">{h.durationMs}ms</span>
            )}
          </button>
        ))}
        {history.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">No history yet</div>
        )}
      </div>
    </div>
  );
}

// ── Main WorkspacePage ────────────────────────────────────────────────────────

export function WorkspacePage() {
  const { tabs, activeTabId, getActiveTab, openReportAsTab, removeReport, savedReports, refreshAllTabs, updateTab } =
    useWorkspaceStore();

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeTab = getActiveTab();

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  // ── Refresh All ─────────────────────────────────────────��──────────────────
  async function handleRefreshAll() {
    setRefreshingAll(true);
    await refreshAllTabs(async (tabId, sql) => {
      // Mark running
      updateTab(tabId, { status: "running", rows: [], rowCount: 0 });
      const start = Date.now();
      try {
        const res = await fetch("/api/datasets/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        const json = await res.json();
        const durationMs = Date.now() - start;
        if (!res.ok || json.error) {
          updateTab(tabId, {
            status: "error",
            apiError: `${res.status} ${res.statusText}`,
            dbErrorLogs: json.error ?? "Unknown error",
          });
          return;
        }
        const rows: Record<string, unknown>[] = Array.isArray(json.rows)
          ? json.rows
          : Array.isArray(json.data)
          ? json.data
          : [];
        updateTab(tabId, {
          status: "success",
          rows,
          rowCount: rows.length,
          durationMs,
          lastRun: new Date().toISOString(),
          apiError: "",
          dbErrorLogs: "",
        });
      } catch (e) {
        updateTab(tabId, {
          status: "error",
          apiError: "Network error",
          dbErrorLogs: e instanceof Error ? e.message : String(e),
        });
      }
    });
    setRefreshingAll(false);
    toast(`Refreshed ${tabs.filter((t) => t.generatedSQL.trim()).length} tab(s)`);
  }

  const tabsWithSQL = tabs.filter((t) => t.generatedSQL.trim()).length;

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-border bg-background overflow-hidden">
      {/* Tab bar */}
      <WorkspaceTabBar onRefreshAll={handleRefreshAll} refreshingAll={refreshingAll} />

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Tab content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Toolbar row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors",
                showHistory
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <History className="w-3.5 h-3.5" />
              History
              {useWorkspaceStore.getState().history.length > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {useWorkspaceStore.getState().history.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              title={sidebarOpen ? "Hide reports sidebar" : "Show reports sidebar"}
            >
              {sidebarOpen ? <SidebarClose className="w-3.5 h-3.5" /> : <SidebarOpen className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Reports</span>
              {savedReports.length > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded-full bg-primary/15 text-primary">
                  {savedReports.length}
                </span>
              )}
            </button>

            {tabsWithSQL > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                {tabsWithSQL} tab{tabsWithSQL !== 1 ? "s" : ""} with SQL
              </span>
            )}
          </div>

          {/* History panel */}
          {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}

          {/* Active tab panel */}
          {activeTab && <TabPanel key={activeTab.id} tab={activeTab} onToast={toast} />}
        </div>

        {/* Reports sidebar */}
        {sidebarOpen && (
          <div className="w-56 shrink-0 border-l border-border bg-card hidden md:flex flex-col min-h-0">
            <ReportsSidebar
              reports={savedReports}
              onOpen={(r) => openReportAsTab(r)}
              onDelete={removeReport}
            />
          </div>
        )}
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border shadow-xl text-sm text-foreground animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-chart-3 shrink-0" />
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function _useFeedbackLog() {
  return useQueryFeedbackLog();
}
