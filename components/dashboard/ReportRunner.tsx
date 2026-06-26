"use client";

import { useState } from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Code2,
  Table2,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReportResult {
  report_name: string;
  generated_at: string;
  filters: Record<string, unknown>;
  kpi: string;
  sql_used: string;
  data: Record<string, unknown>[];
  summary: {
    row_count: number;
    columns: string[];
    aggregates?: Record<string, number>;
  };
  cache_hit?: boolean;
  demo_mode?: boolean;
}

const PROMPT_PRESETS = [
  "Show weekly admissions grouped by hospice region",
  "Weekly revenue by branch for home health",
  "Active patient census by care type",
  "Weekly discharges grouped by branch",
];

export function ReportRunner() {
  const [prompt, setPrompt] = useState("");
  const [reportName, setReportName] = useState("");
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [auditLog, setAuditLog] = useState<
    { ts: string; prompt: string; kpi: string; rows: number; cached: boolean }[]
  >([]);

  async function runReport() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const name = reportName.trim() || `Report — ${new Date().toLocaleString()}`;

    try {
      const res = await fetch("/api/report/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_name: name,
          prompt,
          filters: {
            date_range: { start_date: startDate, end_date: endDate },
          },
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Request failed");
        return;
      }

      setResult(json);
      setAuditLog((prev) => [
        {
          ts: new Date().toISOString(),
          prompt,
          kpi: json.kpi,
          rows: json.summary?.row_count ?? 0,
          cached: json.cache_hit ?? false,
        },
        ...prev.slice(0, 9),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.report_name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Input card */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Run Report</h2>

        <div className="flex flex-col gap-4">
          {/* Report name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Report Name</label>
            <input
              type="text"
              placeholder="e.g. Weekly Admissions by Branch"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">
              Natural Language Prompt
            </label>
            <textarea
              rows={3}
              placeholder="Describe the report you want to generate..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            {/* Presets */}
            <div className="flex flex-wrap gap-2 mt-1">
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPrompt(p)}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground font-medium">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground font-medium">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <Button
            onClick={runReport}
            disabled={loading || !prompt.trim()}
            className="self-start bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {loading ? "Generating..." : "Run Report"}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-chart-3" />
              <span className="text-sm font-medium text-foreground">{result.report_name}</span>
              {result.demo_mode && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-chart-5/20 text-chart-5 border border-chart-5/30">
                  Demo Data
                </span>
              )}
              {result.cache_hit && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                  Cached
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {result.summary.row_count} rows
              </span>
              <button
                onClick={() => setShowSql(!showSql)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
              >
                <Code2 className="w-3.5 h-3.5" />
                SQL
                {showSql ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={downloadJson}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>
          </div>

          {/* SQL viewer */}
          {showSql && (
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Code2 className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Generated SQL
                </span>
              </div>
              <pre className="text-xs font-mono text-primary/90 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-3 overflow-x-auto">
                {result.sql_used}
              </pre>
            </div>
          )}

          {/* Summary row */}
          {result.summary.aggregates && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border-b border-border">
              {Object.entries(result.summary.aggregates)
                .slice(0, 4)
                .map(([key, val]) => (
                  <div key={key} className="bg-card px-4 py-2.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {key.replace(/_/g, " ")}
                    </p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      {typeof val === "number" && val > 999
                        ? val.toLocaleString()
                        : val}
                    </p>
                  </div>
                ))}
            </div>
          )}

          {/* Data table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {result.summary.columns.map((col) => (
                    <th
                      key={col}
                      className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"
                    >
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/50 hover:bg-muted/40 transition-colors"
                  >
                    {result.summary.columns.map((col) => (
                      <td key={col} className="px-4 py-2.5 text-sm text-foreground">
                        {typeof row[col] === "number"
                          ? (row[col] as number) > 999
                            ? (row[col] as number).toLocaleString()
                            : row[col]?.toString()
                          : row[col]?.toString() ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Table2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Session Audit Log</h3>
          </div>
          <div className="flex flex-col gap-1">
            {auditLog.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-1.5 text-xs text-muted-foreground border-b border-border/40 last:border-0"
              >
                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] shrink-0">
                  {entry.kpi}
                </span>
                <span className="truncate">{entry.prompt}</span>
                <span className="shrink-0">{entry.rows} rows</span>
                {entry.cached && (
                  <span className="shrink-0 text-[10px] text-primary">cached</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
