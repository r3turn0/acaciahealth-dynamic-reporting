"use client";

import { KpiIntelligenceWorkspace } from "./KpiIntelligenceWorkspace";
import { ensureKpiReportsSeeded } from "@/lib/services/seedReportsClient";

import { useState, useCallback, useRef, useEffect } from "react";
import { copyToClipboard } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { format } from "date-fns";
import type { BusinessInsights } from "@/app/api/kpi/interpret/route";
import type { SavedReport } from "@/components/studio/SavedReports";
import { FileUploadButton, type UploadedFile } from "@/components/ui/FileUpload";
import { orchestratedJson } from "@/lib/orchestration/requestRegistry";

// ── Types ────────────────────────────────────────────────────────────────────

interface InterpretMeta {
  model: string;
  row_count: number;
  sample_count: number;
  generated_at: string;
  fallback?: boolean;
}

interface FollowUpMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

// ── Simple plain-text → JSX renderer ─────────────────────────────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground/85">
      {lines.map((line, i) => {
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-primary mt-1 shrink-0">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
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

function InsightSection({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
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

function RawJsonPanel({ insights }: { insights: BusinessInsights }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(insights, null, 2);

  async function copy() {
    await copyToClipboard(json);
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
        <p className="text-xs text-muted-foreground">
          Raw object — pipe this into downstream systems, dashboards, or reports.
        </p>
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

// ── Follow-up thread ──────────────────────────────────────────────────────────

function FollowUpThread({
  insights,
  reportName,
  kpi,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  sourceFiles,
}: {
  insights: BusinessInsights;
  reportName: string;
  kpi: string;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  sourceFiles: UploadedFile[];
}) {
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const SUGGESTIONS = [
    "Which branch needs the most attention?",
    "What caused the top alert?",
    "How can we improve the lowest-performing segment?",
    "What should leadership focus on this week?",
  ];

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    if (startDate && endDate && startDate > endDate) return;

    const userMsg: FollowUpMessage = { id: Date.now().toString(), role: "user", content: question };
    const assistantId = `${Date.now()}-a`;
    const placeholder: FollowUpMessage = { id: assistantId, role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/kpi/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          insights,
          report_name: reportName,
          kpi,
          start_date: startDate,
          end_date: endDate,
          sources: sourceFiles.map((item) => item.source).filter(Boolean),
          conversation: [...messages.filter((item) => !item.streaming), userMsg].slice(-10).map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m))
        );
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Failed to get a response. Please try again.", streaming: false }
            : m
        )
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function copyMsg(content: string, id: string) {
    await copyToClipboard(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const userMessageCount = messages.filter((m) => m.role === "user").length;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <MessageSquare className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Ask Follow-Up Questions</h3>
        {messages.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">
              {userMessageCount} question{userMessageCount !== 1 ? "s" : ""} asked
            </span>
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-2.5 border-b border-border bg-muted/10">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 text-primary" /> Date range
        </span>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">From</span>
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">To</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </label>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Suggestion chips — always visible when no messages */}
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded-full px-3 py-1 transition-colors bg-muted/30 hover:bg-primary/5 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Message thread */}
        {messages.length > 0 && (
          <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-primary text-primary-foreground text-sm leading-relaxed">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[95%] rounded-xl px-4 py-3 bg-muted border border-border flex flex-col gap-2">
                    {m.streaming && !m.content ? (
                      <span className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Thinking...
                      </span>
                    ) : (
                      <>
                        <SimpleMarkdown text={m.content} />
                        {!m.streaming && (
                          <button
                            onClick={() => copyMsg(m.content, m.id)}
                            className="self-end flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1"
                          >
                            <Copy className="w-3 h-3" />
                            {copiedId === m.id ? "Copied!" : "Copy"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-center mt-1">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask a follow-up question about this report..."
            disabled={loading}
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
          />
          <button
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            aria-label="Send"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface KpiInterpreterProps {
  /** When set, auto-loads reports and pre-selects the first report matching this KPI key */
  preselectedKpi?: string | null;
  /** When set, auto-selects the report whose name matches exactly (takes priority over preselectedKpi) */
  preselectedReportName?: string | null;
}

export function KpiInterpreter({ preselectedKpi, preselectedReportName }: KpiInterpreterProps = {}) {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [search, setSearch] = useState("");
  const [filterKpi, setFilterKpi] = useState("all");
  const [dateRange, setDateRange] = useState(() => {
    if (typeof window === "undefined") return { start: "", end: "" };
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  });
  const [interpreting, setInterpreting] = useState(false);
  const [interpretStage, setInterpretStage] = useState<string>("");
  const [insights, setInsights] = useState<BusinessInsights | null>(null);
  const [meta, setMeta] = useState<InterpretMeta | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable ref so interpret() can be called from effects without being a dep
  const interpretRef = useRef<(() => Promise<void>) | null>(null);

  const loadReports = useCallback(async (autoSelectKpi?: string) => {
    setLoadingReports(true);
    try {
      // Idempotent seed: populates SQL library reports if not yet present.
      await ensureKpiReportsSeeded().catch(() => {});
      const res = await fetch("/api/reports");
      const json = await res.json();
      const loaded: SavedReport[] = json.reports ?? [];
      setReports(loaded);
      // Auto-select first matching report when a KPI is pre-selected
      const kpiToMatch = autoSelectKpi;
      if (kpiToMatch) {
        const match = loaded.find((r) => r.kpi === kpiToMatch);
        if (match) {
          setSelectedReport(match);
          setInsights(null);
          // Interpretation will auto-trigger via the selectedReport effect below
        }
      }
    } catch {
      setError("Failed to load saved reports.");
    } finally {
      setLoadingReports(false);
    }
  }, []);

  // Auto-load reports on first mount so the selector is immediately populated
  // without requiring a manual button click.
  useEffect(() => {
    loadReports();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When preselectedKpi changes (user clicked a KPI card in another tab),
  // auto-load reports and highlight the matching report.
  useEffect(() => {
    if (!preselectedKpi) return;
    if (reports) {
      // Reports already loaded — just update selection
      const match = reports.find((r) => r.kpi === preselectedKpi);
      if (match) {
        setSelectedReport(match);
        setInsights(null);
        // Interpretation will auto-trigger via the selectedReport effect below
      }
    } else {
      // Reports not yet loaded — load with auto-selection
      loadReports(preselectedKpi);
    }
  }, [preselectedKpi]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a specific report name is pre-selected (e.g. from a dashboard pin),
  // find and select it by name — takes priority over preselectedKpi.
  useEffect(() => {
    if (!preselectedReportName) return;
    if (reports) {
      const match = reports.find(
        (r) => r.name.toLowerCase() === preselectedReportName.toLowerCase()
      );
      if (match) {
        setSelectedReport(match);
        setInsights(null);
      }
    } else {
      // Reports not yet loaded — load first, then select by name
      loadReports();
    }
  }, [preselectedReportName]); // eslint-disable-line react-hooks/exhaustive-deps

  // When reports finish loading and we have a pending preselectedReportName, select it
  useEffect(() => {
    if (!preselectedReportName || !reports) return;
    const match = reports.find(
      (r) => r.name.toLowerCase() === preselectedReportName.toLowerCase()
    );
    if (match && selectedReport?.name !== match.name) {
      setSelectedReport(match);
      setInsights(null);
    }
  }, [reports]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run interpretation whenever the selected report changes (and we have dates)
  useEffect(() => {
    if (!selectedReport) return;
    // Use the ref so we always call the latest version of interpret()
    // without adding it as a dep (avoids infinite loop)
    const timer = setTimeout(() => {
      interpretRef.current?.();
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedReport?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived filter
  const allKpis = reports
    ? Array.from(new Set(reports.map((r) => r.kpi).filter(Boolean))).sort()
    : [];

  const filteredReports = (reports ?? []).filter((r) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.kpi?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q);
    const matchesKpi = filterKpi === "all" || r.kpi === filterKpi;
    return matchesSearch && matchesKpi;
  });

  async function interpret() {
    if (!selectedReport) return;
    setInterpreting(true);
    setInsights(null);
    setMeta(null);
    setError(null);
    setInterpretStage("Executing validated supporting reports and normalizing sources...");

    try {
      const intRes = await fetch("/api/kpi/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_name: selectedReport.name,
          kpi: selectedReport.kpi,
          start_date: dateRange.start,
          end_date: dateRange.end,
          sources: uploadedFiles.map((item) => item.source).filter(Boolean),
        }),
      });
      const intJson = await intRes.json();
      if (!intRes.ok) throw new Error(intJson.error ?? "No evidence-grounded interpretation was returned.");
      if (!intJson.insights) throw new Error("No supported findings were returned.");
      setInsights(intJson.insights);
      setMeta(intJson.meta);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interpretation failed. Please try again.");
    } finally {
      setInterpreting(false);
      setInterpretStage("");
    }
  }

  // Keep ref in sync so the auto-trigger effect always calls the latest closure
  interpretRef.current = interpret;

  // ── Empty state ─────────���──────────────────────────────────────────────────

  if (!reports) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Loading reports…</p>
          <p className="text-xs text-muted-foreground mt-1">Fetching your saved report library.</p>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────���─────────────────────���───────

  return (
    <div className="flex flex-col gap-5">

      <KpiIntelligenceWorkspace />

      {/* Report selector */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Select a Report to Interpret</h3>
          <button
            onClick={() => loadReports()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2.5">
          <FileUploadButton
            file={uploadedFiles[0] ?? null}
            onFile={(next) => { if (!next) setUploadedFiles([]); }}
            onFiles={setUploadedFiles}
            multiple
          />
          <p className="text-xs text-muted-foreground">
            Optional: combine up to 8 CSV, JSON, text, Excel, Word, or PDF sources with governed report evidence.
          </p>
          {uploadedFiles.length > 1 && <span className="text-xs font-medium text-primary">{uploadedFiles.length} files normalized</span>}
        </div>

        {/* Search + KPI filter */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search reports..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-muted border border-border rounded-md pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {allKpis.length > 1 && (
            <select
              value={filterKpi}
              onChange={(e) => setFilterKpi(e.target.value)}
              className="bg-muted border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All KPIs</option>
              {allKpis.map((k) => (
                <option key={k} value={k} className="capitalize">{k}</option>
              ))}
            </select>
          )}
        </div>

        {reports.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No saved reports found. Create one in Report Studio first.
          </p>
        ) : filteredReports.length === 0 ? (
          <div className="flex items-center justify-between py-4 px-2">
            <p className="text-xs text-muted-foreground">No reports match your search.</p>
            <button
              onClick={() => { setSearch(""); setFilterKpi("all"); }}
              className="text-xs text-primary hover:text-primary/80 underline underline-offset-2"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredReports.map((r) => (
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
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {r.description || r.prompt}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 capitalize">
                      {r.kpi}
                    </span>
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
                <><Sparkles className="w-4 h-4" />Re-run Insights</>
              )}
            </button>
          </div>
          {interpreting && interpretStage && (
            <div className="mt-3 flex items-center gap-2 text-xs text-primary">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{interpretStage}</span>
            </div>
          )}
          {error && (
            <p className="mt-3 text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />{error}
            </p>
          )}
        </div>
      )}

      {/* Interpreting spinner — shown between report selection and insights appearing */}
      {interpreting && !insights && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">{interpretStage || "Generating insights..."}</p>
          <p className="text-xs text-muted-foreground">Running the report query and analysing with AI</p>
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
              {insights.headline_metric && (
                <div className="shrink-0 sm:w-52">
                  <div className="bg-primary/8 border border-primary/25 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                      {insights.headline_metric.label}
                    </p>
                    <p className="text-3xl font-bold text-primary mt-1">{insights.headline_metric.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      {insights.headline_metric.context}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </InsightSection>

          {/* Trends */}
          <InsightSection title="Key Trends" icon={TrendingUp}>
            <div className="flex flex-col gap-3">
              {(insights.trends ?? []).map((t, i) => (
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
              {(insights.top_segments ?? []).map((s, i) => (
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
          {(insights.alerts ?? []).length > 0 && (
            <InsightSection title="Alerts & Anomalies" icon={AlertTriangle}>
              <div className="flex flex-col gap-2">
                {(insights.alerts ?? []).map((a, i) => <AlertCard key={i} alert={a} />)}
              </div>
            </InsightSection>
          )}

          {/* Opportunities */}
          <InsightSection title="Opportunities" icon={Lightbulb}>
            <ol className="flex flex-col gap-2.5">
              {(insights.opportunities ?? []).map((o, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                <p className="text-sm text-foreground/85 leading-relaxed">{o.statement}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{o.citation_ids.join(", ")}</p>
              </div>
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

          {/* Follow-up questions */}
          <FollowUpThread
            insights={insights}
            reportName={selectedReport?.name ?? ""}
            kpi={selectedReport?.kpi ?? ""}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onStartDateChange={(d) => setDateRange((r) => ({ ...r, start: d }))}
        onEndDateChange={(d) => setDateRange((r) => ({ ...r, end: d }))}
        sourceFiles={uploadedFiles}
      />
        </div>
      )}
    </div>
  );
}
