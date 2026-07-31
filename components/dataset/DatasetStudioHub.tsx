"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Database, GitMerge, Layers, Network, Send } from "lucide-react";
import { DatasetDesigner } from "@/components/dataset/DatasetDesigner";
import { cn } from "@/lib/utils";

type DatasetTab = "discover" | "build" | "relationships" | "semantics" | "validate" | "publish" | "history";
type DesignerStage = "discovery" | "canvas" | "relationships" | "datasets" | "validation" | "lineage";

const TABS: Array<{ id: Exclude<DatasetTab, "history">; label: string; icon: React.ElementType; description: string; designerStage: DesignerStage }> = [
  { id: "discover", label: "Discover", icon: Database, description: "Find governed source tables and inspect columns before adding them to the canvas.", designerStage: "discovery" },
  { id: "build", label: "Build", icon: Layers, description: "Assemble source tables and create join paths on the relationship canvas.", designerStage: "canvas" },
  { id: "relationships", label: "Relationships", icon: GitMerge, description: "Review inferred relationships, confidence signals, and accepted join paths.", designerStage: "relationships" },
  { id: "semantics", label: "Semantics", icon: BookOpen, description: "Define reusable datasets, dimensions, measures, ownership, and business meaning.", designerStage: "datasets" },
  { id: "validate", label: "Validate", icon: CheckCircle2, description: "Automatically check schema, mappings, relationships, KPI readiness, and data quality.", designerStage: "validation" },
  { id: "publish", label: "Publish", icon: Send, description: "Publish only validated semantic datasets and expose them to reporting surfaces.", designerStage: "datasets" },
];

interface DatasetStudioHubProps {
  initialTab?: DatasetTab;
  onNavigate?: (view: string) => void;
}

function normalizeTab(tab: DatasetTab): Exclude<DatasetTab, "history"> {
  if (tab === "history") return "publish";
  return tab;
}

export function DatasetStudioHub({ initialTab = "discover", onNavigate }: DatasetStudioHubProps) {
  const [tab, setTab] = useState<Exclude<DatasetTab, "history">>(normalizeTab(initialTab));

  useEffect(() => { setTab(normalizeTab(initialTab)); }, [initialTab]);

  const active = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);
  const activeIndex = TABS.findIndex((item) => item.id === tab);

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
            <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={selected ? "step" : undefined} className={cn("flex min-w-fit flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors", selected ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground")}>
              <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold", selected ? "border-primary bg-primary text-primary-foreground" : complete ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/30")}>{complete ? <CheckCircle2 className="size-3" /> : index + 1}</span>
              <Icon className="size-3.5" />{item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-5 py-2.5"><active.icon className="size-3.5 shrink-0 text-primary" /><p className="text-[11px] text-muted-foreground">{active.description}</p></div>

      <div className="p-5">
        <DatasetDesigner
          initialTab={active.designerStage}
          showStageTabs={false}
          onNavigate={(id) => onNavigate?.(id === "registry" ? "schema" : id)}
        />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/10 px-5 py-3">
        <button type="button" disabled={activeIndex === 0} onClick={() => setTab(TABS[Math.max(0, activeIndex - 1)].id)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40">Previous stage</button>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span>Stage {activeIndex + 1} of {TABS.length}</span><span className="hidden md:inline">Changes remain in the shared session registry.</span></div>
        <button type="button" disabled={activeIndex === TABS.length - 1} onClick={() => setTab(TABS[Math.min(TABS.length - 1, activeIndex + 1)].id)} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">Next stage<ArrowRight className="size-3" /></button>
      </footer>
    </section>
  );
}
