"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Filter as FilterIcon,
  Hash,
  LayoutGrid,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Plus,
  Save,
  Sigma,
  Sparkles,
  Table as TableIcon,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartRenderer } from "./ChartRenderer";
import {
  computeAggregation,
  suggestKpis,
  type KpiSuggestion,
} from "@/lib/bi/kpiService";
import {
  metricKey,
  metricLabel,
  type ChartType,
  type DatasetField,
  type DatasetSchema,
  type Filter,
  type FilterOp,
  type Metric,
  type MetricAgg,
} from "@/lib/bi/types";
import { createReport, updateReport } from "@/lib/hooks/useBiStore";

const AGGS: MetricAgg[] = ["sum", "avg", "count", "min", "max"];

const CHARTS: { id: ChartType; label: string; icon: React.ElementType }[] = [
  { id: "bar", label: "Bar", icon: BarChart3 },
  { id: "line", label: "Line", icon: LineIcon },
  { id: "pie", label: "Pie", icon: PieIcon },
  { id: "table", label: "Table", icon: TableIcon },
];

const TYPE_ICON: Record<DatasetField["type"], React.ElementType> = {
  number: Hash,
  string: Type,
  date: LayoutGrid,
  boolean: LayoutGrid,
};

export interface ExplorerSeed {
  metrics?: Metric[];
  dimensions?: string[];
  filters?: Filter[];
  chart?: ChartType;
  reportId?: string | null;
  reportName?: string;
}

interface Props {
  dataset: DatasetSchema;
  seed?: ExplorerSeed;
  onSaved?: () => void;
}

function defaultFilterOp(type: DatasetField["type"]): FilterOp {
  if (type === "number") return "gt";
  if (type === "date") return "last_n_days";
  return "contains";
}

