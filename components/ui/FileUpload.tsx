"use client";

import { useRef, useState } from "react";
import { Paperclip, X, FileText, FileJson, Table2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisSource, FileIngestionResult } from "@/lib/services/kpiAnalysisTypes";

export interface UploadedFile {
  name: string;
  type: string;
  content: string;
  size: number;
  source?: AnalysisSource;
  diagnostics?: string[];
}

interface FileUploadButtonProps {
  onFile: (file: UploadedFile | null) => void;
  file: UploadedFile | null;
  onFiles?: (files: UploadedFile[]) => void;
  multiple?: boolean;
  className?: string;
  compact?: boolean;
}

const ACCEPTED = ".csv,.json,.txt,.md,.xlsx,.docx,.pdf";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return <FileJson className="size-3.5 shrink-0" />;
  if (["csv", "xlsx"].includes(ext ?? "")) return <Table2 className="size-3.5 shrink-0" />;
  return <FileText className="size-3.5 shrink-0" />;
}

export function FileUploadButton({ onFile, file, onFiles, multiple = false, className, compact }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;
    setError(null);
    setLoading(true);
    try {
      const form = new FormData();
      selected.forEach((item) => form.append("files", item));
      const response = await fetch("/api/kpi/files", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Files could not be processed.");
      const results = payload.results as FileIngestionResult[];
      const parsed = results.filter((result) => result.source).map((result) => ({
        name: result.fileName, type: result.mediaType, size: result.size, source: result.source!, diagnostics: result.diagnostics,
        content: JSON.stringify({ source: result.source }),
      } satisfies UploadedFile));
      const failures = results.filter((result) => !result.source);
      if (failures.length) setError(failures.map((result) => `${result.fileName}: ${result.diagnostics.join(" ")}`).join(" "));
      onFiles?.(parsed);
      onFile(parsed[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not process files.");
      onFile(null);
      onFiles?.([]);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <input ref={inputRef} type="file" accept={ACCEPTED} multiple={multiple} onChange={handleChange} className="sr-only" aria-label={multiple ? "Attach files to your analysis" : "Attach a file to your prompt"} />
      {file ? (
        <div className="flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 px-2.5 py-1.5 text-primary">
          {fileIcon(file.name)}
          <span className="max-w-[180px] truncate text-xs font-medium">{file.name}</span>
          <span className="shrink-0 text-[10px] text-primary/60">{(file.size / 1024).toFixed(1)}KB</span>
          <button type="button" onClick={() => { onFile(null); onFiles?.([]); setError(null); }} aria-label="Remove attached file" className="ml-0.5 shrink-0 text-primary/50 transition-colors hover:text-primary"><X className="size-3" /></button>
        </div>
      ) : (
        <button type="button" disabled={loading} onClick={() => inputRef.current?.click()} className={cn("flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60", compact ? "rounded-md p-1.5 hover:bg-accent" : "rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs hover:border-primary/40")} title="Attach CSV, JSON, text, Excel, Word, or PDF files">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5 shrink-0" />}
          {!compact && <span>{loading ? "Processing…" : multiple ? "Attach files" : "Attach file"}</span>}
        </button>
      )}
      {error && <div className="flex items-start gap-1.5 text-[11px] text-destructive" role="status"><AlertCircle className="mt-0.5 size-3 shrink-0" /><span>{error}</span></div>}
    </div>
  );
}
