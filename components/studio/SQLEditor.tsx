"use client";

import { useState, useEffect, useRef } from "react";
import { Code2, Play, Loader2, ShieldCheck, ShieldX, Copy, Check, Lock, Unlock, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { fetchWithTimeout } from "@/lib/client/fetchWithTimeout";

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface SQLEditorProps {
  sql: string;
  onChange: (sql: string) => void;
  onRun: () => void;
  loading: boolean;
  startDate: string;
  endDate: string;
  /** When true the textarea is locked; user cannot type */
  locked?: boolean;
  /** Called when the user toggles the lock button */
  onToggleLock?: (locked: boolean) => void;
  /** When true, shows a dirty indicator showing user has edited beyond the AI version */
  dirty?: boolean;
}

export function SQLEditor({
  sql,
  onChange,
  onRun,
  loading,
  startDate,
  endDate,
  locked = false,
  onToggleLock,
  dirty = false,
}: SQLEditorProps) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [copied, setCopied] = useState(false);
  const validationRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const validationRequestIdRef = useRef(0);

  // Validate on SQL change (debounced). Every new edit cancels the stale request.
  useEffect(() => {
    validationRequestRef.current?.controller.abort();
    if (!sql.trim()) {
      validationRequestRef.current = null;
      setValidation(null);
      setValidating(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++validationRequestIdRef.current;
    validationRequestRef.current = { controller, id: requestId };
    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout("/api/generate-query/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
          signal: controller.signal,
          timeoutMs: 8_000,
        });
        if (res.ok && validationRequestRef.current?.id === requestId) {
          const data = await res.json();
          setValidation(data);
        }
      } catch {
        // Inline validation is advisory; execution still returns actionable errors.
      } finally {
        if (validationRequestRef.current?.id === requestId) {
          validationRequestRef.current = null;
          setValidating(false);
        }
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sql]);

  async function copySQL() {
    await copyToClipboard(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function toggleLock() {
    onToggleLock?.(!locked);
  }

  const lineCount = sql.split("\n").length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">SQL Editor</h3>
          <span className="text-[10px] text-muted-foreground">
            {lineCount} line{lineCount !== 1 ? "s" : ""}
          </span>
          {/* Dirty indicator */}
          {dirty && !locked && (
            <span className="flex items-center gap-1 text-[10px] text-chart-4 font-medium">
              <PenLine className="w-3 h-3" />
              Edited
            </span>
          )}
          {/* Lock state pill */}
          {locked ? (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20 font-medium">
              <Lock className="w-2.5 h-2.5" />
              Locked
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-chart-3/10 text-chart-3 border border-chart-3/20 font-medium">
              <Unlock className="w-2.5 h-2.5" />
              Editable
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Validation indicator */}
          {validating && (
            <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          )}
          {!validating && validation && (
            <div className="flex items-center gap-1.5">
              {validation.valid ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-chart-3" />
                  <span className="text-[11px] text-chart-3 font-medium">Valid</span>
                </>
              ) : (
                <>
                  <ShieldX className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-[11px] text-destructive font-medium">
                    {validation.errors.length} issue{validation.errors.length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
          )}
          {/* Copy */}
          <button
            onClick={copySQL}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Copy SQL"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-chart-3" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
          {/* Lock toggle */}
          {onToggleLock && (
            <button
              onClick={toggleLock}
              title={locked ? "Unlock editor — allow editing" : "Lock editor — prevent AI from overwriting"}
              className={cn(
                "p-1.5 rounded transition-colors",
                locked
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className={cn(
        "relative rounded-lg border overflow-hidden",
        locked
          ? "border-destructive/30 bg-destructive/5"
          : dirty
            ? "border-chart-4/40 bg-muted/40"
            : "border-border bg-muted/40"
      )}>
        {/* Line numbers */}
        <div className="flex">
          <div
            className="select-none text-right pr-3 pt-3 pb-3 pl-3 font-mono text-[11px] text-muted-foreground/40 leading-5 bg-muted/60 border-r border-border shrink-0"
            aria-hidden="true"
          >
            {sql.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            value={sql}
            onChange={(e) => { if (!locked) onChange(e.target.value); }}
            readOnly={locked}
            spellCheck={false}
            className={cn(
              "flex-1 font-mono text-[12px] bg-transparent px-4 py-3 resize-none focus:outline-none leading-5 min-h-[200px]",
              locked ? "text-muted-foreground cursor-not-allowed" : "text-primary/90"
            )}
            style={{ tabSize: 2 }}
            placeholder="-- SQL will appear here after AI generation, or type your own query..."
          />
        </div>

        {/* Locked overlay hint */}
        {locked && (
          <div className="absolute inset-0 pointer-events-none flex items-start justify-end p-2">
            <span className="text-[10px] text-destructive/50 font-medium select-none">read-only</span>
          </div>
        )}
      </div>

      {/* Validation errors */}
      {validation && !validation.valid && (
        <div className="flex flex-col gap-1">
          {validation.errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-destructive bg-destructive/8 rounded px-2.5 py-1.5"
            >
              <ShieldX className="w-3 h-3 mt-0.5 shrink-0" />
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Date params hint */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          <span className="font-mono text-primary/70">@StartDate</span> = {startDate}
        </span>
        <span>
          <span className="font-mono text-primary/70">@EndDate</span> = {endDate}
        </span>
      </div>

      {/* Run button */}
      <Button
        onClick={onRun}
        disabled={loading || !sql.trim() || (validation ? !validation.valid : false)}
        className="self-start bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {loading ? "Executing..." : "Execute Query"}
      </Button>
    </div>
  );
}
