"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Play,
  Loader2,
  AlertTriangle,
  MessageSquarePlus,
  History,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Clock,
  XCircle,
  Table2,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedbackModal, type FixResult } from "./FeedbackModal";
import { AiFixPanel } from "./AiFixPanel";
import { useQueryFeedbackLog } from "@/lib/hooks/useQueryFeedbackLog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs?: number;
}

interface QueryError {
  apiError: string;
  dbErrorLogs: string;
}

interface HistoryEntry {
  id: string;
  userQuery: string;
  generatedSQL: string;
  status: "success" | "error" | "fixed";
  timestamp: string;
  durationMs?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function QueryPage() {
  const [userQuery, setUserQuery] = useState("");
  const [generatedSQL, setGeneratedSQL] = useState("");
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<QueryError | null>(null);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { addEntry, markRetryResult } = useQueryFeedbackLog();

  // ── Toast helper ────────────────────────────────────────────────────────────
  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  function pushHistory(entry: Omit<HistoryEntry, "id" | "timestamp">) {
    setHistory((prev) =>
      [
        { ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() },
        ...prev,
      ].slice(0, 50)
    );
  }

  // ── Generate SQL from natural language ─────────────────────────────────────
  async function generateSQL() {
    const q = userQuery.trim();
    if (!q) return;
    setGenerating(true);
    setQueryError(null);
    setResult(null);
    setFixResult(null);

    try {
      const res = await fetch("/api/bi/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q, fields: [], mode: "sql" }),
      });
      const json = await res.json();
      // If the copilot returns a raw SQL string (future enhancement), use it.
      // For now we synthesise a demo SQL from the query text so the UI is exercisable.
      const sql =
        json.sql ??
        buildDemoSQL(q);
      setGeneratedSQL(sql);
    } catch {
      // Fallback: build a plausible demo SQL so the UI is always exercisable.
      setGeneratedSQL(buildDemoSQL(q));
    } finally {
      setGenerating(false);
    }
  }

  // ── Execute SQL ─────────────────────────────────────────────────────────────
  async function runSQL(sql: string) {
    setRunning(true);
    setQueryError(null);
    setResult(null);

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
        const err: QueryError = {
          apiError: `${res.status} ${res.statusText}`,
          dbErrorLogs: json.error ?? json.details ?? "Unknown database error",
        };
        setQueryError(err);
        pushHistory({ userQuery, generatedSQL: sql, status: "error", durationMs });
        return;
      }

      const rows: Record<string, unknown>[] = Array.isArray(json.rows)
        ? json.rows
        : Array.isArray(json.data)
        ? json.data
        : [];

