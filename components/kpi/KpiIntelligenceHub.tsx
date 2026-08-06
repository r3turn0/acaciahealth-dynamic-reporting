"use client";

/**
 * KpiIntelligenceHub
 *
 * Governed KPI surfaces:
 *   interpreter  — Select a saved report and get AI-powered business interpretation (KpiInterpreter)
 *   registry     — Browse all KPI definitions, single source of truth (KpiExplorer)
 *   governance   — Create, version, approve, publish KPI definitions (KpiSchemaAdmin)
 *
 * Registry mode intentionally excludes Interpreter and Intelligence so the
 * registry does not duplicate separate KPI workflows.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  SlidersHorizontal,
  TrendingUp,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { KpiExplorer }      from "@/components/dashboard/KpiExplorer";
import { KpiSchemaAdmin }   from "@/components/kpi-admin/KpiSchemaAdmin";
import { KpiInterpreter }   from "@/components/dashboard/KpiInterpreter";

// ── Tab definitions ───────────────────────────────────────────────────────────

type KpiTab = "interpreter" | "registry" | "governance";

const TABS: {
  id:          KpiTab;
  label:       string;
  icon:        React.ElementType;
  description: string;
}[] = [
  {
    id:          "interpreter",
    label:       "KPI Interpreter",
    icon:        Sparkles,
    description: "Select a saved report and get AI-powered business interpretation — trends, alerts, root cause, and follow-up Q&A",
  },
  {
    id:          "registry",
    label:       "KPI Registry",
    icon:        BookOpen,
    description: "Single source of truth — all KPI definitions, formulas, ownership, lineage, and Power BI measures",
  },
  {
    id:          "governance",
    label:       "KPI Governance",
    icon:        SlidersHorizontal,
    description: "Version, approve, and publish KPI definitions — governance-controlled schema",
  },
];

interface KpiIntelligenceHubProps {
  initialTab?:            KpiTab;
  preselectedKpi?:        string | null;
  preselectedReportName?: string | null;
  userRole?:              "Admin" | "Analyst" | "Viewer";
  onNavigate?:            (view: string) => void;
  onClearPreselected?:    () => void;
}

export function KpiIntelligenceHub({
  initialTab          = "interpreter",
  preselectedKpi,
  preselectedReportName,
  userRole            = "Analyst",
  onNavigate,
  onClearPreselected,
}: KpiIntelligenceHubProps) {
  const [tab, setTab] = useState<KpiTab>(initialTab);

  // Respond to sidebar sub-item clicks while the hub is already mounted
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // When a KPI is pre-selected from another view, jump to interpreter tab
  useEffect(() => {
    if (preselectedKpi) {
      setTab("interpreter");
    }
  }, [preselectedKpi]);

  const visibleTabs = tab === "interpreter"
    ? TABS.filter((item) => item.id === "interpreter")
    : TABS.filter((item) => item.id === "registry" || item.id === "governance");
  const activeTab = visibleTabs.find((item) => item.id === tab) ?? visibleTabs[0];

  return (
    <div className="flex flex-col gap-0 bg-card border border-border rounded-xl overflow-hidden">
      {/* Authority banner */}
      <div className="flex items-center gap-2.5 px-5 py-3 bg-primary/8 border-b border-primary/20">
        <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
        <p className="text-[11px] text-primary font-medium">
          KPI Registry — Single Source of Truth
        </p>
        <span className="ml-auto text-[10px] text-muted-foreground bg-muted/60 border border-border rounded px-2 py-0.5">
          No KPI logic may exist outside this module
        </span>
      </div>

      {/* Registry navigation only appears when there is more than one related view. */}
      {visibleTabs.length > 1 && (
        <div className="flex items-stretch border-b border-border overflow-x-auto bg-card shrink-0">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
                tab === id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Description bar */}
      <div className="flex items-center gap-2 px-5 py-2 bg-muted/20 border-b border-border/60">
        {activeTab && <activeTab.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <p className="text-[11px] text-muted-foreground">{activeTab?.description}</p>
        {/* Cross-nav: from Interpreter, offer jump to Report Catalog */}
        {tab === "interpreter" && onNavigate && (
          <button
            onClick={() => onNavigate("reports-saved")}
            className="ml-auto flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors shrink-0"
          >
            Report Catalog
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {/* Cross-nav: from Registry, offer jump to Report Studio */}
        {tab === "registry" && onNavigate && (
          <button
            onClick={() => onNavigate("reports")}
            className="ml-auto flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors shrink-0"
          >
            Open Report Studio
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="p-0">
        {tab === "interpreter" && (
          <div className="p-5">
            <KpiInterpreter
              preselectedKpi={preselectedKpi ?? undefined}
              preselectedReportName={preselectedReportName ?? undefined}
            />
          </div>
        )}
        {tab === "registry" && (
          <div className="p-5">
            <KpiExplorer />
          </div>
        )}
        {tab === "governance" && (
          <div className="p-5">
            <KpiSchemaAdmin userRole={userRole} />
          </div>
        )}
      </div>
    </div>
  );
}
