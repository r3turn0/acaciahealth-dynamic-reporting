"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Copy,
  LineChart as LineIcon,
  Pencil,
  PieChart as PieIcon,
  Table as TableIcon,
  Trash2,
  Play,
  Database,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  metricLabel,
  type ChartType,
  type DatasetSchema,
  type KpiReport,
} from "@/lib/bi/types";
import {
  useBiStore,
  deleteReport,
  duplicateReport,
} from "@/lib/hooks/useBiStore";

const CHART_ICON: Record<ChartType, React.ElementType> = {
  bar: BarChart3,
  line: LineIcon,
  pie: PieIcon,
  table: TableIcon,
};

interface Props {
  /** Open a report in the KPI Explorer for viewing / editing. */
  onOpen: (report: KpiReport) => void;
}

export function ReportManager({ onOpen }: Props) {
  const { reports, datasets } = useBiStore();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const datasetName = useMemo(() => {
    const map: Record<string, string> = {};
    datasets.forEach((d) => (map[d.id] = d.name));
    return map;
  }, [datasets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (datasetName[r.datasetId] ?? "").toLowerCase().includes(q)
    );
  }, [reports, query, datasetName]);

  async function onDuplicate(id: string) {
    setBusyId(id);
    try {
      await duplicateReport(id);
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    setBusyId(id);
    try {
      await deleteReport(id);
    } finally {
      setBusyId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-10 text-center">
        <Database className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">No KPI reports yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
          Build a report in the KPI Explorer and save it, or import an Excel workbook to
          auto-generate reports. Saved reports appear here to load, duplicate, or edit.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reports…"
          className="w-full pl-9 pr-3 py-2 rounded-md bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((r) => {
          const Icon = CHART_ICON[r.chart];
          const missingDataset = !datasetName[r.datasetId];
          return (
            <div
              key={r.id}
              className="group flex flex-col gap-3 bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {datasetName[r.datasetId] ?? "Dataset removed"}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {r.chart}
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {r.metrics.map((m, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-chart-1/15 text-chart-1 border border-chart-1/30"
                  >
                    {metricLabel(m)}
                  </span>
                ))}
                {r.dimensions.map((d) => (
                  <span
                    key={d}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-chart-2/15 text-chart-2 border border-chart-2/30 font-mono"
                  >
                    {d}
                  </span>
                ))}
                {r.filters.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-chart-5/15 text-chart-5 border border-chart-5/30">
                    {r.filters.length} filter{r.filters.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 pt-1 border-t border-border/60">
                <button
                  onClick={() => onOpen(r)}
                  disabled={missingDataset}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2 py-1.5 rounded border border-primary/30 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={missingDataset ? "Underlying dataset was removed" : "Open in KPI Explorer"}
                >
                  <Play className="w-3 h-3" /> Open
                </button>
                <button
                  onClick={() => onOpen(r)}
                  disabled={missingDataset}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button
                  onClick={() => onDuplicate(r.id)}
                  disabled={busyId === r.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border"
                  title="Duplicate"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDelete(r.id)}
                  disabled={busyId === r.id}
                  className="ml-auto p-1.5 rounded hover:bg-destructive/15"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