      setResult({ rows, rowCount: rows.length, durationMs });
      pushHistory({ userQuery, generatedSQL: sql, status: "success", durationMs });
      toast(`Query completed — ${rows.length} row${rows.length !== 1 ? "s" : ""} in ${durationMs}ms`);
    } catch (e) {
      const durationMs = Date.now() - start;
      const err: QueryError = {
        apiError: "Network error — could not reach the query API",
        dbErrorLogs: e instanceof Error ? e.message : String(e),
      };
      setQueryError(err);
      pushHistory({ userQuery, generatedSQL: sql, status: "error", durationMs });
    } finally {
      setRunning(false);
    }
  }

  // ── Handle fix result from AI ───────────────────────────────────────────────
  function handleFixResult(fix: FixResult) {
    setFixResult(fix);
    toast(fix.autoRetry ? "Fix ready — confidence high, retrying automatically…" : "Fix ready — review and retry");
    if (fix.autoRetry) {
      handleRetry(fix.fixedSQL, fix);
    }
  }

  async function handleRetry(fixedSQL: string, fix?: FixResult) {
    const usedFix = fix ?? fixResult;
    setRetrying(true);
    setQueryError(null);
    setResult(null);

    const logId = usedFix
      ? addEntry({
          userIntent: userQuery,
          originalSQL: generatedSQL,
          fixedSQL,
          error: [queryError?.apiError, queryError?.dbErrorLogs].filter(Boolean).join("\n"),
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
        setQueryError({
          apiError: `${res.status} ${res.statusText}`,
          dbErrorLogs: json.error ?? "Unknown error after retry",
        });
        if (logId) markRetryResult(logId, false);
        pushHistory({ userQuery, generatedSQL: fixedSQL, status: "error", durationMs });
        toast("Retry failed — open feedback again to refine");
        return;
      }

      const rows: Record<string, unknown>[] = Array.isArray(json.rows)
        ? json.rows
        : Array.isArray(json.data)
        ? json.data
        : [];

      setGeneratedSQL(fixedSQL);
      setFixResult(null);
      setResult({ rows, rowCount: rows.length, durationMs });
      if (logId) markRetryResult(logId, true);
      pushHistory({ userQuery, generatedSQL: fixedSQL, status: "fixed", durationMs });
      toast(`Fixed and retried successfully — ${rows.length} row${rows.length !== 1 ? "s" : ""}`);
    } catch (e) {
      if (logId) markRetryResult(logId, false);
      setQueryError({
        apiError: "Network error during retry",
        dbErrorLogs: e instanceof Error ? e.message : String(e),
      });
      toast("Retry failed — network error");
    } finally {
      setRetrying(false);
    }
  }

  const columns = useMemo(
    () => (result && result.rows.length > 0 ? Object.keys(result.rows[0]) : []),
    [result]
  );

  return (
    <div className="flex flex-col gap-4 relative">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border shadow-xl text-sm text-foreground animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-chart-3 shrink-0" />
          {toastMsg}
        </div>
      )}

      {/* Query input panel */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">Natural Language Query</h2>
        </div>

        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
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
            placeholder="Ask in plain English — e.g. &quot;Total cash deposits by branch last month&quot;"
            rows={2}
            className="flex-1 px-3 py-2.5 rounded-lg bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors leading-relaxed"
          />
          <button
            onClick={generateSQL}
            disabled={generating || !userQuery.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 self-start"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Generate
          </button>
        </div>

        {/* Generated SQL editor */}
        {generatedSQL && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Generated SQL
              </span>
              <span className="text-[10px] text-muted-foreground">
                Edit before running if needed
              </span>
            </div>
            <textarea
              value={generatedSQL}
              onChange={(e) => setGeneratedSQL(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-lg bg-muted/60 border border-border font-mono text-[12px] text-foreground resize-y focus:outline-none focus:border-primary transition-colors leading-relaxed"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => runSQL(generatedSQL)}
                disabled={running || retrying || !generatedSQL.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-chart-3 text-white text-sm font-medium hover:bg-chart-3/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {running ? "Running…" : "Run Query"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error panel */}
      {queryError && (
        <div className="bg-card border border-destructive/30 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-destructive/15 text-destructive shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Query Failed</span>
            <button
              onClick={() => setModalOpen(true)}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/8 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Fix with AI
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20">
              <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
              <span className="text-xs text-destructive leading-relaxed">{queryError.apiError}</span>
            </div>
            {queryError.dbErrorLogs && (
              <pre className="text-[11px] font-mono text-destructive/80 bg-destructive/5 border border-destructive/15 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {queryError.dbErrorLogs}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* AI Fix Panel */}
      {fixResult && !retrying && (
        <AiFixPanel
          result={fixResult}
          originalSQL={generatedSQL}
          retrying={retrying}
          onRetry={handleRetry}
          onDismiss={() => setFixResult(null)}
        />
      )}

      {/* Results table */}
      {result && (
        <div className="bg-card border border-border rounded-xl flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Table2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground">Results</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-chart-3/15 text-chart-3 font-medium">
              {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
            </span>
            {result.durationMs !== undefined && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto">
                <Clock className="w-3 h-3" />
                {result.durationMs}ms
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
                {result.rows.map((row, ri) => (
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

      {/* Query history */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-xl flex flex-col">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 px-4 py-3 text-sm text-foreground hover:bg-muted/30 transition-colors rounded-xl"
          >
            <History className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium">Query History</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {history.length}
            </span>
            <ChevronDown
              className={cn(
                "w-4 h-4 text-muted-foreground ml-auto transition-transform",
                showHistory && "rotate-180"
              )}
            />
          </button>

          {showHistory && (
            <div className="border-t border-border flex flex-col divide-y divide-border/50">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setUserQuery(h.userQuery);
                    setGeneratedSQL(h.generatedSQL);
                    setResult(null);
                    setQueryError(null);
                    setFixResult(null);
                  }}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
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
                    {new Date(h.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {h.durationMs !== undefined && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {h.durationMs}ms
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={() => setHistory([])}
                className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear history
              </button>
            </div>
          )}
        </div>
      )}

      {/* Feedback modal */}
      <FeedbackModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        userQuery={userQuery}
        generatedSQL={generatedSQL}
        apiError={queryError?.apiError ?? ""}
        dbErrorLogs={queryError?.dbErrorLogs ?? ""}
        onFixResult={handleFixResult}
      />
    </div>
  );
}

// ── Demo SQL builder (used when the copilot doesn't return raw SQL) ────────────

function buildDemoSQL(q: string): string {
  const lower = q.toLowerCase();

  if (lower.includes("cash deposit") || lower.includes("deposit")) {
    return `SELECT
  cd.cd_branchcode,
  SUM(cd.cd_initialamount) AS total_deposits,
  COUNT(*) AS deposit_count
FROM Accounting.CASH_DEPOSITS cd
WHERE cd.cd_insertdate >= DATEADD(month, -1, GETDATE())
GROUP BY cd.cd_branchcode
ORDER BY total_deposits DESC;`;
  }

  if (lower.includes("revenue") || lower.includes("conversion")) {
    return `SELECT
  rct.rct_step,
  COUNT(*) AS step_count,
  SUM(CAST(rct.rct_finished AS int)) AS finished_count
FROM Accounting.REVENUE_CONVERSION_TRACKER rct
GROUP BY rct.rct_step
ORDER BY step_count DESC;`;
  }

  if (lower.includes("closing period") || lower.includes("period")) {
    return `SELECT TOP 20
  cdcp.cdcp_cpid,
  COUNT(*) AS distribution_count,
  MIN(cdcp.cdcp_insertdate) AS first_entry,
  MAX(cdcp.cdcp_insertdate) AS last_entry
FROM Accounting.CASH_DISTRIBUTION_CLOSING_PERIODS cdcp
GROUP BY cdcp.cdcp_cpid
ORDER BY distribution_count DESC;`;
  }

  // Generic fallback
  return `SELECT TOP 50 *
FROM Accounting.CASH_DEPOSITS
WHERE cd_insertdate >= DATEADD(day, -30, GETDATE())
ORDER BY cd_insertdate DESC;`;
}
