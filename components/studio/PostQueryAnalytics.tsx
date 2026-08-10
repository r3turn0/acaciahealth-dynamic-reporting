"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  BrainCircuit,
  BarChart2,
  Table2,
  FileText,
  Target,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  AlertTriangle,
  TrendingUp,
  ShieldCheck,
  Activity,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import type { ReportResult } from "./ResultsTable";
import {
  getAnalyticsError,
  isAnalyticsResponse,
  type AnalyticsDataset,
  type AnalyticsResponse,
} from "@/lib/contracts/analytics";

// ── Suggestion chips ──────────────────────────────────────────────────────────

const BASE_SUGGESTIONS = [
  "Show top 5 by highest value",
  "Summarize the dataset",
  "Sort by descending order",
  "Which has the lowest count?",
  "Group and total by category",
];

// ── Colour palette ────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// ── Helper: convert ReportResult → AnalyticsDataset ──────────────────────────

function toDataset(result: ReportResult): AnalyticsDataset {
  const { columns } = result.summary;
  const rows = result.data.map((row) =>
    columns.map((c) => {
      const v = row[c];
      if (typeof v === "number") return v;
      if (v === null || v === undefined) return null;
      return String(v);
    })
  );
  return { columns, rows };
}

// ── Response type icon ────────────────────────────────────────────────────────

function ResponseTypeIcon({ type }: { type: AnalyticsResponse["response"]["type"] }) {
  const cls = "w-3.5 h-3.5";
  switch (type) {
    case "CHART":        return <BarChart2 className={cls} />;
    case "TABLE":        return <Table2 className={cls} />;
    case "SUMMARY_TEXT": return <FileText className={cls} />;
    case "KPI":          return <Target className={cls} />;
    case "CLARIFICATION":return <HelpCircle className={cls} />;
    default:             return null;
  }
}

// ── Result renderers ──────────────────────────────────────────────────────────

