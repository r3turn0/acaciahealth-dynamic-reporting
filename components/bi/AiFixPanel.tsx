"use client";

import { useState } from "react";
import {
  Wand2,
  CheckCircle2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Cpu,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FixResult } from "./FeedbackModal";

interface Props {
  result: FixResult & { tier?: "deterministic" | "ai_fallback" | "failed" };
  originalSQL: string;
  retrying: boolean;
  onRetry: (fixedSQL: string) => void;
  onDismiss: () => void;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  column_fix: "Column",
  table_fix: "Table",
  syntax_fix: "Syntax",
  join_fix: "Join",
  filter_fix: "Filter",
  function_fix: "Function",
  schema_prefix: "Schema",
  other: "Other",
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  column_fix: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  table_fix: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  syntax_fix: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  join_fix: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  filter_fix: "bg-primary/15 text-primary border-primary/30",
  function_fix: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  schema_prefix: "bg-muted text-muted-foreground border-border",
  other: "bg-muted text-muted-foreground border-border",
};

export function AiFixPanel({ result, originalSQL, retrying, onRetry, onDismiss }: Props) {
  const [showDiff, setShowDiff] = useState(true);
  const [copied, setCopied] = useState(false);

  const confidencePct = Math.round(result.confidence * 100);
  const confidenceColor =
    result.confidence >= 0.9
      ? "text-chart-3"
      : result.confidence >= 0.7
      ? "text-chart-4"
      : "text-destructive";

  async function copySQL() {
    await navigator.clipboard.writeText(result.fixedSQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15 text-primary shrink-0">
          <Wand2 className="w-4 h-4" />
        </span>
        <span className="text-sm font-semibold text-foreground">AI Fix Suggested</span>

        {/* Confidence badge */}
        <span
          className={cn(
            "flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
            result.confidence >= 0.9
              ? "bg-chart-3/15 text-chart-3 border-chart-3/30"
              : result.confidence >= 0.7
              ? "bg-chart-4/15 text-chart-4 border-chart-4/30"
              : "bg-destructive/15 text-destructive border-destructive/30"
          )}
        >
          {result.confidence >= 0.9 ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <AlertCircle className="w-3 h-3" />
          )}
          {confidencePct}% confidence
        </span>

        {result.tier === "deterministic" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-chart-3/15 text-chart-3 border border-chart-3/30 font-medium">
            deterministic
          </span>
        )}
        {result.tier === "ai_fallback" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 font-medium">
            ai fallback
          </span>
        )}
        {!result.tier && result.meta?.fallback && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            heuristic
          </span>
        )}

        <button
          onClick={onDismiss}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Explanation */}
      <p className="text-sm text-foreground leading-relaxed">{result.explanation}</p>

      {/* Change badges */}
      {result.changes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.changes.map((c, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border font-medium",
                CHANGE_TYPE_COLORS[c.type] ?? CHANGE_TYPE_COLORS.other
              )}
              title={c.reason}
            >
              <span className="opacity-70">{CHANGE_TYPE_LABELS[c.type] ?? c.type}:</span>
              <code className="line-through opacity-60">{c.from}</code>
              <ArrowRight className="w-2.5 h-2.5 shrink-0" />
              <code className="font-semibold">{c.to}</code>
            </span>
          ))}
        </div>
      )}

      {/* SQL Diff viewer */}
      <div className="flex flex-col gap-1">
        <button
          onClick={() => setShowDiff((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Cpu className="w-3.5 h-3.5" />
          SQL diff
          {showDiff ? (
            <ChevronDown className="w-3 h-3 ml-auto" />
          ) : (
            <ChevronRight className="w-3 h-3 ml-auto" />
          )}
        </button>

        {showDiff && (
          <div className="rounded-lg border border-border overflow-hidden text-[11px] font-mono">
            {/* Original */}
            <div className="bg-destructive/5 border-b border-border/60">
              <div className="px-3 py-1 text-[10px] text-destructive/70 font-sans font-medium bg-destructive/10 border-b border-destructive/15">
                — original
              </div>
              <SqlDiffBlock sql={originalSQL} variant="removed" fixedSQL={result.fixedSQL} />
            </div>
            {/* Fixed */}
            <div className="bg-chart-3/5">
              <div className="flex items-center justify-between px-3 py-1 text-[10px] text-chart-3/70 font-sans font-medium bg-chart-3/10 border-b border-chart-3/15">
                <span>+ fixed</span>
                <button
                  onClick={copySQL}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-chart-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <SqlDiffBlock sql={result.fixedSQL} variant="added" originalSQL={originalSQL} />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {result.autoRetry && (
          <span className="text-[10px] text-chart-3 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            High confidence — ready to retry
          </span>
        )}
        <button
          onClick={() => onRetry(result.fixedSQL)}
          disabled={retrying}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ml-auto",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {retrying ? (
            <>
              <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              Retrying…
            </>
          ) : (
            <>
              <RotateCcw className="w-4 h-4" />
              Retry with fixed SQL
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── SQL diff block: highlights tokens that differ between original and fixed ──

function SqlDiffBlock({
  sql,
  variant,
  fixedSQL,
  originalSQL,
}: {
  sql: string;
  variant: "added" | "removed";
  fixedSQL?: string;
  originalSQL?: string;
}) {
  const other = variant === "added" ? (originalSQL ?? "") : (fixedSQL ?? "");
  const tokens = tokenizeSQL(sql);
  const otherTokens = new Set(tokenizeSQL(other).map((t) => t.toLowerCase()));

  return (
    <pre className="px-3 py-2.5 overflow-x-auto whitespace-pre-wrap leading-relaxed text-foreground/90">
      {tokens.map((token, i) => {
        const isChanged =
          token.trim().length > 1 && !otherTokens.has(token.toLowerCase());
        if (isChanged) {
          return (
            <mark
              key={i}
              className={cn(
                "rounded px-0.5",
                variant === "removed"
                  ? "bg-destructive/30 text-destructive"
                  : "bg-chart-3/30 text-chart-3"
              )}
            >
              {token}
            </mark>
          );
        }
        return <span key={i}>{token}</span>;
      })}
    </pre>
  );
}

function tokenizeSQL(sql: string): string[] {
  // Split on word boundaries while preserving whitespace as separate tokens
  return sql.split(/(\s+|[(),;])/);
}
