"use client";

import { useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  CheckCircle2,
  ArrowRight,
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

type Phase = "idle" | "parsing" | "preview" | "importing" | "done";

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
      setDatasetName(sheets[0].name || file.name.replace(/\.[^.]+$/, ""));
      setPhase("preview");
    } catch {
      setError("Could not parse that file. Use a .xlsx, .xls, or .csv export.");
      setPhase("idle");
    }
  }

  const primary = sheets[0];
  const suggestions = primary ? suggestKpis(primary.fields) : [];

  async function runImport() {
    if (!primary) return;
    setPhase("importing");
    try {
      const dataset = await createDataset({
        name: datasetName.trim() || primary.name,
        fields: primary.fields,
        sampleData: primary.rows.slice(0, 500),
        source: "excel",
      });
      if (!dataset) {
        setError("Failed to create dataset.");
        setPhase("preview");
        return;
      }

      // Auto-generate starter reports from suggestions (cap at 4).
      const toCreate = suggestions.slice(0, 4);
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
      setPhase("preview");
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
              {phase === "parsing" ? `Parsing ${fileName}…` : "Upload an Excel or CSV workbook"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">
              Sheet 1 becomes your dataset. Columns are typed automatically — numbers become
              metrics, text becomes dimensions — and starter KPI reports are generated for you.
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

      {/* Preview */}
      {phase === "preview" && primary && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <CheckCircle2 className="w-4 h-4 text-chart-4" />
            Parsed <span className="font-medium">{fileName}</span> · {sheets.length} sheet
            {sheets.length > 1 ? "s" : ""}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Dataset name</span>
            <input
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              className="px-3 py-2 rounded-md bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:border-primary max-w-md"
            />
          </label>

          {/* Inferred schema */}
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-3">
              <TableIcon className="w-3.5 h-3.5 text-muted-foreground" /> Inferred schema ·{" "}
              {primary.fields.length} fields · {primary.rows.length} rows
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

          {/* Suggested reports */}
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-3">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> {Math.min(suggestions.length, 4)}{" "}
              starter reports will be created
            </p>
            <ul className="flex flex-col gap-1.5">
              {suggestions.slice(0, 4).map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  {s.label}
                  <span className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted">
                    {s.chart}
                  </span>
                </li>
              ))}
              {suggestions.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  No numeric columns detected — the dataset will import without starter reports.
                </li>
              )}
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runImport}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Import & generate <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "importing" && (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Creating dataset and reports…
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center text-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-chart-4" />
          <div>
            <p className="text-sm font-medium text-foreground">Import complete</p>
            <p className="text-xs text-muted-foreground mt-1">
              Created dataset <span className="font-medium">{datasetName}</span> and {createdCount}{" "}
              KPI report{createdCount === 1 ? "" : "s"}. Opened in the KPI Explorer.
            </p>
          </div>
          <button
            onClick={reset}
            className="text-xs text-primary hover:text-primary/80 font-medium mt-1"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