export function KpiExplorerCanvas({ dataset, seed, onSaved }: Props) {
  const [metrics, setMetrics] = useState<Metric[]>(seed?.metrics ?? []);
  const [dimensions, setDimensions] = useState<string[]>(seed?.dimensions ?? []);
  const [filters, setFilters] = useState<Filter[]>(seed?.filters ?? []);
  const [chart, setChart] = useState<ChartType>(seed?.chart ?? "bar");
  const [reportName, setReportName] = useState(seed?.reportName ?? "");
  const [editingId, setEditingId] = useState<string | null>(seed?.reportId ?? null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Re-seed when the caller swaps dataset or provides a new config.
  useEffect(() => {
    setMetrics(seed?.metrics ?? []);
    setDimensions(seed?.dimensions ?? []);
    setFilters(seed?.filters ?? []);
    setChart(seed?.chart ?? "bar");
    setReportName(seed?.reportName ?? "");
    setEditingId(seed?.reportId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id, seed]);

  const fieldType = (name: string): DatasetField["type"] =>
    dataset.fields.find((f) => f.name === name)?.type ?? "string";

  // ── Live aggregation ─────────────────────────────────────────────────────────
  const result = useMemo(
    () => computeAggregation(dataset.sampleData, { metrics, dimensions, filters }),
    [dataset.sampleData, metrics, dimensions, filters]
  );

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    (metrics.length ? metrics : [{ agg: "count", field: null } as Metric]).forEach((mm) => {
      m[metricKey(mm)] = metricLabel(mm);
    });
    return m;
  }, [metrics]);

  const suggestions = useMemo(() => suggestKpis(dataset.fields), [dataset.fields]);

  // ── Field → zone helpers ───────────────────────────────────────────────────
  function addMetric(field: DatasetField) {
    if (field.type === "number") {
      setMetrics((m) =>
        m.some((x) => x.field === field.name && x.agg === "sum")
          ? m
          : [...m, { agg: "sum", field: field.name }]
      );
    } else {
      addCount();
    }
  }
  function addCount() {
    setMetrics((m) => (m.some((x) => x.agg === "count") ? m : [...m, { agg: "count", field: null }]));
  }
  function addDimension(field: DatasetField) {
    setDimensions((d) => (d.includes(field.name) || d.length >= 2 ? d : [...d, field.name]));
  }
  function addFilter(field: DatasetField) {
    setFilters((f) => [
      ...f,
      { field: field.name, op: defaultFilterOp(field.type), value: field.type === "date" ? 30 : "" },
    ]);
  }

  function onDropZone(zone: "metric" | "dimension" | "filter", e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/bi-field");
    if (!raw) return;
    const field = JSON.parse(raw) as DatasetField;
    if (zone === "metric") addMetric(field);
    if (zone === "dimension") addDimension(field);
    if (zone === "filter") addFilter(field);
  }

  function applySuggestion(s: KpiSuggestion) {
    setMetrics(s.metrics);
    setDimensions(s.dimensions);
    setFilters([]);
    setChart(s.chart);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!reportName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: reportName.trim(),
        datasetId: dataset.id,
        metrics: metrics.length ? metrics : [{ agg: "count" as MetricAgg, field: null }],
        dimensions,
        filters,
        chart,
      };
      const result = editingId
        ? await updateReport(editingId, payload)
        : await createReport(payload);
      if (result) {
        setEditingId(result.id);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1800);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  }

  const configJson = JSON.stringify(
    {
      reportId: editingId ?? "(new)",
      datasetId: dataset.id,
      metrics: (metrics.length ? metrics : [{ agg: "count", field: null }]).map((m) =>
        m.agg === "count" ? "count()" : `${m.agg}(${m.field})`
      ),
      dimensions,
      filters,
      chart,
    },
    null,
    2
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
      {/* ── Left: field palette ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 min-w-0">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {dataset.name} · fields
          </p>
          <div className="flex flex-col gap-1.5">
            {dataset.fields.map((f) => {
              const Icon = TYPE_ICON[f.type];
              return (
                <div
                  key={f.name}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("application/bi-field", JSON.stringify(f))
                  }
                  className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/30 cursor-grab active:cursor-grabbing hover:border-primary/40"
                >
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono text-foreground truncate flex-1">{f.name}</span>
                  <span className="hidden group-hover:flex items-center gap-1 shrink-0">
                    {f.type === "number" && (
                      <button
                        onClick={() => addMetric(f)}
                        title="Add as metric"
                        className="p-0.5 rounded text-chart-1 hover:bg-chart-1/15"
                      >
                        <Sigma className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => addDimension(f)}
                      title="Add as dimension"
                      className="p-0.5 rounded text-chart-2 hover:bg-chart-2/15"
                    >
                      <LayoutGrid className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => addFilter(f)}
                      title="Add as filter"
                      className="p-0.5 rounded text-chart-5 hover:bg-chart-5/15"
                    >
                      <FilterIcon className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={addCount}
            className="mt-3 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            <Plus className="w-3 h-3" /> Count rows metric
          </button>
        </div>

        {/* Auto-suggest */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            <Sparkles className="w-3 h-3 text-primary" /> Suggested KPIs
          </p>
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => applySuggestion(s)}
                className="text-left text-xs text-foreground px-2.5 py-1.5 rounded-md bg-muted/30 border border-border hover:border-primary/50 transition-colors"
              >
                {s.label}
              </button>
            ))}
            {suggestions.length === 0 && (
              <p className="text-xs text-muted-foreground">Add numeric fields for suggestions.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: canvas ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 min-w-0">
        {/* Drop zones */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DropZone
            title="Metrics"
            accent="chart-1"
            icon={Sigma}
            onDrop={(e) => onDropZone("metric", e)}
            empty={metrics.length === 0}
            hint="Drop a numeric field"
          >
            {metrics.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-chart-1/15 border border-chart-1/30 text-xs text-foreground"
              >
                <select
                  value={m.agg}
                  onChange={(e) => {
                    const agg = e.target.value as MetricAgg;
                    setMetrics((arr) =>
                      arr.map((x, idx) =>
                        idx === i ? { agg, field: agg === "count" ? null : x.field ?? dataset.fields.find((f) => f.type === "number")?.name ?? null } : x
                      )
                    );
                  }}
                  className="bg-transparent font-medium focus:outline-none cursor-pointer"
                >
                  {AGGS.map((a) => (
                    <option key={a} value={a} className="bg-card">{a}</option>
                  ))}
                </select>
                <span className="font-mono text-muted-foreground">{m.field ?? "()"}</span>
                <button onClick={() => setMetrics((arr) => arr.filter((_, idx) => idx !== i))}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </DropZone>

          <DropZone
            title="Dimensions"
            accent="chart-2"
            icon={LayoutGrid}
            onDrop={(e) => onDropZone("dimension", e)}
            empty={dimensions.length === 0}
            hint="Drop a field to group by"
          >
            {dimensions.map((d) => (
              <div
                key={d}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-chart-2/15 border border-chart-2/30 text-xs font-mono text-foreground"
              >
                {d}
                <button onClick={() => setDimensions((arr) => arr.filter((x) => x !== d))}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </DropZone>

          <DropZone
            title="Filters"
            accent="chart-5"
            icon={FilterIcon}
            onDrop={(e) => onDropZone("filter", e)}
            empty={filters.length === 0}
            hint="Drop a field to filter"
          >
            {filters.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-chart-5/15 border border-chart-5/30 text-xs text-foreground w-full"
              >
                <span className="font-mono">{f.field}</span>
                <select
                  value={f.op}
                  onChange={(e) =>
                    setFilters((arr) =>
                      arr.map((x, idx) => (idx === i ? { ...x, op: e.target.value as FilterOp } : x))
                    )
                  }
                  className="bg-transparent focus:outline-none cursor-pointer"
                >
                  {filterOpsForType(fieldType(f.field)).map((op) => (
                    <option key={op} value={op} className="bg-card">{op}</option>
                  ))}
                </select>
                <input
                  value={String(f.value)}
                  onChange={(e) =>
                    setFilters((arr) =>
                      arr.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x))
                    )
                  }
                  className="flex-1 min-w-0 w-12 bg-muted/40 rounded px-1.5 py-0.5 font-mono focus:outline-none"
                />
                <button onClick={() => setFilters((arr) => arr.filter((_, idx) => idx !== i))}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </DropZone>
        </div>

        {/* Chart type + preview */}
        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1">
              {CHARTS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setChart(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    chart === id
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {dataset.sampleData.length > 0
                ? `${dataset.sampleData.length} sample rows`
                : "No sample data — preview will be empty"}
            </span>
          </div>

          <div className="min-h-64">
            <ChartRenderer result={result} chart={chart} labels={labels} />
          </div>
        </div>

        {/* Save as report — always visible */}
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3 flex-wrap">
          <input
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder="Report name (e.g. Revenue by Region)"
            className="flex-1 min-w-48 px-3 py-2 rounded-md bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          <button
            onClick={save}
            disabled={!reportName.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {savedFlash ? "Saved!" : editingId ? "Update report" : "Save as Report"}
          </button>
        </div>

        {/* Config JSON */}
        <details className="bg-card border border-border rounded-lg p-4">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer select-none">
            Report config JSON
          </summary>
          <pre className="mt-3 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-3 overflow-x-auto">
            {configJson}
          </pre>
        </details>
      </div>
    </div>
  );
}

function filterOpsForType(type: DatasetField["type"]): FilterOp[] {
  if (type === "number") return ["gt", "lt", "gte", "lte", "equals", "not_equals"];
  if (type === "date") return ["last_n_days", "gt", "lt", "equals"];
  return ["contains", "equals", "not_equals"];
}

interface DropZoneProps {
  title: string;
  accent: string;
  icon: React.ElementType;
  empty: boolean;
  hint: string;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}

function DropZone({ title, accent, icon: Icon, empty, hint, onDrop, children }: DropZoneProps) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 min-h-24 transition-colors",
        over ? "border-primary bg-primary/5" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5", `text-${accent}`)} />
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {empty ? <span className="text-[11px] text-muted-foreground">{hint}</span> : children}
      </div>
    </div>
  );
}
