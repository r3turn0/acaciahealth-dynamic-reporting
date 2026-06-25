"use client";

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import type { BusinessInsights } from "@/app/api/kpi/interpret/route";
import type { SavedReport } from "@/lib/agents/reportRegistry";

// ── Types ────────────────────────────────────────────────────────────────────

interface InterpretMeta {
  model: string;
  row_count: number;
  sample_count: number;
  generated_at: string;
  fallback?: boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-chart-1/15 text-chart-1 border-chart-1/30",
    medium: "bg-chart-5/15 text-chart-5 border-chart-5/30",
    low: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${styles[level]}`}>
      {level} confidence
    </span>
  );
}

function TrendIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") return <ArrowUpRight className="w-3.5 h-3.5 text-chart-1 shrink-0" />;
  if (direction === "down") return <ArrowDownRight className="w-3.5 h-3.5 text-destructive shrink-0" />;
  return <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function AlertIcon({ severity }: { severity: "high" | "medium" | "low" }) {
  if (severity === "high") return <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />;
  if (severity === "medium") return <CircleAlert className="w-4 h-4 text-chart-5 shrink-0 mt-0.5" />;
  return <CheckCircle2 className="w-4 h-4 text-chart-1 shrink-0 mt-0.5" />;
}

function AlertCard({ alert }: { alert: BusinessInsights["alerts"][0] }) {
  const [open, setOpen] = useState(false);
  const borderMap = { high: "border-destructive/40", medium: "border-chart-5/40", low: "border-border" };
  const bgMap = { high: "bg-destructive/5", medium: "bg-chart-5/5", low: "bg-muted/30" };

  return (
    <div className={`border rounded-lg overflow-hidden ${borderMap[alert.severity]}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 ${bgMap[alert.severity]}`}
      >
        <AlertIcon severity={alert.severity} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{alert.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.detail}</p>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-border/50 bg-card">
          <p className="text-xs text-foreground/80 leading-relaxed">{alert.detail}</p>
          <div className="mt-3 flex items-start gap-2">
            <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-primary leading-relaxed">{alert.recommended_action}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Raw JSON panel ────────────────────────────────────────────────────────────

function RawJsonPanel({ insights }: { insights: BusinessInsights }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(insights, null, 2);

  function copy() {
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "business-insights.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <InsightSection title="Business Insights JSON" icon={BookOpen}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Raw object — pipe this into downstream systems, dashboards, or reports.</p>
        <div className="flex items-center gap-2">
          <button
            onClick={download}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded border border-border hover:border-primary/40 bg-muted/30"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded border border-primary/30 hover:border-primary bg-primary/5"
          >
            {copied ? "Copied!" : "Copy JSON"}
          </button>
        </div>
      </div>
      <pre className="text-[11px] font-mono text-foreground/75 bg-muted/40 rounded-md p-4 overflow-auto max-h-96 leading-relaxed border border-border/50">
        {json}
      </pre>
    </InsightSection>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function KpiInterpreter() {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });
  const [interpreting, setInterpreting] = useState(false);
  const [insights, setInsights] = useState<BusinessInsights | null>(null);
  const [meta, setMeta] = useState<InterpretMeta | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved reports from registry
  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const res = await fetch("/api/reports");
      const json = await res.json();
      setReports(json.reports ?? []);
    } catch {
      setError("Failed to load saved reports.");
    } finally {
      setLoadingReports(false);
    }
  }, []);

  // Run the AI interpretation
  async function interpret() {
    if (!selectedReport) return;
    setInterpreting(true);
    setInsights(null);
    setMeta(null);
    setError(null);

    try {
      // First, re-execute the report to get fresh data to interpret
      const runRes = await fetch("/api/report/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_name: selectedReport.name,
          prompt: selectedReport.prompt,
          filters: {
            date_range: { start_date: dateRange.start, end_date: dateRange.end },
          },
        }),
      });
      const runJson = await runRes.json();
      const rows: Record<string, unknown>[] = runJson.data ?? [];
      const columns: string[] = rows.length > 0 ? Object.keys(rows[0]) : [];

      // Then call the interpreter
      const intRes = await fetch("/api/kpi/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_name: selectedReport.name,
          kpi: selectedReport.kpi,
          start_date: dateRange.start,
          end_date: dateRange.end,
          data: rows,
          columns,
        }),
      });
      const intJson = await intRes.json();
      setInsights(intJson.insights);
      setMeta(intJson.meta);
    } catch (err) {
      setError("Interpretation failed. Please try again.");
    } finally {
      setInterpreting(false);
    }
  }

  // ── Render: report selector panel ─────────────────────────────────────────

  if (!reports) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">KPI Interpreter</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
            Load your saved reports, select one, and the AI will generate a structured business insights JSON with trends, alerts, and recommendations.
          </p>
        </div>
        <button
          onClick={loadReports}
          disabled={loadingReports}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loadingReports ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
          Load Saved Reports
        </button>
      </div>
    );
  }

  // ── Render: report list + configuration ───────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Report selector */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Select a Report to Interpret</h3>
          <button
            onClick={loadReports}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        {reports.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No saved reports found. Create one in Report Studio first.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelectedReport(r); setInsights(null); }}
                className={`w-full text-left px-3.5 py-3 rounded-lg border transition-colors ${
                  selectedReport?.id === r.id
                    ? "border-primary bg-primary/8 text-foreground"
                    : "border-border bg-muted/20 hover:border-primary/40 hover:bg-accent/20 text-foreground"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description || r.prompt}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 capitalize">{r.kpi}</span>
                    <span className="text-[10px] text-muted-foreground">{r.run_count} runs</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date range + run */}
      {selectedReport && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Interpretation Settings</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((d) => ({ ...d, start: e.target.value }))}
                className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((d) => ({ ...d, end: e.target.value }))}
                className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={interpret}
              disabled={interpreting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {interpreting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Interpreting...</>
              ) : (
                <><Sparkles className="w-4 h-4" />Generate Insights</>
              )}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />{error}
            </p>
          )}
        </div>
      )}

      {/* Insights output */}
      {insights && (
        <div className="flex flex-col gap-4">

          {/* Header bar */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{insights.period_label}</p>
              {meta && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {meta.fallback ? "Demo mode — " : `Model: ${meta.model} — `}
                  {meta.row_count} rows — {format(new Date(meta.generated_at), "MMM d, yyyy h:mm a")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <ConfidenceBadge level={insights.confidence} />
              <button
                onClick={() => setShowJson((v) => !v)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border hover:border-primary/40"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {showJson ? "Hide" : "View"} JSON
              </button>
            </div>
          </div>

          {/* Summary + headline */}
          <InsightSection title="Executive Summary" icon={Sparkles}>
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
              <div className="flex-1">
                <p className="text-sm text-foreground/85 leading-relaxed">{insights.summary}</p>
              </div>
              <div className="shrink-0 sm:w-52">
                <div className="bg-primary/8 border border-primary/25 rounded-lg p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{insights.headline_metric.label}</p>
                  <p className="text-3xl font-bold text-primary mt-1">{insights.headline_metric.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{insights.headline_metric.context}</p>
                </div>
              </div>
            </div>
          </InsightSection>

          {/* Trends */}
          <InsightSection title="Key Trends" icon={TrendingUp}>
            <div className="flex flex-col gap-3">
              {insights.trends.map((t, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <TrendIcon direction={t.direction} />
                    {t.magnitude && (
                      <span className={`text-[11px] font-bold ${t.direction === "up" ? "text-chart-1" : t.direction === "down" ? "text-destructive" : "text-muted-foreground"}`}>
                        {t.magnitude}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.insight}</p>
                  </div>
                </div>
              ))}
            </div>
          </InsightSection>

          {/* Top segments */}
          <InsightSection title="Top Segments" icon={ArrowUpRight}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {insights.top_segments.map((s, i) => (
                <div key={i} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground truncate">{s.segment}</p>
                    {s.share_of_total && (
                      <span className="text-[10px] font-mono text-primary shrink-0">{s.share_of_total}</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-foreground">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{s.commentary}</p>
                </div>
              ))}
            </div>
          </InsightSection>

          {/* Alerts */}
          {insights.alerts.length > 0 && (
            <InsightSection title="Alerts & Anomalies" icon={AlertTriangle}>
              <div className="flex flex-col gap-2">
                {insights.alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
              </div>
            </InsightSection>
          )}

          {/* Opportunities */}
          <InsightSection title="Opportunities" icon={Lightbulb}>
            <ol className="flex flex-col gap-2.5">
              {insights.opportunities.map((o, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-foreground/85 leading-relaxed">{o}</p>
                </li>
              ))}
            </ol>
          </InsightSection>

          {/* Data quality notes */}
          {insights.data_quality_notes && insights.data_quality_notes.length > 0 && (
            <InsightSection title="Data Quality Notes" icon={CircleAlert}>
              <ul className="flex flex-col gap-1.5">
                {insights.data_quality_notes.map((n, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="text-chart-5 mt-0.5 shrink-0">—</span>
                    {n}
                  </li>
                ))}
              </ul>
            </InsightSection>
          )}

          {/* Raw JSON panel */}
          {showJson && <RawJsonPanel insights={insights} />}
        </div>
      )}
    </div>
  );
}
