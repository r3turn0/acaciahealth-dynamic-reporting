"use client";

import useSWR from "swr";
import { TrendingUp, Users, DollarSign, Activity, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiMeta {
  label: string;
  icon: React.ElementType;
  color: string;
  kpiKey: string;
  prompt: string;
  formatValue: (rows: Record<string, unknown>[]) => string;
  demoValue: string;
  demoDelta: string;
  demoDeltaPositive: boolean;
}

// ── KPI definitions ───────────────────────────────────────────────────────────

const KPI_DEFS: KpiMeta[] = [
  {
    label: "Weekly Admissions",
    icon: TrendingUp,
    color: "text-primary",
    kpiKey: "admissions",
    prompt: "Total admissions this week",
    formatValue: (rows) => {
      const total = rows.reduce((sum, r) => sum + (Number(r.admissions ?? r.total ?? r.count ?? 0)), 0);
      return total > 0 ? total.toLocaleString() : "—";
    },
    demoValue: "247",
    demoDelta: "+12.4% vs last week",
    demoDeltaPositive: true,
  },
  {
    label: "Active Census",
    icon: Users,
    color: "text-chart-2",
    kpiKey: "census",
    prompt: "Active patient census right now",
    formatValue: (rows) => {
      const total = rows.reduce((sum, r) => sum + (Number(r.census ?? r.active_patients ?? r.total ?? r.count ?? 0)), 0);
      return total > 0 ? total.toLocaleString() : "—";
    },
    demoValue: "1,842",
    demoDelta: "+3.1% vs last week",
    demoDeltaPositive: true,
  },
  {
    label: "Billed Revenue (WTD)",
    icon: DollarSign,
    color: "text-chart-5",
    kpiKey: "revenue",
    prompt: "Total billed revenue week to date",
    formatValue: (rows) => {
      const total = rows.reduce((sum, r) => sum + (Number(r.revenue ?? r.total_revenue ?? r.billed_revenue ?? r.total ?? 0)), 0);
      if (total === 0) return "—";
      return total >= 1_000_000
        ? `$${(total / 1_000_000).toFixed(2)}M`
        : `$${total.toLocaleString()}`;
    },
    demoValue: "$1.24M",
    demoDelta: "-2.8% vs last week",
    demoDeltaPositive: false,
  },
  {
    label: "Discharges",
    icon: Activity,
    color: "text-chart-3",
    kpiKey: "discharges",
    prompt: "Total discharges this week",
    formatValue: (rows) => {
      const total = rows.reduce((sum, r) => sum + (Number(r.discharges ?? r.total ?? r.count ?? 0)), 0);
      return total > 0 ? total.toLocaleString() : "—";
    },
    demoValue: "89",
    demoDelta: "+5.6% vs last week",
    demoDeltaPositive: true,
  },
];

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchKpi(kpiKey: string, prompt: string): Promise<Record<string, unknown>[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const res = await fetch("/api/report/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      report_name: `Dashboard KPI — ${kpiKey}`,
      prompt,
      filters: {
        date_range: { start_date: fmt(start), end_date: fmt(end) },
      },
    }),
  });
  if (!res.ok) throw new Error("fetch failed");
  const json = await res.json();
  return (json.data ?? []) as Record<string, unknown>[];
}

// ── Single card ───────────────────────────────────────────────────────────────

function KpiCard({ def }: { def: KpiMeta }) {
  const { data, error, isLoading } = useSWR(
    `kpi-card-${def.kpiKey}`,
    () => fetchKpi(def.kpiKey, def.prompt),
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const isDemo = !data || error;
  const displayValue = data && !error ? def.formatValue(data) : def.demoValue;
  // For demo data we show the static delta; for live data we can't compute WoW without two queries,
  // so we just indicate the source.
  const deltaText = isDemo ? def.demoDelta : "Live data";
  const deltaPositive = isDemo ? def.demoDeltaPositive : true;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-medium">{def.label}</p>
        <div className="p-1.5 rounded-md bg-muted">
          <def.icon className={`w-3.5 h-3.5 ${def.color}`} />
        </div>
      </div>
      <div>
        {isLoading ? (
          <div className="flex items-center gap-2 h-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <p className="text-2xl font-semibold text-foreground">{displayValue}</p>
        )}
        <p className={`text-xs mt-1 ${deltaPositive ? "text-chart-3" : "text-destructive"}`}>
          {isLoading ? "" : deltaText}
        </p>
      </div>
      {isDemo && !isLoading && (
        <span className="self-start text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
          demo
        </span>
      )}
    </div>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────

export function KpiCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {KPI_DEFS.map((def) => (
        <KpiCard key={def.kpiKey} def={def} />
      ))}
    </div>
  );
}
