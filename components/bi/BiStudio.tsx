"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  LayoutDashboard,
  BookMarked,
  FileSpreadsheet,
  Sparkles,
  ChevronDown,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBiStore } from "@/lib/hooks/useBiStore";
import { DatasetBuilder } from "./DatasetBuilder";
import { KpiExplorerCanvas, type ExplorerSeed } from "./KpiExplorerCanvas";
import { ReportManager } from "./ReportManager";
import { ExcelImport } from "./ExcelImport";
import { AiCopilot } from "./AiCopilot";
import { WorkspacePage } from "./WorkspacePage";
import type { KpiReport } from "@/lib/bi/types";

type BiTab = "datasets" | "explorer" | "reports" | "import" | "copilot" | "query";

const TABS: { id: BiTab; label: string; icon: React.ElementType }[] = [
  { id: "datasets", label: "Datasets", icon: Boxes },
  { id: "explorer", label: "KPI Explorer", icon: LayoutDashboard },
  { id: "copilot", label: "AI Copilot", icon: Sparkles },
  { id: "query", label: "SQL Workspace", icon: Terminal },
  { id: "reports", label: "Reports", icon: BookMarked },
  { id: "import", label: "Excel Import", icon: FileSpreadsheet },
];

export function BiStudio() {
  const { datasets, reports } = useBiStore();
  const [tab, setTab] = useState<BiTab>("datasets");
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [seed, setSeed] = useState<ExplorerSeed | undefined>(undefined);

  // Resolve the active dataset, defaulting to the most recent one.
  const activeDataset = useMemo(() => {
    if (datasets.length === 0) return null;
    return datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];
  }, [datasets, activeDatasetId]);

  // ── Handoffs ─────────────────────────────────────────────────────────────────
  function openInExplorer(datasetId: string) {
    setActiveDatasetId(datasetId);
    setSeed(undefined);
    setTab("explorer");
  }

  function openReport(report: KpiReport) {
    setActiveDatasetId(report.datasetId);
    setSeed({
      metrics: report.metrics,
      dimensions: report.dimensions,
      filters: report.filters,
      chart: report.chart,
      reportId: report.id,
      reportName: report.name,
    });
    setTab("explorer");
  }

  function onImported(datasetId: string) {
    setActiveDatasetId(datasetId);
    setSeed(undefined);
    setTab("explorer");
  }

  const needsDataset = tab === "explorer" || tab === "copilot";

  return (
    <div className="flex flex-col gap-5">
      {/* Quick-start guide */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Fastest way to start</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed flex-1">
          Upload a spreadsheet and we&apos;ll detect columns, suggest KPIs, and build charts
          automatically. Prefer to define fields yourself? Use the Datasets tab.
        </p>
        <button
          onClick={() => setTab("import")}
          className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" /> Upload a workbook
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-muted/40 border border-border rounded-lg p-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => {
          const count =
            id === "datasets" ? datasets.length : id === "reports" ? reports.length : null;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                tab === id
                  ? "bg-card text-foreground border border-border shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count !== null && count > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Dataset selector for explorer/copilot */}
      {needsDataset && datasets.length > 0 && activeDataset && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Active dataset</span>
          <div className="relative">
            <select
              value={activeDataset.id}
              onChange={(e) => {
                setActiveDatasetId(e.target.value);
                setSeed(undefined);
              }}
              className="appearance-none pl-3 pr-8 py-1.5 rounded-md bg-card border border-border text-sm text-foreground focus:outline-none focus:border-primary cursor-pointer"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.fields.length} fields)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {activeDataset.sampleData.length} sample rows · source: {activeDataset.source}
          </span>
        </div>
      )}

      {/* Panels */}
      {tab === "datasets" && <DatasetBuilder onOpenInExplorer={openInExplorer} />}

      {tab === "explorer" &&
        (activeDataset ? (
          <KpiExplorerCanvas
            key={activeDataset.id}
            dataset={activeDataset}
            seed={seed}
            onSaved={() => undefined}
          />
        ) : (
          <EmptyDataset onGo={() => setTab("datasets")} />
        ))}

      {tab === "copilot" &&
        (activeDataset ? (
          <AiCopilot key={activeDataset.id} dataset={activeDataset} />
        ) : (
          <EmptyDataset onGo={() => setTab("datasets")} />
        ))}

      {tab === "query" && <WorkspacePage />}

      {tab === "reports" && <ReportManager onOpen={openReport} />}

      {tab === "import" && <ExcelImport onDone={(d) => onImported(d.id)} />}
    </div>
  );
}

function EmptyDataset({ onGo }: { onGo: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg p-10 text-center">
      <Boxes className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-medium text-foreground">No dataset yet</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
        Create a dataset in the Dataset Builder (manually or from a CSV/Excel upload), then open it
        here to explore KPIs and build reports.
      </p>
      <button
        onClick={onGo}
        className="mt-4 text-xs text-primary hover:text-primary/80 font-medium"
      >
        Go to Dataset Builder
      </button>
    </div>
  );
}
