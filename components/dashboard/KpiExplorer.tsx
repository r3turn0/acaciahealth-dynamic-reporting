"use client";

import { useState, useMemo } from "react";
import { BarChart3, Brain, ExternalLink, Loader2, Search, Sparkles, Pin, PinOff, X, Tag } from "lucide-react";
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

// ── Types ─────────────────────────────────────────────────────────────────────

type KpiKey = keyof typeof kpiConfig.kpis;
type Tab = "definitions" | "interpreter" | "intelligence";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "definitions",  label: "KPI Definitions", icon: BarChart3 },
  { id: "intelligence", label: "KPI Intelligence", icon: Brain },
  { id: "interpreter",  label: "KPI Interpreter",  icon: Sparkles },
];

// Colour map for domain badges
const CATEGORY_COLORS: Record<string, string> = {
  "Operations":            "bg-chart-4/15 text-chart-4 border-chart-4/30",
  "Executive":             "bg-primary/15 text-primary border-primary/30",
  "Clinical Operations":   "bg-chart-3/15 text-chart-3 border-chart-3/30",
  "Clinical Quality":      "bg-chart-1/15 text-chart-1 border-chart-1/30",
  "Clinical Compliance":   "bg-chart-1/10 text-chart-1 border-chart-1/20",
  "Quality Assurance":     "bg-chart-2/15 text-chart-2 border-chart-2/30",
  "Referral Management":   "bg-chart-5/15 text-chart-5 border-chart-5/30",
  "Financial Performance": "bg-destructive/15 text-destructive border-destructive/30",
  "Revenue Cycle":         "bg-chart-5/10 text-chart-5 border-chart-5/20",
  "Hospice Performance":   "bg-chart-3/10 text-chart-3 border-chart-3/20",
  "Workforce Performance": "bg-muted text-muted-foreground border-border",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function KpiExplorer() {
  const [tab, setTab] = useState<Tab>("definitions");

  // Definitions tab state
  const [selected, setSelected]   = useState<KpiKey | null>(null);
  const [data, setData]           = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");

  // Subscribe so pin/unpin re-renders
  useDashboardPins();

  // ── Derived data ─────────────────────────────────────────────────────────

  const kpis = kpiConfig.kpis as Record<string, {
    label: string;
    description: string;
    category: string;
    aggregation: string;
    version: string;
    status: string;
    source: string;
    dimensions?: string[];
    formula?: string;
  }>;

  const categories = useMemo(
    () => ["all", ...Object.keys(kpiConfig.categories)],
    []
  );

  const filteredKpis = useMemo(() => {
    const q = search.toLowerCase();
    return (Object.entries(kpis) as [KpiKey, typeof kpis[string]][]).filter(([key, def]) => {
      const matchesSearch =
        !q ||
        key.includes(q) ||
        def.label.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q);
      const matchesCat = filterCat === "all" || def.category === filterCat;
      return matchesSearch && matchesCat;
    });
  }, [kpis, search, filterCat]);

  // Group filtered KPIs by category for the grouped view
  const grouped = useMemo(() => {
    const map: Record<string, [KpiKey, typeof kpis[string]][]> = {};
    for (const [key, def] of filteredKpis) {
      if (!map[def.category]) map[def.category] = [];
      map[def.category].push([key, def]);
    }
    return map;
  }, [filteredKpis]);

  // ── Actions ───────────────────────────────────────────────────────────────

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
    const def = kpis[kpi];
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
          source: def.source,
          category: def.category,
          dimensions: def.dimensions,
        },
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

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

      {/* ── Definitions tab ─────────────────────────────────────────────── */}
      {tab === "definitions" && (
        <div className="flex flex-col gap-5">

          {/* Header + filters */}
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">KPI Catalog</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Schema v{kpiConfig._meta.schemaVersion} &middot; {Object.keys(kpis).length} KPIs across {Object.keys(kpiConfig.categories).length} domains
                </p>
              </div>
              <span className="text-[10px] font-mono text-primary/70 bg-primary/8 border border-primary/20 rounded px-2 py-0.5">
                BRANCH GRAIN &middot; epi_branchcode
              </span>
            </div>

            {/* Search + category filter */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search KPIs by name, description, or category..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg pl-8 pr-7 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <select
                  value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "All Domains" : c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Result count */}
            <p className="text-[11px] text-muted-foreground">
              Showing {filteredKpis.length} of {Object.keys(kpis).length} KPIs
              {filterCat !== "all" && ` in ${filterCat}`}
              {search && ` matching "${search}"`}
            </p>
          </div>

          {/* KPI cards grouped by domain */}
          {Object.keys(grouped).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No KPIs match your filters.
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-foreground">{category}</h3>
                  <span className="text-[10px] text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5">
                    {items.length}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(([kpi, def]) => {
                    const pinned = isItemPinned("kpi", kpi);
                    const catColor = CATEGORY_COLORS[def.category] ?? "bg-muted text-muted-foreground border-border";
                    return (
                      <div
                        key={kpi}
                        className={cn(
                          "relative border rounded-lg transition-all",
                          selected === kpi
                            ? "border-primary bg-primary/8 shadow-sm shadow-primary/10"
                            : "border-border bg-card hover:border-primary/50 hover:bg-accent/10"
                        )}
                      >
                        {/* Pin button */}
                        <button
                          onClick={() => toggleKpiPin(kpi)}
                          className={cn(
                            "absolute top-2.5 right-2.5 p-1 rounded border transition-colors z-10",
                            pinned
                              ? "border-chart-3/40 bg-chart-3/15 text-chart-3"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                          )}
                          title={pinned ? "Unpin from dashboard" : "Pin to dashboard"}
                          aria-pressed={pinned}
                        >
                          {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </button>

                        {/* Card body */}
                        <button
                          onClick={() => fetchKpi(kpi)}
                          className="text-left w-full p-3.5 pr-9"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold text-foreground leading-tight">{def.label}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mb-2.5">
                            {def.description}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${catColor}`}>
                              {def.category}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">
                              {def.aggregation}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">
                              v{def.version}
                            </span>
                            <span className={cn(
                              "text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 border",
                              def.status === "Published"
                                ? "bg-chart-1/10 text-chart-1 border-chart-1/25"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              {def.status}
                            </span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading KPI definition...
            </div>
          )}

          {/* Definition detail panel */}
          {data && !loading && (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <ExternalLink className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground capitalize">
                  {selected} — API Definition
                </h3>
              </div>
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-4 overflow-x-auto max-h-[480px]">
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
