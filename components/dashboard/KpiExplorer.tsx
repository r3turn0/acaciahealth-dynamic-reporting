"use client";

import { useState } from "react";
import { BarChart3, Brain, ExternalLink, Loader2, Sparkles, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import kpiConfig from "@/lib/config/kpiConfig.json";
import { KpiInterpreter } from "./KpiInterpreter";
import { KpiIntelligence } from "./KpiIntelligence";
import {
  useDashboardPins,
  isPinned as isItemPinned,
  pinItem,
  unpinByRef,
} from "@/lib/hooks/useDashboardPins";

type KpiKey = keyof typeof kpiConfig;
type Tab = "definitions" | "interpreter" | "intelligence";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "definitions",  label: "KPI Definitions", icon: BarChart3 },
  { id: "intelligence", label: "KPI Intelligence", icon: Brain },
  { id: "interpreter",  label: "KPI Interpreter",  icon: Sparkles },
];

export function KpiExplorer() {
  const [tab, setTab] = useState<Tab>("definitions");

  // Definitions tab state
  const [selected, setSelected] = useState<KpiKey | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  // Subscribe to the shared pins store so pin/unpin re-renders the cards.
  useDashboardPins();

  async function fetchKpi(kpi: KpiKey) {
    setSelected(kpi);
    setLoading(true);
    try {
      const res = await fetch(`/api/kpi/${kpi}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  async function toggleKpiPin(kpi: KpiKey) {
    const def = kpiConfig[kpi];
    if (isItemPinned("kpi", kpi)) {
      await unpinByRef("kpi", kpi);
    } else {
      await pinItem({
        type: "kpi",
        refId: kpi,
        title: def.label,
        subtitle: def.description,
        kpi,
        meta: {
          aggregation: def.aggregation,
          fact_table: def.fact_table,
          grouping_options: def.grouping_options,
        },
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              tab === id
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Definitions tab */}
      {tab === "definitions" && (
        <div className="flex flex-col gap-5">
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Available KPIs</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.keys(kpiConfig) as KpiKey[]).map((kpi) => {
                const def = kpiConfig[kpi];
                const pinned = isItemPinned("kpi", kpi);
                return (
                  <div
                    key={kpi}
                    className={cn(
                      "relative border rounded-lg transition-colors",
                      selected === kpi
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/30 hover:border-primary/50"
                    )}
                  >
                    <button
                      onClick={() => toggleKpiPin(kpi)}
                      className={cn(
                        "absolute top-2 right-2 p-1 rounded border transition-colors z-10",
                        pinned
                          ? "border-chart-3/40 bg-chart-3/15 text-chart-3"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                      title={pinned ? "Unpin from dashboard" : "Pin to dashboard"}
                      aria-pressed={pinned}
                    >
                      {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() => fetchKpi(kpi)}
                      className="text-left w-full p-3 pr-9"
                    >
                      <p className="text-xs font-semibold text-foreground capitalize">{def.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                        {def.description}
                      </p>
                      <p className="text-[10px] font-mono text-primary mt-2">{def.aggregation}</p>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading KPI definition...
            </div>
          )}

          {data && !loading && (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <ExternalLink className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground capitalize">
                  {selected} — API Definition
                </h3>
              </div>
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-4 overflow-x-auto">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Intelligence tab */}
      {tab === "intelligence" && <KpiIntelligence />}

      {/* Interpreter tab */}
      {tab === "interpreter" && <KpiInterpreter />}
    </div>
  );
}
