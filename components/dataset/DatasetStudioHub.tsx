"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, GitMerge, Layers, Network, Send } from "lucide-react";
import { DatasetDesigner, type DatasetWorkflowState } from "@/components/dataset/DatasetDesigner";
import { cn } from "@/lib/utils";

type DatasetTab = "discover" | "build" | "relationships" | "semantics" | "validate" | "publish" | "history";
type CanonicalDatasetTab = "build" | "relationships" | "semantics" | "publish";
type DesignerStage = "discovery" | "canvas" | "relationships" | "datasets" | "validation" | "lineage";

const TABS: Array<{ id: CanonicalDatasetTab; label: string; icon: React.ElementType; description: string; designerStage: DesignerStage }> = [
  { id: "build", label: "Build", icon: Layers, description: "Discover governed source tables, select them, and assemble the dataset canvas without leaving this stage.", designerStage: "canvas" },
  { id: "relationships", label: "Relationships", icon: GitMerge, description: "Define and validate explicit join paths across selected source tables.", designerStage: "relationships" },
  { id: "semantics", label: "Semantics", icon: BookOpen, description: "Define dimensions, measures, ownership, glossary mappings, and business rules.", designerStage: "datasets" },
  { id: "publish", label: "Published", icon: Send, description: "Review immutable published revisions, inspect generated read-only SQL, and run previews explicitly.", designerStage: "datasets" },
];

interface DatasetStudioHubProps {
  initialTab?: DatasetTab;
  onNavigate?: (view: string) => void;
}

function normalizeTab(tab: DatasetTab): CanonicalDatasetTab {
  if (tab === "discover") return "build";
  if (tab === "validate" || tab === "history") return "publish";
  return tab;
}

export function DatasetStudioHub({ initialTab = "build", onNavigate }: DatasetStudioHubProps) {
  const [tab, setTab] = useState<CanonicalDatasetTab>(normalizeTab(initialTab));
  const [workflow, setWorkflow] = useState<DatasetWorkflowState>({ tableCount: 0, acceptedRelationshipCount: 0, datasetCount: 0, selectedDatasetId: null, selectedDatasetStatus: null });
  const [guardMessage, setGuardMessage] = useState<string | null>(null);

  useEffect(() => { setTab(normalizeTab(initialTab)); }, [initialTab]);

  const active = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);
  const activeIndex = TABS.findIndex((item) => item.id === tab);
  const handleWorkflowStateChange = useCallback((state: DatasetWorkflowState) => setWorkflow(state), []);

  function guardFor(target: CanonicalDatasetTab): string | null {
    if (["relationships", "semantics"].includes(target) && workflow.tableCount === 0) return "Select at least one governed source table in Build before continuing.";
    return null;
  }

  function moveTo(target: CanonicalDatasetTab) {
    const message = guardFor(target);
    if (message) { setGuardMessage(message); return; }
    setGuardMessage(null);
    setTab(target);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Dataset Builder workflow">
      <header className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Network className="size-4" /></span>
            <div><h2 className="text-sm font-semibold text-foreground">Dataset Builder</h2><p className="mt-0.5 text-xs text-muted-foreground">One governed path from source discovery to publication</p></div>
          </div>
          <span className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">Validated datasets → Schema Hub, Reports, and BI Studio</span>
        </div>
      </header>

      <nav className="flex overflow-x-auto border-b border-border bg-card" aria-label="Dataset workflow stages">
        {TABS.map((item, index) => {
          const Icon = item.icon;
          const complete = index < activeIndex;
          const selected = item.id === tab;
          return (
            <button key={item.id} type="button" onClick={() => moveTo(item.id)} aria-current={selected ? "step" : undefined} className={cn("flex min-w-fit flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors", selected ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground")}>
              <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold", selected ? "border-primary bg-primary text-primary-foreground" : complete ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/30")}>{complete ? <CheckCircle2 className="size-3" /> : index + 1}</span>
              <Icon className="size-3.5" />{item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-5 py-2.5"><active.icon className="size-3.5 shrink-0 text-primary" /><p className="text-[11px] text-muted-foreground">{active.description}</p></div>
      {guardMessage && <div role="alert" className="border-b border-chart-5/30 bg-chart-5/10 px-5 py-3 text-xs text-foreground"><span className="font-semibold">Stage blocked.</span> {guardMessage}</div>}

      <div className="p-5">
        <DatasetDesigner
          initialTab={active.designerStage}
          studioMode={tab === "publish" ? "published" : tab}
          showStageTabs={false}
          onWorkflowStateChange={handleWorkflowStateChange}
          onNavigate={(id) => onNavigate?.(id === "registry" ? "schema" : id)}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/10 px-5 py-3 text-[10px] text-muted-foreground">
        <span>{workflow.tableCount} selected tables · {workflow.acceptedRelationshipCount} accepted relationships</span>
        <span>{workflow.datasetCount} semantic definitions · explicit navigation only</span>
      </footer>
    </section>
  );
}
