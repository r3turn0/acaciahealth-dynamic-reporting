"use client";

import { useState, useEffect } from "react";
import { Code2, Play, Loader2, ShieldCheck, ShieldX, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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
}

export function SQLEditor({ sql, onChange, onRun, loading, startDate, endDate }: SQLEditorProps) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Validate on SQL change (debounced)
  useEffect(() => {
    if (!sql.trim()) {
      setValidation(null);
      return;
    }
    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/generate-query/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        if (res.ok) {
          const data = await res.json();
          setValidation(data);
        }
      } catch {
        // Silent fail for inline validation
      } finally {
        setValidating(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [sql]);

  async function copySQL() {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        </div>
      </div>

      {/* Editor */}
      <div className="relative rounded-lg border border-border overflow-hidden bg-muted/40">
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
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="flex-1 font-mono text-[12px] text-primary/90 bg-transparent px-4 py-3 resize-none focus:outline-none leading-5 min-h-[200px]"
            style={{ tabSize: 2 }}
            placeholder="-- SQL will appear here after AI generation, or type your own query..."
          />
        </div>
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
