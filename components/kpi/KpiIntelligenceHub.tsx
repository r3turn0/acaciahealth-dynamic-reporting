"use client";

/**
 * KpiIntelligenceHub
 *
 * Single governed KPI surface — replaces 3 previously separate nav items:
 *   KPI Explorer  |  KPI Schema Admin  |  KPI Intelligence
 *
 * Tabs:
 *   intelligence  — AI-powered analysis, trends, root-cause (KpiIntelligence)
 *   registry      — Browse all KPI definitions, single source of truth (KpiExplorer)
 *   admin         — Create, version, approve, publish KPI definitions (KpiSchemaAdmin)
 *
 * Spec: KPI Intelligence is primary item #5 in the 7-item nav.
 *       No KPI logic may exist outside this hub.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Brain,
  BookOpen,
  SlidersHorizontal,
  TrendingUp,
  Lock,
} from "lucide-react";
import { KpiIntelligence } from "@/components/dashboard/KpiIntelligence";
import { KpiExplorer }     from "@/components/dashboard/KpiExplorer";
import { KpiSchemaAdmin }  from "@/components/kpi-admin/KpiSchemaAdmin";

// ── Tab definitions ───────────────────────────────────────────────────────────

type KpiTab = "intelligence" | "registry" | "admin";

const TABS: {
  id:          KpiTab;
  label:       string;
  icon:        React.ElementType;
  description: string;
  adminOnly?:  boolean;
}[] = [
  {
    id:          "intelligence",
    label:       "KPI Intelligence",
    icon:        Brain,
    description: "AI-powered KPI analysis — trends, variance, root cause, anomaly detection, and executive summaries",
  },
  {
    id:          "registry",
    label:       "KPI Registry",
    icon:        BookOpen,
    description: "Single source of truth — all KPI definitions, formulas, ownership, lineage, and Power BI measures",
  },
  {
    id:          "admin",
    label:       "KPI Governance",
    icon:        SlidersHorizontal,
    adminOnly:   false,                // Analysts can view; Admins can edit
    description: "Version, approve, and publish KPI definitions — governance-controlled schema v6.0",
  },
];

interface KpiIntelligenceHubProps {
  initialTab?: KpiTab;
  userRole?:   "Admin" | "Analyst" | "Viewer";
  onNavigate?: (view: string) => void;
}

export function KpiIntelligenceHub({
  initialTab = "intelligence",
  userRole   = "Analyst",
  onNavigate,
}: KpiIntelligenceHubProps) {
  const [tab, setTab] = useState<KpiTab>(initialTab);

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

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

      {/* Tab strip */}
      <div className="flex items-stretch border-b border-border overflow-x-auto bg-card shrink-0">
        {TABS.map(({ id, label, icon: Icon, adminOnly }) => (
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
            {adminOnly && userRole !== "Admin" && (
              <Lock className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Description bar */}
      <div className="flex items-center gap-2 px-5 py-2 bg-muted/20 border-b border-border/60">
        {activeTab && <activeTab.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <p className="text-[11px] text-muted-foreground">{activeTab?.description}</p>
      </div>

      {/* Tab content */}
      <div className="p-0">
        {tab === "intelligence" && <KpiIntelligence />}
        {tab === "registry"     && (
          <div className="p-5">
            <KpiExplorer />
          </div>
        )}
        {tab === "admin"        && (
          <div className="p-5">
            <KpiSchemaAdmin userRole={userRole} />
          </div>
        )}
      </div>
    </div>
  );
}
