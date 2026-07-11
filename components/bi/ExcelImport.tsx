"use client";

import { useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  CheckCircle2,
  Sparkles,
  Table as TableIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFile, type ParsedSheet } from "@/lib/bi/inference";
import { suggestKpis } from "@/lib/bi/kpiService";
import { createDataset, createReport } from "@/lib/hooks/useBiStore";
import type { DatasetSchema, KpiReport, Metric } from "@/lib/bi/types";

interface Props {
  onDone: (dataset: DatasetSchema) => void;
}

type Phase = "idle" | "parsing" | "importing" | "done";

/**
 * Excel → KPI Reports flow.
 *  Sheet 1 becomes the dataset (schema inferred from columns).
 *  Numeric columns → metrics, string columns → dimensions.
 *  Starter reports are generated from the KPI suggestions and saved.
 */
export function ExcelImport({ onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [datasetName, setDatasetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  // Upload → parse → auto-generate everything in one shot (no confirm gate).
  async function handleFile(file: File) {
    setError(null);
    setPhase("parsing");
    setFileName(file.name);
    try {
      const { sheets } = await parseFile(file);
      if (sheets.length === 0) {
        setError("No readable tables found in that file.");
        setPhase("idle");
        return;
      }
      setSheets(sheets);
      // Prefer the file name (friendlier) and fall back to the sheet name.
      const fileBase = file.name.replace(/\.[^.]+$/, "").trim();
      const name = fileBase || sheets[0].name;
      setDatasetName(name);
      await runImport(sheets[0], name);
    } catch {
      setError("Could not parse that file. Use a .xlsx, .xls, or .csv export.");
      setPhase("idle");
    }
  }

  const primary = sheets[0];
  const suggestions = primary ? suggestKpis(primary.fields) : [];

  async function runImport(sheet: ParsedSheet, name: string) {
    setPhase("importing");
    try {
      const dataset = await createDataset({
        name: name.trim() || sheet.name,
        fields: sheet.fields,
        sampleData: sheet.rows.slice(0, 500),
        source: "excel",
      });
      if (!dataset) {
        setError("Failed to create dataset.");
        setPhase("idle");
        return;
      }

      // Auto-generate starter reports from suggestions (cap at 4).
      const toCreate = suggestKpis(sheet.fields).slice(0, 4);
      let n = 0;
      for (const s of toCreate) {
        const r = await createReport({
          name: s.label,
          datasetId: dataset.id,
          metrics: s.metrics.length ? s.metrics : [{ agg: "count", field: null } as Metric],
          dimensions: s.dimensions,
          filters: [],
          chart: s.chart,
        });
        if (r) n++;
      }
      setCreatedCount(n);
      setPhase("done");
      onDone(dataset);
    } catch {
      setError("Import failed while generating reports.");
      setPhase("idle");
    }
  }

  function reset() {
    setPhase("idle");
    setSheets([]);
    setFileName("");
    setDatasetName("");
    setCreatedCount(0);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Dropzone */}
      {(phase === "idle" || phase === "parsing") && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-card px-6 py-14 text-center cursor-pointer hover:border-primary/50 transition-colors"
        >
          {phase === "parsing" ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              {phase === "parsing" ? `Reading ${fileName}…` : "Drop a spreadsheet to build KPIs instantly"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">
              Upload an Excel or CSV file and we&apos;ll do the rest: detect your columns, turn
              numbers into metrics and text into dimensions, and open ready-to-use charts in the KPI
              Explorer. You can fine-tune everything afterward.
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-primary font-medium mt-1">
            <Upload className="w-3.5 h-3.5" /> Choose file
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {phase === "importing" && (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Detecting columns and building
          your KPIs…
        </div>
      )}

      {/* Done — summary of what was generated, ready to refine */}
      {phase === "done" && primary && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center text-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-chart-4" />
            <p className="text-sm font-medium text-foreground">
              {datasetName} is ready in the KPI Explorer
            </p>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              We detected {primary.fields.length} columns from {primary.rows.length} rows and built{" "}
              {createdCount} starter report{createdCount === 1 ? "" : "s"}. Head to the KPI Explorer
              tab to adjust metrics, dimensions, and charts.
            </p>
            <button
              onClick={reset}
              className="text-xs text-primary hover:text-primary/80 font-medium mt-2"
            >
              Import another file
            </button>
          </div>

          {/* What we detected */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-3">
                <TableIcon className="w-3.5 h-3.5 text-muted-foreground" /> Detected columns
              </p>
              <div className="flex flex-wrap gap-1.5">
                {primary.fields.map((f) => (
                  <span
                    key={f.name}
                    className={cn(
                      "text-[11px] px-2 py-1 rounded border font-mono",
                      f.type === "number" && "bg-chart-1/15 text-chart-1 border-chart-1/30",
                      f.type === "string" && "bg-chart-2/15 text-chart-2 border-chart-2/30",
                      f.type === "date" && "bg-chart-3/15 text-chart-3 border-chart-3/30",
                      f.type === "boolean" && "bg-chart-5/15 text-chart-5 border-chart-5/30"
                    )}
                  >
                    {f.name}
                    <span className="opacity-60"> : {f.type}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-3">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> Reports created
              </p>
              <ul className="flex flex-col gap-1.5">
                {suggestions.slice(0, 4).map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    {s.label}
                    <span className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted">
                      {s.chart}
                    </span>
                  </li>
                ))}
                {suggestions.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    No numeric columns detected — imported without starter reports. Add metrics
                    manually in the KPI Explorer.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
