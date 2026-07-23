"use client";

/**
 * SchemaHub — unified schema tool combining three previously separate tabs:
 *   Schema Explorer   (SchemaViewer)
 *   Metadata Engine   (MetadataReportEngine)
 *   Schema Registry   (SchemaIntelligenceRegistry)
 *
 * Cross-navigation: accepts onNavigate to jump to Dataset Designer or KPI tools.
 */

import { useState, useEffect } from "react";
import { Database, FlaskConical, Network, GitMerge, BarChart3, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { SchemaViewer } from "@/components/dashboard/SchemaViewer";
import { MetadataReportEngine } from "@/components/schema/MetadataReportEngine";
import { SchemaIntelligenceRegistry } from "@/components/registry/SchemaIntelligenceRegistry";

type SchemaHubTab = "explorer" | "metadata" | "registry";

interface SchemaHubProps {
  onNavigate?: (view: string) => void;
  initialTab?: SchemaHubTab;
}

const TABS: { id: SchemaHubTab; label: string; icon: React.ElementType; description: string }[] = [
  {
    id: "explorer",
    label: "Schema Explorer",
    icon: Database,
    description: "Browse live schema — tables, columns, join paths, and semantic layer mappings",
  },
  {
    id: "metadata",
    label: "Metadata Engine",
    icon: FlaskConical,
    description: "AI schema-inference — inspect columns, data types, roles, and join path grounding",
  },
  {
    id: "registry",
    label: "Schema Registry",
    icon: Network,
    description: "Full metadata catalog — table registry, data lineage, tags, and KPI dependencies",
  },
];

export function SchemaHub({ onNavigate, initialTab = "explorer" }: SchemaHubProps) {
  const [tab, setTab] = useState<SchemaHubTab>(initialTab);

  // Sync internal tab when the parent navigates to a specific sub-tab
  // while this component is already mounted (primary stays "schema").
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto w-full">
      {/* Tab bar with descriptions */}
      <div className="flex flex-col gap-0 bg-card border border-border rounded-xl overflow-hidden">
        {/* Tab buttons */}
        <div className="flex items-center gap-0 border-b border-border px-1 pt-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* Active tab description bar */}
        <div className="px-4 py-2 bg-muted/10 flex items-center gap-2 border-b border-border">
          {TABS.filter((t) => t.id === tab).map(({ icon: Icon, description }) => (
            <div key={tab} className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}

          {/* Cross-nav shortcuts */}
          {onNavigate && (
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                onClick={() => onNavigate("designer")}
                className="flex items-center gap-1 text-[10px] text-primary border border-primary/30 rounded px-2 py-1 hover:bg-primary/5 transition-colors"
              >
                <GitMerge className="w-3 h-3" />Dataset Designer
              </button>
              <button
                onClick={() => onNavigate("kpi")}
                className="flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-2 py-1 hover:bg-muted/20 transition-colors"
              >
                <BarChart3 className="w-3 h-3" />KPI Explorer
              </button>
              <button
                onClick={() => onNavigate("kpiadmin")}
                className="flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-2 py-1 hover:bg-muted/20 transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3" />KPI Admin
              </button>
            </div>
          )}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tab === "explorer" && <SchemaViewer />}
          {tab === "metadata" && <MetadataReportEngine />}
          {tab === "registry" && (
            <SchemaIntelligenceRegistry onNavigate={onNavigate} />
          )}
        </div>
      </div>
    </div>
  );
}
