"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  Wand2,
  Save,
  CornerDownLeft,
  Cpu,
  MessageSquareDiff,
  ShieldCheck,
} from "lucide-react";
import { ChartRenderer } from "./ChartRenderer";
import { computeAggregation } from "@/lib/bi/kpiService";
import {
  metricKey,
  metricLabel,
  type ChartType,
  type DatasetSchema,
  type Filter,
  type Metric,
} from "@/lib/bi/types";
import { createReport } from "@/lib/hooks/useBiStore";
import { FeedbackModal, type FixResult } from "./FeedbackModal";
import { AiFixPanel } from "./AiFixPanel";

interface CopilotConfig {
  metrics: Metric[];
  dimensions: string[];
  filters: Filter[];
  chart: ChartType;
  title: string;
  action: "create_visualization" | "update_visualization" | "add_filter" | "forecast" | "explain";
  explanation: string;
}

interface Props {
  dataset: DatasetSchema;
  onSaved?: () => void;
}

const EXAMPLES = [
  "Total revenue by region",
  "Average value by category last 90 days",
  "Count of records by status",
  "Revenue trend over time",
];

export function AiCopilot({ dataset, onSaved }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<CopilotConfig | null>(null);
  const [applied, setApplied] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportName, setReportName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [fixRetrying, setFixRetrying] = useState(false);

  async function ask(q?: string) {
    const text = (q ?? prompt).trim();
    if (!text) return;
    setPrompt(text);
    setLoading(true);
    setError(null);
    setConfig(null);
    setApplied(false);
    try {
      const res = await fetch("/api/bi/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, fields: dataset.fields }),
      });
      const json = await res.json();
      if (!res.ok || !json.config) {
        setError(json.error ?? "Could not interpret that request.");
        return;
      }
      setConfig(json.config as CopilotConfig);
      setFallback(Boolean(json.meta?.fallback));
      setReportName(text.charAt(0).toUpperCase() + text.slice(1));
    } catch {
      setError("Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFixRetry(fixedSQL: string) {
    // In the copilot context, the "fixedSQL" from the repair AI is a revised
    // natural-language prompt that we re-submit to /api/bi/copilot.
    setFixRetrying(true);
    setFixResult(null);
    try {
      await ask(fixedSQL);
    } finally {
      setFixRetrying(false);
    }
  }

  function handleFixResult(result: FixResult) {
    setFixResult(result);
    // If high confidence, auto-retry immediately
    if (result.autoRetry) {
      void handleFixRetry(result.fixedSQL);
    }
  }

  const result = useMemo(() => {
    if (!config || !applied) return null;
    return computeAggregation(dataset.sampleData, {
      metrics: config.metrics,
      dimensions: config.dimensions,
      filters: config.filters,
    });
  }, [applied, config, dataset.sampleData]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    (config?.metrics.length ? config.metrics : [{ agg: "count", field: null } as Metric]).forEach(
      (mm) => (m[metricKey(mm)] = metricLabel(mm))
    );
    return m;
  }, [config]);

  async function save() {
    if (!config || !reportName.trim()) return;
    setSaving(true);
    try {
      const r = await createReport({
        name: reportName.trim(),
        datasetId: dataset.id,
        metrics: config.metrics.length ? config.metrics : [{ agg: "count", field: null }],
        dimensions: config.dimensions,
        filters: config.filters,
        chart: config.chart,
      });
      if (r) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1800);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Prompt bar */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) ask();
              }}
              placeholder={`Ask about "${dataset.name}"… e.g. total revenue by region last 30 days`}
              className="w-full pl-9 pr-3 py-2.5 rounded-md bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={() => ask()}
            disabled={loading || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Generate
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              className="text-[11px] px-2 py-1 rounded-full bg-muted/50 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-destructive/10 border border-destructive/30 rounded-md px-4 py-3">
          <p className="text-xs text-destructive">{error}</p>
          <button
            onClick={() => setFeedbackOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 border border-destructive/30 px-3 py-1.5 rounded-md hover:bg-destructive/15 transition-colors shrink-0"
          >
            <MessageSquareDiff className="w-3.5 h-3.5" />
            Fix with AI
          </button>
        </div>
      )}

      {fixResult && !fixRetrying && (
        <AiFixPanel
          result={fixResult}
          originalSQL={prompt}
          retrying={fixRetrying}
          onRetry={handleFixRetry}
          onDismiss={() => setFixResult(null)}
        />
      )}

      {config && !applied && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Proposed action: {config.title || "Create visualization"}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{config.explanation}</p>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{config.action?.replaceAll("_", " ") || "create visualization"} · schema metadata only · confirmation required</p>
            </div>
            <button onClick={() => setApplied(true)} className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Apply proposal</button>
          </div>
        </div>
      )}

      {/* Result */}
      {config && result && (
        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex items-start gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary shrink-0">
              <Cpu className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground leading-relaxed">{config.explanation}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {(config.metrics.length ? config.metrics : [{ agg: "count", field: null } as Metric]).map(
                  (m, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-chart-1/15 text-chart-1 border border-chart-1/30"
                    >
                      {metricLabel(m)}
                    </span>
                  )
                )}
                {config.dimensions.map((d) => (
                  <span
                    key={d}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-chart-2/15 text-chart-2 border border-chart-2/30 font-mono"
                  >
                    {d}
                  </span>
                ))}
                {config.filters.map((f, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-chart-5/15 text-chart-5 border border-chart-5/30 font-mono"
                  >
                    {f.field} {f.op} {String(f.value)}
                  </span>
                ))}
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
                  {fallback ? "heuristic" : "AI"} · {config.chart}
                </span>
              </div>
            </div>
          </div>

          <div className="min-h-64">
            <ChartRenderer result={result} chart={config.chart} labels={labels} />
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-border/60">
            <input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Report name"
              className="flex-1 min-w-48 px-3 py-2 rounded-md bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
            <button
              onClick={save}
              disabled={!reportName.trim() || saving}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" />
              {savedFlash ? "Saved!" : "Save as Report"}
            </button>
          </div>
        </div>
      )}

      {!config && !loading && !error && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
          <CornerDownLeft className="w-3 h-3" /> Press Enter or pick an example to generate a chart
          instantly.
        </p>
      )}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        userQuery={prompt}
        generatedSQL=""
        apiError={error ?? ""}
        dbErrorLogs=""
        onFixResult={handleFixResult}
      />
    </div>
  );
}
