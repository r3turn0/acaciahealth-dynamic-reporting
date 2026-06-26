"use client";

import { useRef, useState } from "react";
import { Paperclip, X, FileText, FileJson, Table2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  name: string;
  type: string;
  content: string; // parsed text content ready to append to prompts
  size: number;
}

interface FileUploadButtonProps {
  onFile: (file: UploadedFile | null) => void;
  file: UploadedFile | null;
  className?: string;
  /** Compact mode — just an icon button, no label */
  compact?: boolean;
}

const ACCEPTED = ".csv,.json,.txt,.md";
const MAX_BYTES = 512 * 1024; // 512 KB — keep prompts sane

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return <FileJson className="w-3.5 h-3.5 shrink-0" />;
  if (ext === "csv") return <Table2 className="w-3.5 h-3.5 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 shrink-0" />;
}

async function readFile(file: File): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_BYTES) {
      reject(new Error(`File too large (max ${MAX_BYTES / 1024}KB). Please use a smaller excerpt.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      // For CSV, prefix with a hint so the AI knows what it is
      const ext = file.name.split(".").pop()?.toLowerCase();
      const content =
        ext === "csv"
          ? `[Attached CSV: ${file.name}]\n${raw}`
          : ext === "json"
          ? `[Attached JSON: ${file.name}]\n${raw}`
          : `[Attached file: ${file.name}]\n${raw}`;
      resolve({ name: file.name, type: file.type, content, size: file.size });
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

export function FileUploadButton({ onFile, file, className, compact }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setError(null);
    try {
      const parsed = await readFile(selected);
      onFile(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file.");
      onFile(null);
    }
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleChange}
        className="sr-only"
        aria-label="Attach a file to your prompt"
      />

      {/* Attached file pill */}
      {file ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/8 border border-primary/25 text-primary w-fit max-w-full">
          {fileIcon(file.name)}
          <span className="text-xs font-medium truncate max-w-[180px]">{file.name}</span>
          <span className="text-[10px] text-primary/60 shrink-0">
            {(file.size / 1024).toFixed(1)}KB
          </span>
          <button
            onClick={() => { onFile(null); setError(null); }}
            aria-label="Remove attached file"
            className="ml-0.5 text-primary/50 hover:text-primary transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors",
            compact
              ? "p-1.5 rounded-md hover:bg-accent"
              : "text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/40 bg-muted/30"
          )}
          title="Attach a file (.csv, .json, .txt)"
        >
          <Paperclip className="w-3.5 h-3.5 shrink-0" />
          {!compact && <span>Attach file</span>}
        </button>
      )}

      {/* Inline error */}
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
