"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart2,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  FileSpreadsheet,
  Download,
  Filter,
  Clock,
  Hash,
  Table,
  Layers,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiColumn {
  name: string;
  displayName: string;
  type: string;
  role: string;
  aggregation?: string;
}

interface KpiRow {
  definition: string | null;
  benchmark: string | null;
  serviceLine: string | null;
  series: Record<string, number>;
  // avg salary specific
  company?: string;
  location?: string;
  position?: string;
  totalPay?: number;
  fteCount?: number;
  avgAnnualPay?: number;
  notes?: string | null;
}

interface KpiGroup {
  id: string;
  name: string;
  rows: KpiRow[];
  periods?: string[];
}

interface KpiSchema {
  id: string;
  sheetName: string;
  title: string;
  description: string;
  domain: string;
  frequency: string;
  serviceLines: string[];
  kpis: KpiGroup[];
  columns: KpiColumn[];
}

interface SchemaSummary {
  id: string;
  sheetName: string;
  title: string;
  description: string;
  domain: string;
  frequency: string;
  serviceLines: string[];
  kpiCount: number;
  columnCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  executive:  "bg-primary/10 text-primary border-primary/20",
  finance:    "bg-chart-5/10 text-chart-5 border-chart-5/20",
  hr:         "bg-chart-4/10 text-chart-4 border-chart-4/20",
  clinical:   "bg-chart-3/10 text-chart-3 border-chart-3/20",
  operations: "bg-chart-2/10 text-chart-2 border-chart-2/20",
};

const DOMAIN_TAB_ACTIVE: Record<string, string> = {
  executive:  "border-primary text-primary",
  finance:    "border-chart-5 text-chart-5",
  hr:         "border-chart-4 text-chart-4",
  clinical:   "border-chart-3 text-chart-3",
  operations: "border-chart-2 text-chart-2",
};

function domainColor(domain: string) {
  return DOMAIN_COLORS[domain] ?? "bg-muted text-muted-foreground border-border";
}

function getLastNValues(series: Record<string, number>, n: number): number[] {
  return Object.values(series).filter((v) => v !== null && !isNaN(v)).slice(-n);
}

function trend(vals: number[]): "up" | "down" | "flat" {
  if (vals.length < 2) return "flat";
  const first = vals[0];
  const last  = vals[vals.length - 1];
  const delta = last - first;
  if (Math.abs(delta) < 0.001 * Math.abs(first || 1)) return "flat";
  return delta > 0 ? "up" : "down";
}

function latestValue(series: Record<string, number>): number | null {
  const vals = Object.values(series).filter((v) => v !== null && !isNaN(v));
  return vals.length ? vals[vals.length - 1] : null;
}

