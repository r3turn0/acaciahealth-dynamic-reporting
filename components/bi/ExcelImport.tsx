"use client";

import { useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  CheckCircle2,
  Sparkles,
  Table as TableIcon,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { combineWorkbookSheets, parseFile, type ParsedSheet, type WorkbookAnalysis } from "@/lib/bi/inference";
import type { ScorecardResult } from "@/lib/bi/scorecard";
import { suggestKpis } from "@/lib/bi/kpiService";
import { createDataset, createReport } from "@/lib/hooks/useBiStore";
import type { DatasetSchema, KpiReport, Metric, Filter } from "@/lib/bi/types";

interface Props {
  onDone: (dataset: DatasetSchema) => void;
}

type Phase = "idle" | "parsing" | "importing" | "done";

/**
 * Excel → KPI Reports flow.
 *  Every worksheet contributes to one unioned dataset with provenance.
 *  Numeric columns → metrics, string columns → dimensions.
 *  Starter reports are generated from the KPI suggestions and saved.
 */
export function ExcelImport({ onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardResult | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  // Upload → parse → auto-generate everything in one shot (no confirm gate).
  async function handleFile(file: File) {
    setError(null);
    setScorecard(null);
    setPhase("parsing");
    setFileName(file.name);
    try {
      const parsed = await parseFile(file);
      if (!parsed.sheets.length) throw new Error("No readable worksheets found.");
      setSheets(parsed.sheets);
      setAnalysis(parsed.analysis);
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

      // Auto-generate starter reports from the unioned schema (cap at 4).
      const toCreate = suggestKpis(sheet.fields).slice(0, 4);
      const numericField = sheet.fields.find((field) => field.type === "number");
      if (workbookSheets.length > 1 && numericField && !toCreate.some((suggestion) => suggestion.dimensions.includes("Worksheet"))) {
        toCreate.unshift({
          label: `${numericField.name} by Worksheet`,
          metrics: [{ agg: "sum", field: numericField.name }],
          dimensions: ["Worksheet"],
          chart: "bar",
        });
      }
      let n = 0;
      for (const s of toCreate.slice(0, 4)) {
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

  // Scorecard workbooks are unpivoted into one tidy dataset (KPI × Service Line
  // × Period) and get scorecard-shaped starter reports that exclude total rows
  // so aggregates aren't double-counted.
  async function runScorecardImport(sc: ScorecardResult, name: string) {
    setPhase("importing");
    try {
      const dataset = await createDataset({
        name: name.trim() || sc.tidy.name,
        fields: sc.tidy.fields,
        sampleData: sc.tidy.rows,
        source: "excel",
      });
      if (!dataset) {
        setError("Failed to create dataset.");
        setPhase("idle");
        return;
      }

      const excludeTotals: Filter = { field: "Is Total", op: "equals", value: "false" };
      const starters: {
        name: string;
        metrics: Metric[];
        dimensions: string[];
        filters: Filter[];
        chart: KpiReport["chart"];
      }[] = [
        {
          name: "Actual vs Benchmark by Service Line",
          metrics: [
            { agg: "avg", field: "Value" },
            { agg: "avg", field: "Benchmark" },
          ],
          dimensions: ["Service Line"],
          filters: [excludeTotals],
          chart: "bar",
        },
        {
          name: "Value by KPI",
          metrics: [{ agg: "sum", field: "Value" }],
          dimensions: ["KPI"],
          filters: [excludeTotals],
          chart: "bar",
        },
        {
          name: "Value by Worksheet",
          metrics: [{ agg: "sum", field: "Value" }],
          dimensions: ["Worksheet"],
          filters: [excludeTotals],
          chart: "bar",
        },
        {
          name: "Monthly trend",
          metrics: [{ agg: "avg", field: "Value" }],
          dimensions: ["Period"],
          filters: [excludeTotals, { field: "Period Type", op: "equals", value: "Monthly" }],
          chart: "line",
        },
      ];

      let n = 0;
      for (const s of starters) {
        const r = await createReport({ datasetId: dataset.id, ...s });
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
    setScorecard(null);
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
            {scorecard ? (
              <p className="text-xs text-muted-foreground max-w-lg leading-relaxed">
                Detected a KPI scorecard and broke it down into{" "}
                <span className="font-medium text-foreground">{scorecard.reports.length} KPI reports</span>{" "}
                across <span className="font-medium text-foreground">{scorecard.worksheets.length} worksheets</span>,
                separating benchmark, service line, and every weekly/monthly period. Total rows are
                flagged so they don&apos;t double-count. We built {createdCount} starter chart
                {createdCount === 1 ? "" : "s"} in the KPI Explorer.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
                We analyzed all {sheets.length} worksheet{sheets.length === 1 ? "" : "s"}, unioned {sheets.reduce((total, sheet) => total + sheet.rows.length, 0)} rows with worksheet provenance, and built{" "}
                {createdCount} starter report{createdCount === 1 ? "" : "s"}. Head to the KPI Explorer
                tab to adjust metrics, dimensions, and charts.
              </p>
            )}
            <button
              onClick={reset}
              className="text-xs text-primary hover:text-primary/80 font-medium mt-2"
            >
              Import another file
            </button>
          </div>

          {/* Scorecard breakdown — each row is a possible KPI report */}
          {scorecard && <ScorecardBreakdown scorecard={scorecard} />}

          {/* What we detected (generic tabular imports) */}
          {!scorecard && (
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
          )}
        </div>
      )}
    </div>
  );
}

// ── Scorecard breakdown ─────────────────────────────────────────────────────
// Renders the parsed scorecard the way the source workbook is organised: one
// section per KPI, one row per Service Line (each row = a possible KPI report),
// with benchmark + latest period value, totals colour-coded, grouped by
// worksheet.

function fmtNum(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function ScorecardBreakdown({ scorecard }: { scorecard: ScorecardResult }) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(scorecard.worksheets.map((w, i) => [w.name, i === 0]))
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Scorecard breakdown</p>
        <span className="text-[10px] text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">
          {scorecard.reports.length} KPI reports
        </span>
      </div>

      {scorecard.worksheets.map((ws) => {
        const isOpen = open[ws.name];
        const rows = scorecard.reports.filter((r) => r.worksheet === ws.name);
        return (
          <div key={ws.name} className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setOpen((s) => ({ ...s, [ws.name]: !s[ws.name] }))}
              className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20 hover:bg-accent/20 transition-colors text-left"
            >
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <FileSpreadsheet className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground">{ws.name}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{ws.periods.length} periods</span>
                <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5">
                  {rows.length} reports
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Service Line</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Benchmark</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">
                        Latest ({ws.periods.at(-1)?.label ?? "—"})
                      </th>
                      <th className="text-center px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">
                        vs Benchmark
                      </th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground hidden md:table-cell">
                        Data points
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const prev = rows[i - 1];
                      const showKpi = !prev || prev.kpi !== r.kpi;
                      const delta =
                        r.benchmark !== null && r.latestValue !== null
                          ? r.latestValue - r.benchmark
                          : null;
                      return (
                        <FragmentRow
                          key={`${r.kpi}-${r.serviceLine}-${i}`}
                          showKpi={showKpi}
                          kpi={r.kpi}
                          definition={r.definition}
                          serviceLine={r.serviceLine || "(overall)"}
                          benchmark={r.benchmark}
                          latest={r.latestValue}
                          delta={delta}
                          dataPoints={r.values.length}
                          isTotal={r.isTotal}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FragmentRow({
  showKpi,
  kpi,
  definition,
  serviceLine,
  benchmark,
  latest,
  delta,
  dataPoints,
  isTotal,
}: {
  showKpi: boolean;
  kpi: string;
  definition: string;
  serviceLine: string;
  benchmark: number | null;
  latest: number | null;
  delta: number | null;
  dataPoints: number;
  isTotal: boolean;
}) {
  return (
    <>
      {showKpi && (
        <tr className="bg-accent/20 border-t border-border">
          <td colSpan={5} className="px-4 py-1.5">
            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide">{kpi}</span>
            {definition && (
              <span className="ml-2 text-[10px] text-muted-foreground normal-case">{definition}</span>
            )}
          </td>
        </tr>
      )}
      <tr
        className={cn(
          "border-b border-border/50 transition-colors",
          isTotal ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent/10"
        )}
      >
        <td className="px-4 py-1.5">
          <span className="flex items-center gap-1.5">
            {isTotal && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-primary bg-primary/15 border border-primary/25 rounded px-1 py-0.5">
                Total
              </span>
            )}
            <span className={cn("text-foreground", isTotal && "font-semibold")}>{serviceLine}</span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmtNum(benchmark)}</td>
        <td className="px-3 py-1.5 text-right font-mono text-foreground">{fmtNum(latest)}</td>
        <td className="px-3 py-1.5 text-center hidden sm:table-cell">
          {delta === null ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border",
                delta >= 0
                  ? "text-chart-1 bg-chart-1/10 border-chart-1/25"
                  : "text-chart-5 bg-chart-5/10 border-chart-5/25"
              )}
            >
              <Target className="w-2.5 h-2.5" />
              {delta >= 0 ? "+" : ""}
              {fmtNum(delta)}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground/70 hidden md:table-cell">
          {dataPoints}
        </td>
      </tr>
    </>
  );
}
