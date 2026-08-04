"use client";

import useSWR from "swr";
import { TrendingUp, Users, ClipboardCheck, Activity, Loader2 } from "lucide-react";
import type { DashboardKpiKey, DashboardSummary } from "@/lib/services/dashboardSummary";

interface KpiMeta {
  label: string;
  icon: React.ElementType;
  color: string;
  kpiKey: DashboardKpiKey;
  formatValue: (value: number) => string;
  demoValue: string;
  demoDelta: string;
  demoDeltaPositive: boolean;
}

const KPI_DEFS: KpiMeta[] = [
  {
    label: "Weekly Admissions", icon: TrendingUp, color: "text-primary", kpiKey: "admissions",
    formatValue: (value) => value.toLocaleString(), demoValue: "247", demoDelta: "+12.4% vs last week", demoDeltaPositive: true,
  },
  {
    label: "Active Census", icon: Users, color: "text-chart-2", kpiKey: "census",
    formatValue: (value) => value.toLocaleString(), demoValue: "1,842", demoDelta: "+3.1% vs last week", demoDeltaPositive: true,
  },
  {
    label: "Recerts", icon: ClipboardCheck, color: "text-chart-5", kpiKey: "recerts",
    formatValue: (value) => value.toLocaleString(), demoValue: "64", demoDelta: "+4.9% vs last week", demoDeltaPositive: true,
  },
  {
    label: "Discharges", icon: Activity, color: "text-chart-3", kpiKey: "discharges",
    formatValue: (value) => value.toLocaleString(), demoValue: "89", demoDelta: "+5.6% vs last week", demoDeltaPositive: true,
  },
];

async function fetchSummary(url: string): Promise<DashboardSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Dashboard summary failed (${response.status})`);
    return response.json() as Promise<DashboardSummary>;
  } finally {
    clearTimeout(timer);
  }
}

function KpiCard({ def, summary, loading }: { def: KpiMeta; summary?: DashboardSummary; loading: boolean }) {
  const result = summary?.kpis[def.kpiKey];
  const live = result?.status === "ok" && result.value !== null;
  const displayValue = live ? def.formatValue(result.value as number) : def.demoValue;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-medium">{def.label}</p>
        <div className="p-1.5 rounded-md bg-muted"><def.icon className={`w-3.5 h-3.5 ${def.color}`} /></div>
      </div>
      <div>
        {loading ? (
          <div className="flex items-center gap-2 h-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <p className="text-2xl font-semibold text-foreground">{displayValue}</p>
        )}
        <p className={`text-xs mt-1 ${live || def.demoDeltaPositive ? "text-chart-3" : "text-destructive"}`}>
          {loading ? "" : live ? "Live data" : def.demoDelta}
        </p>
      </div>
      {!loading && !live && (
        <span className="self-start text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
          unavailable · demo
        </span>
      )}
    </div>
  );
}

export function KpiCards() {
  const { data, isLoading } = useSWR("/api/dashboard/summary", fetchSummary, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    refreshInterval: 60_000,
    shouldRetryOnError: false,
  });

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {KPI_DEFS.map((def) => <KpiCard key={def.kpiKey} def={def} summary={data} loading={isLoading} />)}
    </div>
  );
}
