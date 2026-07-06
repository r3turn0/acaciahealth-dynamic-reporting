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
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import type { ReportResult } from "./ResultsTable";
import type { AnalyticsResponse, AnalyticsDataset } from "@/app/api/analytics/query/route";

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

// ── Message bubble ────────────────────────────────────────────────────────────

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

  const dataset = toDataset(result);

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
      const json: AnalyticsResponse = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", error: (json as unknown as { error?: string }).error ?? "Request failed" },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: json.response.text ?? json.response.type, analytics: json },
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
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Ask about this data</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary font-medium">
            Analytics Engine
          </span>
          {messages.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {messages.filter((m) => m.role === "user").length} question{messages.filter((m) => m.role === "user").length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && open && (
            <button
              onClick={(e) => { e.stopPropagation(); setMessages([]); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Clear conversation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Panel body */}
      {open && (
        <div className="flex flex-col gap-0 border-t border-border">
          {/* Conversation thread */}
          <div className="flex flex-col gap-3 px-4 py-4 max-h-[480px] overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask analytical questions about the <span className="font-medium text-foreground">{result.summary.row_count.toLocaleString()} rows</span> returned.
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
