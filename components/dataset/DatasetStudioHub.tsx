"use client";

/**
 * DatasetStudioHub
 *
 * Single governed dataset surface — replaces 3 previously separate nav items:
 *   Dataset Designer  |  Build Dataset (DataContractWorkspace)  |  BI Studio dataset tools
 *
 * Workflow tabs (in order):
 *   build     — Design the dataset: discover tables, build canvas, define relationships (DatasetDesigner)
 *   validate  — Validate: schema checks, relationship integrity, Power BI compatibility (DataContractWorkspace)
 *   publish   — Publish: version, register in Schema Hub, expose to reports
 *   history   — Version history and lineage
 *
 * Spec:
 *   - Dataset Studio is primary item #3 in the 7-item nav (workflow step 2)
 *   - Published datasets automatically appear in Schema Hub
 *   - Single dataset design tool — no alternatives
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Layers,
  CheckCircle2,
  Send,
  History,
  ArrowRight,
  GitMerge,
} from "lucide-react";
import { DatasetDesigner }        from "@/components/dataset/DatasetDesigner";
import { DataContractWorkspace }  from "@/components/access/DataContractWorkspace";

// ── Tab definitions ───────────────────────────────────────────────────────────

type DatasetTab = "build" | "validate" | "publish" | "history";

const TABS: {
  id:          DatasetTab;
  step:        number;
  label:       string;
  icon:        React.ElementType;
  description: string;
}[] = [
  {
    id:          "build",
    step:        1,
    label:       "Build Dataset",
    icon:        Layers,
    description: "Discover source tables, drag-and-drop columns, define PK/FK relationships, and create semantic datasets",
  },
  {
    id:          "validate",
    step:        2,
    label:       "Validate",
    icon:        CheckCircle2,
    description: "Schema checks, relationship integrity, duplicate aggregation prevention, and Power BI semantic compatibility",
  },
  {
    id:          "publish",
    step:        3,
    label:       "Publish",
    icon:        Send,
    description: "Version and publish — dataset automatically appears in Schema Hub and becomes available to Reports",
  },
  {
    id:          "history",
    step:        4,
    label:       "Version History",
    icon:        History,
    description: "Inspect all published versions, compare schemas, and trace lineage end-to-end",
  },
];

interface DatasetStudioHubProps {
  initialTab?: DatasetTab;
  onNavigate?: (view: string) => void;
}

export function DatasetStudioHub({ initialTab = "build", onNavigate }: DatasetStudioHubProps) {
  const [tab, setTab] = useState<DatasetTab>(initialTab);

  // Respond to sidebar sub-item clicks while the hub is already mounted
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-0 bg-card border border-border rounded-xl overflow-hidden">
      {/* Workflow header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-muted/30 border-b border-border">
        <GitMerge className="w-3.5 h-3.5 text-primary shrink-0" />
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {TABS.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <button
                onClick={() => setTab(t.id)}
                className={cn(
                  "font-medium transition-colors",
                  tab === t.id ? "text-primary" : "hover:text-foreground"
                )}
              >
                {t.step}. {t.label}
              </button>
              {i < TABS.length - 1 && (
                <ArrowRight className="w-3 h-3 text-border shrink-0" />
              )}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground bg-muted/60 border border-border rounded px-2 py-0.5">
          Published datasets → Schema Hub
        </span>
      </div>

      {/* Tab strip */}
      <div className="flex items-stretch border-b border-border overflow-x-auto bg-card shrink-0">
        {TABS.map(({ id, step, label, icon: Icon }) => (
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
            <span
              className={cn(
                "flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0",
                tab === id
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-muted/60 border-border text-muted-foreground"
              )}
            >
              {step}
            </span>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Description bar */}
      <div className="flex items-center gap-2 px-5 py-2 bg-muted/20 border-b border-border/60">
        {activeTab && <activeTab.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <p className="text-[11px] text-muted-foreground">{activeTab?.description}</p>
      </div>

      {/* Tab content */}
      <div>
        {tab === "build" && (
          <DatasetDesigner
            onNavigate={(id) => {
              // redirect schema/kpi deep-links to the correct primary view
              if (id === "schema" || id === "registry") onNavigate?.("schema");
              else if (id === "kpi")                     onNavigate?.("kpi");
              else                                        onNavigate?.(id);
            }}
          />
        )}

        {tab === "validate" && (
          <DataContractWorkspace />
        )}

        {tab === "publish" && (
          <PublishPanel onNavigateToSchema={() => onNavigate?.("schema")} />
        )}

        {tab === "history" && (
          <VersionHistoryPanel />
        )}
      </div>
    </div>
  );
}

// ── Publish panel placeholder ─────────────────────────────────────────────────

function PublishPanel({ onNavigateToSchema }: { onNavigateToSchema?: () => void }) {
  return (
    <div className="p-8 flex flex-col items-center gap-4 text-center max-w-lg mx-auto">
      <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Send className="w-6 h-6 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">Publish Dataset</h3>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Complete the Build and Validate steps first. Once published, your dataset will automatically
          appear in Schema Hub and become available to Report Studio and BI Studio.
        </p>
      </div>
      <div className="w-full bg-muted/30 border border-border rounded-lg p-4 text-left">
        <p className="text-[11px] font-semibold text-foreground mb-2">On publish, the platform will:</p>
        <ul className="flex flex-col gap-1">
          {[
            "Register a new version in Schema Hub",
            "Expose dataset metadata, measures, and dimensions",
            "Validate Power BI semantic compatibility",
            "Create an immutable audit log entry",
            "Notify dependent reports of the schema change",
          ].map((step) => (
            <li key={step} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-chart-3 shrink-0 mt-0.5" />
              {step}
            </li>
          ))}
        </ul>
      </div>
      {onNavigateToSchema && (
        <button
          onClick={onNavigateToSchema}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          View published datasets in Schema Hub
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Version history panel placeholder ────────────────────────────────────────

function VersionHistoryPanel() {
  const mockVersions = [
    { version: "v3.0", date: "2025-07-15", status: "Published", tables: 8, rows: 142300 },
    { version: "v2.1", date: "2025-06-28", status: "Archived",  tables: 7, rows: 138900 },
    { version: "v2.0", date: "2025-06-01", status: "Archived",  tables: 7, rows: 135200 },
    { version: "v1.2", date: "2025-05-14", status: "Archived",  tables: 5, rows: 121000 },
  ];

  return (
    <div className="p-5">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-5 gap-4 px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest border-b border-border">
          <span>Version</span>
          <span>Published</span>
          <span>Status</span>
          <span>Tables</span>
          <span>Rows</span>
        </div>
        {mockVersions.map((v) => (
          <div
            key={v.version}
            className="grid grid-cols-5 gap-4 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors text-xs text-foreground border border-transparent hover:border-border/60"
          >
            <span className="font-mono font-semibold text-primary">{v.version}</span>
            <span className="text-muted-foreground">{v.date}</span>
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium",
              v.status === "Published" ? "text-chart-3" : "text-muted-foreground"
            )}>
              <CheckCircle2 className="w-3 h-3" />
              {v.status}
            </span>
            <span className="text-muted-foreground">{v.tables}</span>
            <span className="text-muted-foreground">{v.rows.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