function TableResult({ data, columns }: { data: Record<string, unknown>[]; columns?: string[] }) {
  const cols = columns ?? (data.length ? Object.keys(data[0]) : []);
  if (!data.length) return <p className="text-xs text-muted-foreground">No results.</p>;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/40 border-b border-border">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {String(c).replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              {cols.map((c) => {
                const v = row[c];
                const isNum = typeof v === "number";
                return (
                  <td key={c} className={`px-3 py-2 ${isNum ? "tabular-nums font-medium text-foreground" : "text-foreground"}`}>
                    {v != null ? (isNum ? (v as number).toLocaleString() : String(v)) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartResult({ response }: { response: AnalyticsResponse["response"] }) {
  const { data = [], presentation, columns } = response;
  if (!data.length) return <p className="text-xs text-muted-foreground">No chart data.</p>;

  const chartType = presentation?.chartType ?? "bar";
  const xKey = presentation?.xAxis ?? (columns?.[0] ?? Object.keys(data[0])[0]);
  const yKey = presentation?.yAxis ?? (columns?.[1] ?? Object.keys(data[0])[1]);

  const config = {
    [yKey]: { label: String(yKey).replace(/_/g, " "), color: "var(--chart-1)" },
  };

  if (chartType === "pie") {
    return (
      <ChartContainer config={config} className="h-52 w-full">
        <PieChart>
          <Pie data={data} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={80} label>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: "10px" }} />
          <Tooltip content={<ChartTooltipContent />} />
        </PieChart>
      </ChartContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ChartContainer config={config} className="h-52 w-full">
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
          <Tooltip content={<ChartTooltipContent />} />
          <Line dataKey={yKey} stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartContainer>
    );
  }

  // Default: bar
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <BarChart data={data} margin={{ top: 4, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function EvidencePanel({ intelligence }: { intelligence: NonNullable<AnalyticsResponse["intelligence"]> }) {
  const [showTrace, setShowTrace] = useState(false);
  const notableFindings = intelligence.findings.filter((finding) => finding.type !== "KPI").slice(0, 4);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="Analytical evidence">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-background p-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Confidence</p><p className="mt-1 text-lg font-semibold capitalize text-foreground">{intelligence.confidence.level}</p><p className="text-[10px] text-muted-foreground">{Math.round(intelligence.confidence.score * 100)}% evidence score</p></div>
        <div className="rounded-md border border-border bg-background p-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Quality</p><p className="mt-1 text-lg font-semibold text-foreground">{Math.round(intelligence.quality.score * 100)}%</p><p className="text-[10px] text-muted-foreground">{intelligence.quality.completeness * 100}% complete</p></div>
        <div className="rounded-md border border-border bg-background p-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</p><p className="mt-1 text-lg font-semibold text-foreground">{intelligence.findings.length}</p><p className="text-[10px] text-muted-foreground">validated findings</p></div>
        <div className="rounded-md border border-border bg-background p-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rows</p><p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{intelligence.quality.rowCount.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">analyzed locally</p></div>
      </div>

      {intelligence.quality.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /><div><p className="font-medium">Decision-use warning</p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{intelligence.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>
      )}

      {notableFindings.length > 0 && <div className="flex flex-col gap-2"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Executive findings</p>{notableFindings.map((finding) => <article key={finding.id} className="rounded-md border border-border bg-background p-3"><div className="flex items-start gap-2">{finding.type === "TREND" ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" /> : finding.type === "ANOMALY" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />}<div><h4 className="text-xs font-semibold text-foreground">{finding.title}</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{finding.summary}</p><p className="mt-1 text-[10px] text-muted-foreground">Evidence: {finding.evidence.join(" · ")}</p></div></div></article>)}</div>}

      {intelligence.forecast && <div className="rounded-md border border-border bg-background p-3"><div className="flex items-center gap-2"><TrendingUp className="size-4 text-primary" /><p className="text-xs font-semibold text-foreground">Conservative forecast</p><span className="rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">{intelligence.forecast.reliability} reliability</span></div><p className="mt-1 text-xs text-muted-foreground">{intelligence.forecast.metric.replace(/_/g, " ")} is projected {intelligence.forecast.direction} to {intelligence.forecast.projectedValue.toLocaleString()} for the {intelligence.forecast.horizon} using a linear trend.</p></div>}

      <div className="flex flex-col gap-2"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recommended actions</p><ul className="list-disc pl-4 text-xs leading-relaxed text-muted-foreground">{intelligence.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ul></div>

      <button type="button" onClick={() => setShowTrace((value) => !value)} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground" aria-expanded={showTrace}><span className="flex items-center gap-2"><Activity className="size-4 text-primary" />Analysis trace</span>{showTrace ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
      {showTrace && <ol className="flex flex-col gap-2 border-l border-border pl-3">{intelligence.trace.map((step) => <li key={step.stage} className="text-xs"><span className="font-medium text-foreground">{step.stage}</span><span className="ml-2 text-muted-foreground">{step.detail}</span></li>)}</ol>}
    </section>
  );
}

function KpiResult({ data, columns }: { data: Record<string, unknown>[]; columns?: string[] }) {
  const cols = columns ?? (data.length ? Object.keys(data[0]) : []);
  return (
    <div className="flex flex-wrap gap-3">
      {data.slice(0, 6).map((row, i) => (
        <div key={i} className="flex-1 min-w-[120px] bg-primary/8 border border-primary/20 rounded-lg px-4 py-3 text-center">
          {cols.map((c) => {
            const v = row[c];
            const isNum = typeof v === "number";
            return (
              <div key={c}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">{String(c).replace(/_/g, " ")}</p>
                <p className={`font-bold text-primary ${isNum ? "text-xl" : "text-sm"}`}>
                  {v != null ? (isNum ? (v as number).toLocaleString() : String(v)) : "—"}
                </p>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────����─────────�����──────

interface Message {
  role: "user" | "assistant";
  content: string;
  analytics?: AnalyticsResponse;
  error?: string;
}

function AssistantBubble({ msg, onClarify }: { msg: Message; onClarify: (opt: string) => void }) {
  const [showSteps, setShowSteps] = useState(false);
  const { analytics } = msg;

  if (!analytics) {
    return (
      <div className="bg-destructive/10 border border-destructive/25 rounded-lg px-3 py-2.5 text-xs text-destructive">
        {msg.error ?? "An error occurred."}
      </div>
    );
  }

  const { response, transformation, metadata } = analytics;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Response type badge row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ResponseTypeIcon type={response.type} />
          <span className="font-medium">{response.type}</span>
          {metadata?.confidence != null && (
            <span className="ml-1 opacity-60">· {Math.round(metadata.confidence * 100)}% confidence</span>
          )}
          {metadata?.fallback && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
              Local engine
            </span>
          )}
        </div>
        {(transformation?.steps?.length ?? 0) > 0 && (
          <button
            onClick={() => setShowSteps((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Steps
            {showSteps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Transformation steps */}
      {showSteps && (transformation?.steps?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1 bg-muted/40 border border-border rounded px-3 py-2">
          {(transformation?.steps ?? []).map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
              <span className="text-primary/60">{i + 1}.</span>
              {step}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {response.type === "SUMMARY_TEXT" && response.text && (
        <p className="text-sm text-foreground/90 leading-relaxed">{response.text}</p>
      )}

      {response.type === "TABLE" && (response.data?.length ?? 0) > 0 && (
        <TableResult data={response.data!} columns={response.columns} />
      )}

      {response.type === "CHART" && (response.data?.length ?? 0) > 0 && (
        <ChartResult response={response} />
      )}

      {response.type === "KPI" && (response.data?.length ?? 0) > 0 && (
        <KpiResult data={response.data!} columns={response.columns} />
      )}

      {analytics.intelligence && <EvidencePanel intelligence={analytics.intelligence} />}

      {response.type === "CLARIFICATION" && analytics.clarification && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground/90">{analytics.clarification.question}</p>
          {analytics.clarification.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {analytics.clarification.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onClarify(opt)}
                  className="text-xs px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PostQueryAnalyticsProps {
  result: ReportResult;
}

export function PostQueryAnalytics({ result }: PostQueryAnalyticsProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const selectedSet = result.result_sets?.[selectedResultIndex];
  const activeResult: ReportResult = selectedSet
    ? {
        ...result,
        report_name: selectedSet.name ?? `Result Set ${selectedResultIndex + 1}`,
        data: selectedSet.rows,
        result_sets: undefined,
        governance: selectedSet.governance,
        summary: { row_count: selectedSet.rowCount, columns: selectedSet.columns },
      }
    : result;
  const dataset = toDataset(activeResult);

  const sendQuestion = useCallback(async (question: string) => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    // Build history for context (last 6 turns, text-only)
    const history = messages
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: m.role === "assistant"
          ? (m.analytics?.response.text ?? m.analytics?.response.type ?? "")
          : m.content,
      }))
      .filter((m) => m.content);

    try {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, question: q, history }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", error: getAnalyticsError(payload) },
        ]);
        return;
      }
      if (!isAnalyticsResponse(payload)) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", error: "The analytics service returned an invalid response. Please try again." },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: payload.response.text ?? payload.response.type, analytics: payload },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          error: err instanceof Error ? err.message : "Network error",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [dataset, loading, messages]);

  const suggestions = BASE_SUGGESTIONS.filter((s) => {
    // Only show suggestions that make sense for the dataset
    const hasNum = dataset.columns.some((c) =>
      dataset.rows.some((r) => typeof r[dataset.columns.indexOf(c)] === "number")
    );
    if (!hasNum && s.includes("value")) return false;
    return true;
  }).slice(0, 4);

  return (
    <div className="flex flex-col gap-0 border border-border rounded-lg overflow-hidden">
      {/* Header controls */}
      <div className="flex items-center bg-card hover:bg-muted/40 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center justify-between px-4 py-3 text-left"
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-2">
            <BrainCircuit className="w-4 h-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Ask about this data</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary font-medium">
              Analytics Engine
            </span>
            {messages.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {messages.filter((m) => m.role === "user").length} question{messages.filter((m) => m.role === "user").length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
          {open
            ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          }
        </button>
        {messages.length > 0 && open && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="mr-3 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Panel body */}
      {open && (
        <div className="flex flex-col gap-0 border-t border-border">
          {(result.result_sets?.length ?? 0) > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3" role="group" aria-label="Dataset to analyze">
              <span className="text-[11px] font-medium text-muted-foreground">Analyze dataset:</span>
              {result.result_sets?.map((resultSet, index) => (
                <button
                  key={`${resultSet.name ?? "result"}-${index}`}
                  type="button"
                  onClick={() => {
                    setSelectedResultIndex(index);
                    setMessages([]);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${selectedResultIndex === index ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={selectedResultIndex === index}
                >
                  {resultSet.name ?? `Result Set ${index + 1}`} ({resultSet.rowCount.toLocaleString()})
                </button>
              ))}
            </div>
          )}
          {/* Conversation thread */}
          <div className="flex flex-col gap-3 px-4 py-4 max-h-[480px] overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask analytical questions about <span className="font-medium text-foreground">{activeResult.report_name}</span> and its <span className="font-medium text-foreground">{activeResult.summary.row_count.toLocaleString()} rows</span>.
                  The engine groups, filters, ranks, and summarizes data without running new queries.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendQuestion(s)}
                      className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {msg.role === "user" ? (
                  <div className="bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%]">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-muted/50 border border-border rounded-xl rounded-tl-sm px-3 py-2.5 w-full max-w-[95%]">
                    <AssistantBubble msg={msg} onClarify={(opt) => sendQuestion(opt)} />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                Analyzing dataset...
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendQuestion(input);
                }
              }}
              placeholder="Ask a question about this dataset..."
              rows={1}
              className="flex-1 resize-none bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              style={{ minHeight: "38px", maxHeight: "100px" }}
            />
            <button
              onClick={() => sendQuestion(input)}
              disabled={!input.trim() || loading}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