function formatValue(v: number | null, type?: string): string {
  if (v === null) return "—";
  if (type === "DECIMAL" || type === "currency") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000)    return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(2)}`;
  }
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)    return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted-foreground text-[10px]">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 60, H = 22;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const t = trend(values);
  const stroke = t === "up" ? "var(--chart-3)" : t === "down" ? "var(--chart-5)" : "var(--muted-foreground)";
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendBadge({ vals }: { vals: number[] }) {
  const t = trend(vals);
  if (t === "up")   return <TrendingUp   className="w-3.5 h-3.5 text-chart-3" />;
  if (t === "down") return <TrendingDown className="w-3.5 h-3.5 text-chart-5" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ColumnSchema({ columns }: { columns: KpiColumn[] }) {
  const roleIcon: Record<string, React.ReactNode> = {
    dimension:      <Hash  className="w-3 h-3 text-primary"           />,
    measure:        <BarChart2 className="w-3 h-3 text-chart-3"       />,
    time_dimension: <Clock className="w-3 h-3 text-chart-4"           />,
    primary_key:    <CheckCircle2 className="w-3 h-3 text-chart-5"    />,
    foreign_key:    <Table className="w-3 h-3 text-chart-2"           />,
  };
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Schema Columns</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            {["Column", "Display Name", "Type", "Role", "Aggregation"].map((h) => (
              <th key={h} className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => (
            <tr key={col.name} className="border-b border-border/30 hover:bg-muted/20">
              <td className="px-3 py-2 font-mono text-[11px] text-foreground">{col.name}</td>
              <td className="px-3 py-2 text-foreground">{col.displayName}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{col.type}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-1">
                  {roleIcon[col.role] ?? null}
                  <span className="text-muted-foreground capitalize">{col.role.replace("_", " ")}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{col.aggregation ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiGroupCard({ group, measureType, defaultOpen }: {
  group: KpiGroup;
  measureType: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const rowsWithData = group.rows.filter((r) => Object.keys(r.series).length > 0 || r.avgAnnualPay);

  // aggregate: sum last value across all rows for headline
  const allVals = rowsWithData.flatMap((r) => getLastNValues(r.series, 6));
  const headlineVal = rowsWithData.length
    ? rowsWithData.reduce((sum, r) => {
        const v = latestValue(r.series);
        return sum + (v ?? 0);
      }, 0)
    : null;
  const sparkVals = (() => {
    if (!rowsWithData.length) return [];
    // combine across rows by period index
    const periods = group.periods ?? Object.keys(rowsWithData[0]?.series ?? {});
    return periods.map((p) =>
      rowsWithData.reduce((s, r) => s + (r.series[p] ?? 0), 0)
    ).filter((v) => v > 0).slice(-12);
  })();

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <span className="shrink-0 text-muted-foreground">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">{group.name}</span>
        <span className="text-[11px] text-muted-foreground">{rowsWithData.length} series</span>
        {sparkVals.length > 1 && (
          <span className="flex items-center gap-1.5">
            <Sparkline values={sparkVals} />
            <TrendBadge vals={sparkVals} />
          </span>
        )}
        {headlineVal !== null && headlineVal > 0 && (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {formatValue(headlineVal, measureType)}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {group.rows.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground italic">No data rows for this KPI group.</p>
          )}
          {group.rows.map((row, ri) => {
            // avg salary sheet: show differently
            if (row.avgAnnualPay !== undefined) {
              return (
                <div key={ri} className="px-4 py-3 flex flex-wrap items-center gap-4 text-xs">
                  <span className="font-medium text-foreground">{row.position}</span>
                  <span className="text-muted-foreground">{row.company}</span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground">
                    {formatValue(row.avgAnnualPay ?? null, "DECIMAL")} avg/yr
                  </span>
                  <span className="text-muted-foreground">{(row.fteCount ?? 0).toFixed(2)} FTE</span>
                  {row.notes && <span className="text-chart-4 text-[10px]">{row.notes}</span>}
                </div>
              );
            }

            const rowVals = getLastNValues(row.series, 12);
            const latest = latestValue(row.series);
            return (
              <div key={ri} className="px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {row.serviceLine && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border text-muted-foreground">
                        {row.serviceLine}
                      </span>
                    )}
                    {row.definition && (
                      <span className="text-muted-foreground truncate">{row.definition}</span>
                    )}
                  </div>
                  {row.benchmark && (
                    <div className="mt-1 text-[10px] text-muted-foreground/70">
                      Benchmark: <span className="text-foreground/60">{row.benchmark}</span>
                    </div>
                  )}
                </div>
                {rowVals.length > 1 && (
                  <span className="flex items-center gap-1.5">
                    <Sparkline values={rowVals} />
                    <TrendBadge vals={rowVals} />
                  </span>
                )}
                {latest !== null && (
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatValue(latest, measureType)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SchemaView({ schema }: { schema: KpiSchema }) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [showSchema, setShowSchema] = useState(false);

  const measureCol = schema.columns.find((c) => c.role === "measure");
  const measureType = measureCol?.type ?? "number";

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return schema.kpis.filter((k) => {
      if (!q) return true;
      if (k.name.toLowerCase().includes(q)) return true;
      return k.rows.some(
        (r) =>
          r.serviceLine?.toLowerCase().includes(q) ||
          r.definition?.toLowerCase().includes(q)
      );
    });
  }, [schema.kpis, search]);

  return (
    <div className="flex flex-col gap-4">
      {/* Schema header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] px-2 py-0.5 rounded border font-medium capitalize", domainColor(schema.domain))}>
            {schema.domain}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded border bg-muted border-border text-muted-foreground capitalize">
            {schema.frequency}
          </span>
          {schema.serviceLines.map((sl) => (
            <span key={sl} className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border text-muted-foreground">
              {sl}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{schema.description}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "KPI Groups",   value: schema.kpis.length,   icon: BarChart2 },
          { label: "Columns",      value: schema.columns.length, icon: Layers    },
          { label: "Service Lines",value: schema.serviceLines.length, icon: Filter },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-muted/40 border border-border rounded-lg px-3 py-2.5 flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search KPIs, service lines, definitions..."
          className="w-full bg-muted border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Schema toggle */}
      <button
        onClick={() => setShowSchema((s) => !s)}
        className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded border border-border hover:border-primary/40"
      >
        <Table className="w-3.5 h-3.5" />
        {showSchema ? "Hide" : "Show"} column schema
      </button>
      {showSchema && <ColumnSchema columns={schema.columns} />}

      {/* KPI groups */}
      <div className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">No KPIs match your search.</p>
          </div>
        )}
        {filtered.map((group, i) => (
          <KpiGroupCard
            key={group.id}
            group={group}
            measureType={measureType}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function KpiScorecardEngine() {
  const [summaries, setSummaries] = useState<SchemaSummary[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [activeSchema, setActiveSchema] = useState<KpiSchema | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sheet list
  useEffect(() => {
    setLoadingList(true);
    fetch("/api/schema/kpi-scorecard")
      .then((r) => r.json())
      .then((d) => {
        setSummaries(d.schemas ?? []);
        if (d.schemas?.length) setActiveId(d.schemas[0].id);
      })
      .catch(() => setError("Failed to load KPI scorecard."))
      .finally(() => setLoadingList(false));
  }, []);

  // Load selected sheet detail
  useEffect(() => {
    if (!activeId) return;
    setLoadingSheet(true);
    setActiveSchema(null);
    fetch(`/api/schema/kpi-scorecard?sheet=${activeId}`)
      .then((r) => r.json())
      .then((d) => setActiveSchema(d))
      .catch(() => setError("Failed to load sheet data."))
      .finally(() => setLoadingSheet(false));
  }, [activeId]);

  const activeSummary = summaries.find((s) => s.id === activeId);

  if (loadingList) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading KPI scorecard schemas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <AlertCircle className="w-6 h-6 text-chart-5" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">KPI Scorecard</h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-medium">
              {summaries.length} sheets
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Parsed from <span className="font-mono text-foreground/70">KPI Scorecard.xlsx</span> — {summaries.reduce((a, s) => a + s.kpiCount, 0)} KPI groups across all service lines
          </p>
        </div>
        <a
          href="/api/schema/kpi-scorecard"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border hover:border-primary/40"
        >
          <Download className="w-3.5 h-3.5" />
          Export JSON
        </a>
      </div>

      {/* Sheet tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-border -mb-1 pb-0">
        {summaries.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
              activeId === s.id
                ? cn("border-primary text-primary", DOMAIN_TAB_ACTIVE[s.domain] ?? "border-primary text-primary")
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                {
                  executive:  "bg-primary",
                  finance:    "bg-chart-5",
                  hr:         "bg-chart-4",
                  clinical:   "bg-chart-3",
                  operations: "bg-chart-2",
                }[s.domain] ?? "bg-muted-foreground"
              )}
            />
            {s.title}
            <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">
              {s.kpiCount}
            </span>
          </button>
        ))}
      </div>

      {/* Active sheet content */}
      <div>
        {loadingSheet && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading {activeSummary?.title}...</span>
          </div>
        )}
        {!loadingSheet && activeSchema && (
          <SchemaView schema={activeSchema} />
        )}
      </div>
    </div>
  );
}
