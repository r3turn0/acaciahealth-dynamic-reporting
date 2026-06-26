"use client";

import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Lightbulb,
  ChevronRight,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploadButton } from "@/components/ui/FileUpload";
import type { UploadedFile } from "@/components/ui/FileUpload";

export interface QueryPlan {
  sql: string;
  explanation: string;
  tables_used: string[];
  filters_applied: string[];
  kpi_detected: string | null;
  strategy: "sql" | "api_fallback";
  api_fallback_reason: string | null;
  cost_warning: string | null;
  optimized_suggestion: string | null;
  cache_hit?: boolean;
  ai_powered?: boolean;
  elapsed_ms?: number;
}

const EXAMPLE_PROMPTS = [
  "Show me patient visits by month for 2026",
  "Weekly admissions grouped by branch for the last 30 days",
  "Revenue by service line this quarter",
  "Active patient census broken down by care type",
  "Compare discharges by branch last 4 weeks",
  "Average visits per patient by discipline this month",
];

interface AskAIProps {
  onPlanReady: (plan: QueryPlan, startDate: string, endDate: string) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
}

export function AskAI({
  onPlanReady,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: AskAIProps) {
  const [prompt, setPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<UploadedFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<QueryPlan | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [prompt]);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setLastPlan(null);

    // Append attached file content to the prompt context
    const fullPrompt = attachedFile
      ? `${prompt}\n\n${attachedFile.content}`
      : prompt;

    try {
      const res = await fetch("/api/generate-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, start_date: startDate, end_date: endDate }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to generate query");
        return;
      }
      setLastPlan(json);
      onPlanReady(json, startDate, endDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      generate();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Ask AI</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
          AI Query Planner
        </span>
      </div>

      {/* Prompt input */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={2}
            placeholder='Describe the data you want, e.g. "Show me patient visits by month for 2026"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed pr-24"
          />
          <Button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            size="sm"
            className="absolute bottom-3 right-3 bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 h-7 px-3 text-xs"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {loading ? "Thinking..." : "Generate"}
          </Button>
        </div>
        {/* File attach row */}
        <div className="flex items-center gap-2">
          <FileUploadButton
            file={attachedFile}
            onFile={setAttachedFile}
          />
          {!attachedFile && (
            <span className="text-[10px] text-muted-foreground/50 select-none">
              Attach a .csv, .json, or .txt file to include in your query context · Ctrl+Enter to run
            </span>
          )}
        </div>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground font-medium">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground font-medium">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Example prompts */}
      <div>
        <p className="text-[11px] text-muted-foreground mb-2 font-medium">Example prompts</p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              className="text-[11px] px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-destructive font-medium">Query generation failed</p>
            <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Plan meta */}
      {lastPlan && !loading && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {lastPlan.ai_powered ? (
            <span className="flex items-center gap-1 text-[11px] text-primary">
              <Zap className="w-3 h-3" /> AI-powered
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lightbulb className="w-3 h-3" /> Rule-based fallback
            </span>
          )}
          {lastPlan.cache_hit && (
            <span className="text-[11px] text-muted-foreground">· Cached</span>
          )}
          {lastPlan.elapsed_ms && (
            <span className="text-[11px] text-muted-foreground">
              · {lastPlan.elapsed_ms}ms
            </span>
          )}
          {lastPlan.kpi_detected && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize">
              {lastPlan.kpi_detected}
            </span>
          )}
          {lastPlan.strategy === "api_fallback" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-chart-5/15 text-chart-5 border border-chart-5/25">
              API Fallback
            </span>
          )}
          <ChevronRight className="w-3 h-3 text-muted-foreground/50 ml-auto" />
          <span className="text-[11px] text-muted-foreground">See SQL Editor below</span>
        </div>
      )}

      {/* Cost warning */}
      {lastPlan?.cost_warning && (
        <div className="flex items-start gap-2.5 bg-chart-5/10 border border-chart-5/25 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-chart-5">Query cost warning</p>
            <p className="text-xs text-chart-5/80 mt-0.5">{lastPlan.cost_warning}</p>
            {lastPlan.optimized_suggestion && (
              <button
                onClick={() =>
                  onPlanReady(
                    { ...lastPlan, sql: lastPlan.optimized_suggestion! },
                    startDate,
                    endDate
                  )
                }
                className="mt-2 text-[11px] underline text-chart-5 hover:text-chart-5/80"
              >
                Use optimized version instead
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
