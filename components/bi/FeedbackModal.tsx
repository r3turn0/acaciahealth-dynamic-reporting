"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  AlertTriangle,
  Database,
  Code2,
  Wand2,
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FeedbackPayload {
  userQuery: string;
  generatedSQL: string;
  apiError: string;
  dbErrorLogs: string;
  userFeedback: string;
  metadata?: unknown;
}

export interface FixResult {
  fixedSQL: string;
  explanation: string;
  confidence: number;
  autoRetry: boolean;
  changes: {
    type: string;
    from: string;
    to: string;
    reason?: string;
  }[];
  meta?: { model: string; fallback?: boolean };
}

interface Props {
  open: boolean;
  onClose: () => void;
  userQuery: string;
  generatedSQL: string;
  apiError: string;
  dbErrorLogs: string;
  onFixResult: (result: FixResult) => void;
}

export function FeedbackModal({
  open,
  onClose,
  userQuery,
  generatedSQL,
  apiError,
  dbErrorLogs,
  onFixResult,
}: Props) {
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSQL, setShowSQL] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state whenever modal opens
  useEffect(() => {
    if (open) {
      setFeedback("");
      setError(null);
      setShowSQL(false);
      setShowLogs(false);
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [open]);

  // Trap focus & handle Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleFix() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fix-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuery,
          generatedSQL,
          apiError,
          dbErrorLogs,
          userFeedback: feedback.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.fixedSQL) {
        setError(json.error ?? "AI could not produce a fix. Review the error manually.");
        return;
      }
      onFixResult(json as FixResult);
      onClose();
    } catch {
      setError("Request failed. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-destructive/15 text-destructive shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="feedback-modal-title" className="text-sm font-semibold text-foreground">
              Query Error — Fix with AI
            </h2>
            {userQuery && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                &quot;{userQuery}&quot;
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
          {/* API error banner */}
          {apiError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/8 border border-destructive/25">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
              <span className="text-xs text-destructive font-medium leading-relaxed">{apiError}</span>
            </div>
          )}

          {/* DB error logs — collapsible */}
          {dbErrorLogs && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setShowLogs((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                Database error logs
                {showLogs ? (
                  <ChevronDown className="w-3 h-3 ml-auto" />
                ) : (
                  <ChevronRight className="w-3 h-3 ml-auto" />
                )}
              </button>
              {showLogs && (
                <pre className="text-[11px] font-mono text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {dbErrorLogs}
                </pre>
              )}
            </div>
          )}

          {/* Generated SQL — collapsible */}
          {generatedSQL && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setShowSQL((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Code2 className="w-3.5 h-3.5" />
                Generated SQL
                {showSQL ? (
                  <ChevronDown className="w-3 h-3 ml-auto" />
                ) : (
                  <ChevronRight className="w-3 h-3 ml-auto" />
                )}
              </button>
              {showSQL && (
                <pre className="text-[11px] font-mono text-foreground bg-muted/60 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {generatedSQL}
                </pre>
              )}
            </div>
          )}

          {/* User feedback textarea */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="feedback-textarea"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"
            >
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              Your notes (optional but helpful)
            </label>
            <textarea
              ref={textareaRef}
              id="feedback-textarea"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. The column name might be wrong, or the table needs a schema prefix…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:border-primary transition-colors leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground/70">
              The AI will use the full schema metadata file to cross-reference your query against
              actual table and column names.
            </p>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleFix}
            disabled={loading}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Fix with AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
