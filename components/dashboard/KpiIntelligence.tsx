"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  Lightbulb,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import type { KpiEvidenceAnalysis } from "@/lib/services/kpiEvidenceAnalyzer";
import { cn, copyToClipboard } from "@/lib/utils";
import { FileUploadButton } from "@/components/ui/FileUpload";
import type { UploadedFile } from "@/components/ui/FileUpload";
import type {
  KpiIntelligenceResponse,
  KpiCard,
  Recommendation,
  KpiDefinition,
  KpiRelationship,
  BranchEntry,
} from "@/app/api/kpi/intelligence/route";

// ── Utility sub-components ────────────────────────────────────────────────────

function TrendBadge({ trend, changePct }: { trend: "up" | "down" | "flat"; changePct: number }) {
  const map = {
    up: { icon: ArrowUpRight, color: "text-chart-1", bg: "bg-chart-1/10 border-chart-1/25" },
    down: { icon: ArrowDownRight, color: "text-destructive", bg: "bg-destructive/10 border-destructive/25" },
    flat: { icon: ArrowRight, color: "text-muted-foreground", bg: "bg-muted/40 border-border" },
  };
  const { icon: Icon, color, bg } = map[trend];
  const sign = changePct > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${bg} ${color}`}>
      <Icon className="w-3 h-3" />
      {sign}{changePct}%
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? "bg-chart-1" : score >= 0.7 ? "bg-chart-5" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-muted/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">{pct}%</span>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: "High" | "Medium" | "Low" }) {
  const styles = {
    High: "bg-destructive/10 text-destructive border-destructive/25",
    Medium: "bg-chart-5/10 text-chart-5 border-chart-5/25",
    Low: "bg-chart-1/10 text-chart-1 border-chart-1/25",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${styles[impact]}`}>
      {impact}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const styles: Record<string, string> = {
    Financial: "bg-primary/10 text-primary border-primary/25",
    Clinical: "bg-chart-3/10 text-chart-3 border-chart-3/25",
    Operational: "bg-chart-4/10 text-chart-4 border-chart-4/25",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${styles[category] ?? "bg-muted/40 text-muted-foreground border-border"}`}>
      {category}
    </span>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCardComponent({
  card,
  isActive,
  onPromptClick,
  onSelect,
}: {
  card: KpiCard;
  isActive: boolean;
  onPromptClick: (prompt: string, kpiName: string) => void;
  onSelect: (card: KpiCard) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 rounded-xl border transition-all cursor-pointer",
        isActive
          ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
          : "border-border bg-card hover:border-primary/40 hover:bg-accent/20"
      )}
      onClick={() => onSelect(card)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">{card.kpiName}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-bold text-foreground">
              {card.unit === "$"
                ? typeof card.value === "number" && card.value >= 1_000_000
                  ? `$${(card.value / 1_000_000).toFixed(2)}M`
                  : typeof card.value === "number" && card.value >= 1_000
                  ? `$${(card.value / 1000).toFixed(1)}K`
                  : `$${card.value}`
                : card.value}
            </span>
            <span className="text-xs text-muted-foreground">vs {card.unit === "$" && typeof card.priorValue === "number" && card.priorValue >= 1000 ? `$${(card.priorValue as number / 1000).toFixed(1)}K` : card.priorValue}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <TrendBadge trend={card.trend} changePct={card.changePct} />
          <CategoryBadge category={card.category} />
        </div>
      </div>

      {/* Insight */}
      <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">{card.insight}</p>

      {/* Confidence */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Confidence</p>
        <ConfidenceBar score={card.confidenceScore} />
      </div>

      {/* Data quality flags */}
      {card.dataQualityFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.dataQualityFlags.map((flag, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] text-chart-5 bg-chart-5/8 border border-chart-5/20 rounded px-1.5 py-0.5">
              <AlertTriangle className="w-2.5 h-2.5" />
              {flag}
            </span>
          ))}
        </div>
      )}

      {/* Follow-up prompt chips */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
        {card.suggestedPrompts.slice(0, 3).map((p) => (
          <button
            key={p}
            onClick={() => onPromptClick(p, card.kpiName)}
            className="text-[11px] text-primary bg-primary/8 border border-primary/20 rounded-full px-2.5 py-1 hover:bg-primary/15 hover:border-primary/40 transition-colors"
          >
            {p}
          </button>
        ))}
        {card.suggestedPrompts.length > 3 && (
          <span className="text-[11px] text-muted-foreground px-2 py-1">
            +{card.suggestedPrompts.length - 3} more
          </span>
        )}
      </div>
    </div>
  );
}

// ── Active KPI detail panel ───────────────────────────────────────────────────

function KpiDetailPanel({
  card,
  onPromptClick,
  onClose,
}: {
  card: KpiCard;
  onPromptClick: (prompt: string, kpiName: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-card border border-primary/30 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{card.kpiName}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-3xl font-bold text-foreground">
              {card.unit === "$" ? `$${card.value}` : card.value}
            </span>
            <TrendBadge trend={card.trend} changePct={card.changePct} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Prior period: {card.unit === "$" ? `$${card.priorValue}` : card.priorValue} &nbsp;|&nbsp; {card.invoicePeriod}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-foreground">AI Insight</p>
        <p className="text-sm text-foreground/80 leading-relaxed">{card.insight}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-foreground">Confidence Score</p>
        <ConfidenceBar score={card.confidenceScore} />
      </div>

      {card.dataQualityFlags.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">Data Quality Flags</p>
          {card.dataQualityFlags.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-chart-5 bg-chart-5/8 border border-chart-5/20 rounded-lg px-3 py-2">
              <CircleAlert className="w-3.5 h-3.5 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-foreground">All Follow-up Prompts</p>
        <div className="flex flex-wrap gap-2">
          {card.suggestedPrompts.map((p) => (
            <button
              key={p}
              onClick={() => onPromptClick(p, card.kpiName)}
              className="text-[12px] text-primary bg-primary/8 border border-primary/20 rounded-full px-3 py-1.5 hover:bg-primary/15 hover:border-primary/40 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Recommendations panel ─────────────────────────────────────────────────────

function RecommendationsPanel({ recs }: { recs: Recommendation[] }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <Target className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Recommended Actions</h3>
        <span className="ml-auto text-[10px] text-muted-foreground bg-muted/60 border border-border px-1.5 py-0.5 rounded">
          {recs.length} actions
        </span>
      </div>
      <div className="divide-y divide-border">
        {recs.map((rec, i) => (
          <div key={i} className="flex items-start gap-4 px-4 py-3.5 hover:bg-accent/10 transition-colors">
            <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-foreground">{rec.title}</p>
                <ImpactBadge impact={rec.impact} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.reason}</p>
              <p className="text-[10px] text-primary/70 mt-1">Linked KPI: {rec.linkedKpi}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Schema Intelligence panel ─────────────────────────────────────────────────

function SchemaIntelligencePanel({
  schema,
  branches,
}: {
  schema: KpiIntelligenceResponse["schemaIntelligence"];
  branches: BranchEntry[];
}) {
  const [open, setOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<"definitions" | "fields" | "relationships" | "branches">("definitions");

  const sections = [
    { id: "definitions"   as const, label: "KPI Definitions", icon: BookOpen  },
    { id: "fields"        as const, label: "Field Mapping",   icon: Database  },
    { id: "relationships" as const, label: "Relationships",   icon: GitBranch },
    { id: "branches"      as const, label: "Branch Codes",    icon: Building2 },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20 hover:bg-accent/20 transition-colors"
      >
        <Brain className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Schema Intelligence</h3>
        <span className="ml-auto">
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </span>
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-4">
          {/* Section tabs */}
          <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeSection === id
                    ? "bg-card text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3 h-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* KPI Definitions */}
          {activeSection === "definitions" && (
            <div className="flex flex-col gap-3">
              {schema.definitions.map((def, i) => (
                <div key={i} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-foreground">{def.kpiName}</p>
                    <CategoryBadge category={def.category} />
                  </div>
                  <p className="text-[11px] font-mono text-primary/80 bg-muted/50 rounded px-2 py-1">{def.formula}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {def.dependsOn.map((f) => (
                      <span key={f} className="text-[10px] font-mono text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">{f}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Field Mapping */}
          {activeSection === "fields" && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Source Field</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Maps To</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schema.fieldMappings.map((f, i) => (
                    <tr key={i} className="hover:bg-accent/10 transition-colors">
                      <td className="px-3 py-2 font-mono text-primary/80">{f.sourceField}</td>
                      <td className="px-3 py-2 text-foreground">{f.mappedTo}</td>
                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{f.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Relationships */}
          {activeSection === "relationships" && (
            <div className="flex flex-col gap-3">
              {schema.relationships.map((rel, i) => (
                <div key={i} className="p-3 rounded-lg border border-border bg-muted/20 flex flex-col gap-2.5">
                  <p className="text-xs font-semibold text-foreground">{rel.kpi}</p>
                  <div className="flex flex-col gap-1.5 text-[11px]">
                    <div className="flex items-start gap-2">
                      <span className="text-chart-1 font-semibold shrink-0">Driven by:</span>
                      <span className="text-muted-foreground">{rel.drivers.join(", ")}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-destructive font-semibold shrink-0">Impacted by:</span>
                      <span className="text-muted-foreground">{rel.impactedBy.join(", ")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary font-semibold shrink-0">Charts:</span>
                      <div className="flex gap-1">
                        {rel.recommendedCharts.map((c) => (
                          <span key={c} className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Branch Codes */}
          {activeSection === "branches" && (
            <div className="flex flex-col gap-3">
              {/* Summary */}
              <div className="flex gap-3 flex-wrap">
                {(["HOME HEALTH", "HOSPICE"] as const).map((sl) => {
                  const slBranches = branches.filter((b) => b.serviceLine === sl);
                  const slColor = sl === "HOME HEALTH"
                    ? "bg-chart-1/10 text-chart-1 border-chart-1/20"
                    : "bg-chart-3/10 text-chart-3 border-chart-3/20";
                  return (
                    <div key={sl} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${slColor}`}>
                      <Building2 className="w-3 h-3" />
                      {sl} — {slBranches.length} branch{slBranches.length !== 1 ? "es" : ""}
                    </div>
                  );
                })}
              </div>

              {/* Table grouped by service line */}
              {(["HOME HEALTH", "HOSPICE"] as const).map((sl) => {
                const slBranches = branches.filter((b) => b.serviceLine === sl);
                if (!slBranches.length) return null;
                const headerColor = sl === "HOME HEALTH"
                  ? "bg-chart-1/8 text-chart-1 border-chart-1/20"
                  : "bg-chart-3/8 text-chart-3 border-chart-3/20";
                return (
                  <div key={sl} className="rounded-lg border border-border overflow-hidden">
                    <div className={`flex items-center gap-2 px-3 py-2 border-b border-border ${headerColor}`}>
                      <Building2 className="w-3 h-3" />
                      <span className="text-xs font-semibold">{sl}</span>
                      <span className="ml-auto text-[10px] font-mono opacity-70">epi_slid = {slBranches[0].epi_slid}</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border">
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Branch Code</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Branch Name</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {slBranches.map((b) => (
                          <tr key={b.branchCode} className="hover:bg-accent/10 transition-colors">
                            <td className="px-3 py-2 font-mono font-semibold text-primary/80">{b.branchCode}</td>
                            <td className="px-3 py-2 text-foreground">{b.branchName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              {/* DC Class Map */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
                  <span className="text-xs font-semibold text-foreground">Discharge Class Map</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">epi_DcCode → dc_class</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">DC Code</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[
                      { code: "DTH", cls: "Death" },
                      { code: "EXP", cls: "Death" },
                      { code: "REV", cls: "LiveDC-PatientInitiated" },
                      { code: "TRH", cls: "LiveDC-PatientInitiated" },
                      { code: "EXT", cls: "LiveDC-HospiceInitiated" },
                      { code: "NLT", cls: "LiveDC-HospiceInitiated" },
                      { code: "OOA", cls: "LiveDC-HospiceInitiated" },
                      { code: "DFC", cls: "LiveDC-HospiceInitiated" },
                      { code: "TXI", cls: "Other" },
                    ].map(({ code, cls }) => {
                      const clsColor = cls === "Death"
                        ? "text-muted-foreground"
                        : cls.startsWith("LiveDC-Patient")
                        ? "text-destructive"
                        : cls.startsWith("LiveDC-Hospice")
                        ? "text-chart-5"
                        : "text-muted-foreground/70";
                      return (
                        <tr key={code} className="hover:bg-accent/10 transition-colors">
                          <td className="px-3 py-2 font-mono font-semibold text-primary/80">{code}</td>
                          <td className={`px-3 py-2 font-medium ${clsColor}`}>{cls}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Power BI Export drawer ────────────────────────────────────────────────────

function PowerBiExport({ schema }: { schema: KpiIntelligenceResponse["powerBiSchema"] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(schema, null, 2);

  async function copy() {
    await copyToClipboard(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "acacia-kpi-powerbi-schema.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const tables = [
    { key: "factKPI", label: "factKPI", count: schema.factKPI.length, color: "text-primary" },
    { key: "dimKPI", label: "dimKPI", count: schema.dimKPI.length, color: "text-chart-3" },
    { key: "dimDate", label: "dimDate", count: schema.dimDate.length, color: "text-chart-4" },
    { key: "dimBranch", label: "dimBranch", count: schema.dimBranch.length, color: "text-chart-5" },
  ] as const;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20 hover:bg-accent/20 transition-colors"
      >
        <ExternalLink className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Export to Power BI</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground bg-muted/60 border border-border px-1.5 py-0.5 rounded">
            4 tables
          </span>
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-4">
          {/* Table overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tables.map(({ key, label, count, color }) => (
              <div key={key} className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border bg-muted/20">
                <p className={`text-xs font-mono font-semibold ${color}`}>{label}</p>
                <p className="text-lg font-bold text-foreground">{count}</p>
                <p className="text-[10px] text-muted-foreground">rows</p>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copied!" : "Copy JSON"}
            </button>
            <button
              onClick={download}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download JSON
            </button>
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-muted/20 text-muted-foreground/60">
              <ExternalLink className="w-3.5 h-3.5" />
              /api/kpi/intelligence (GET)
            </div>
          </div>

          {/* JSON viewer */}
          <pre className="text-[11px] font-mono text-foreground/70 bg-muted/40 rounded-lg p-4 overflow-auto max-h-72 border border-border/50 leading-relaxed">
            {json}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Date range helpers ────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function defaultRange(): { start: string; end: string } {
  return { start: shiftDays(-30), end: isoDate(new Date()) };
}

const DATE_PRESETS: { label: string; range: () => { start: string; end: string } }[] = [
  { label: "30d", range: () => ({ start: shiftDays(-30), end: isoDate(new Date()) }) },
  { label: "90d", range: () => ({ start: shiftDays(-90), end: isoDate(new Date()) }) },
  { label: "YTD", range: () => ({ start: `${new Date().getFullYear()}-01-01`, end: isoDate(new Date()) }) },
  { label: "1y", range: () => ({ start: shiftDays(-365), end: isoDate(new Date()) }) },
];

// ── Simple plain-text → JSX renderer (no markdown dep needed) ─────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground/85">
      {lines.map((line, i) => {
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-primary mt-1 shrink-0">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// ── Ask AI box ────────────────────────────────────────────────────────────────

interface AskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function AskAiBox({
  context,
  activePrompt,
  onClear,
}: {
  context: string;
  activePrompt: { prompt: string; kpi: string } | null;
  onClear: () => void;
}) {
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<UploadedFile | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(defaultRange().start);
  const [endDate, setEndDate] = useState(defaultRange().end);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const SUGGESTIONS = [
    "Which KPI needs the most attention right now?",
    "Explain the LUPA exposure risk",
    "What's driving the billing holds increase?",
    "Summarise the top 3 actions for leadership",
  ];

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    if (startDate && endDate && startDate > endDate) return;

    const fullQuestion = attachedFile
      ? `${question}\n\n${attachedFile.content}`
      : question;

    const userMsg: AskMessage = { id: Date.now().toString(), role: "user", content: fullQuestion };
    const assistantId = `${Date.now()}-a`;
    const placeholder: AskMessage = { id: assistantId, role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/kpi/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: fullQuestion,
          context,
          kpi: activePrompt?.kpi ?? "",
          start_date: startDate,
          end_date: endDate,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Stream failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m))
        );
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Failed to get a response. Please try again.", streaming: false }
            : m
        )
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function copyMsg(content: string, id: string) {
    await copyToClipboard(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const displayPrompt = activePrompt
    ? `${activePrompt.prompt} — ${activePrompt.kpi}`
    : null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Ask a Question</h3>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Active prompt chip */}
        {activePrompt && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20">
            <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" />
            <p className="text-xs text-primary flex-1">{displayPrompt}</p>
            <button onClick={onClear} className="text-primary/60 hover:text-primary transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Date range */}
        <div className="flex flex-wrap items-end gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 text-primary" /> Date range
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">From</span>
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">To</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </label>
          <div className="flex items-center gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { const r = p.range(); setStartDate(r.start); setEndDate(r.end); }}
                className="text-[11px] px-2 py-1 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Suggestion chips — shown when no messages or always accessible */}
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded-full px-3 py-1 transition-colors bg-muted/30 hover:bg-primary/5 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Message thread */}
        {messages.length > 0 && (
          <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-primary text-primary-foreground text-sm leading-relaxed">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[95%] rounded-xl px-4 py-3 bg-muted border border-border flex flex-col gap-2">
                    {m.streaming && !m.content ? (
                      <span className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Thinking...
                      </span>
                    ) : (
                      <>
                        <SimpleMarkdown text={m.content} />
                        {!m.streaming && (
                          <button
                            onClick={() => copyMsg(m.content, m.id)}
                            className="self-end flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1"
                          >
                            <Copy className="w-3 h-3" />
                            {copiedId === m.id ? "Copied!" : "Copy"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                ask(activePrompt ? `${activePrompt.prompt} for ${activePrompt.kpi}` : input);
              }
            }}
            placeholder={activePrompt ? "Press Enter to run this prompt, or type a custom question..." : "E.g. Why did the LUPA rate increase?"}
            disabled={loading}
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
          />
          <button
            onClick={() => ask(activePrompt ? `${activePrompt.prompt} for ${activePrompt.kpi}` : input)}
            disabled={loading || (!input.trim() && !activePrompt)}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            aria-label="Send"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        <FileUploadButton file={attachedFile} onFile={setAttachedFile} />
      </div>
    </div>
  );
}

function EvidenceAnalysisPanel({
  card,
  analysis,
  loading,
  error,
  onAnalyze,
}: {
  card: KpiCard;
  analysis: KpiEvidenceAnalysis | null;
  loading: boolean;
  error: string | null;
  onAnalyze: (startDate: string, endDate: string) => void;
}) {
  const range = defaultRange();
  const [startDate, setStartDate] = useState(range.start);
  const [endDate, setEndDate] = useState(range.end);
  const modeStyles = {
    live: "bg-chart-1/10 text-chart-1 border-chart-1/25",
    cached: "bg-primary/10 text-primary border-primary/25",
    partial: "bg-chart-5/10 text-chart-5 border-chart-5/25",
    "metadata-fallback": "bg-muted text-muted-foreground border-border",
  };
  const modeLabels = { live: "Live evidence", cached: "Cached evidence", partial: "Partial evidence", "metadata-fallback": "Metadata fallback" };
  const citations = new Map(analysis?.citations.map((citation) => [citation.id, citation]) ?? []);
  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="evidence-analysis-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h3 id="evidence-analysis-title" className="text-sm font-semibold text-foreground">Report evidence analysis</h3>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">Runs only the top governed reports mapped to {card.kpiName} and its dependencies. Static card values remain available as the hybrid fallback.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">From<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs normal-case text-foreground" /></label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">To<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs normal-case text-foreground" /></label>
          <button onClick={() => onAnalyze(startDate, endDate)} disabled={loading || startDate > endDate} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Analyze with report evidence
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5">
        {error && <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {!analysis && !loading && <p className="text-sm text-muted-foreground">Choose a reporting window to generate a cited, evidence-based analysis.</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" />Executing governed reports and validating evidence...</div>}
        {analysis && !loading && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide", modeStyles[analysis.mode])}>{modeLabels[analysis.mode]}</span>
              <span className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] font-mono text-muted-foreground">Confidence {analysis.confidence.score}% · {analysis.confidence.band}</span>
              <span className="text-[10px] text-muted-foreground">{analysis.dateRange.startDate} to {analysis.dateRange.endDate}</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{analysis.executiveSummary}</p>
            {analysis.fallbackReason && <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{analysis.fallbackReason}</p>}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2"><h4 className="text-xs font-semibold text-foreground">Evidence and drivers</h4>{[...analysis.dependencyObservations, ...analysis.keyDrivers].map((item, index) => <div key={`${item.statement}-${index}`} className="rounded-lg border border-border bg-background p-3"><p className="text-xs leading-relaxed text-foreground">{item.statement}</p><p className="mt-2 text-[10px] text-muted-foreground">{item.classification === "hypothesis" ? "Hypothesis" : "Observed fact"} · {item.citationIds.join(", ")}</p></div>)}</div>
              <div className="flex flex-col gap-2"><h4 className="text-xs font-semibold text-foreground">Confidence and gaps</h4>{analysis.confidence.explanation.map((line) => <p key={line} className="text-xs text-muted-foreground">{line}</p>)}{analysis.missingEvidence.length > 0 && <div className="rounded-lg border border-chart-5/25 bg-chart-5/10 p-3"><p className="text-xs font-semibold text-chart-5">Missing evidence</p><p className="mt-1 text-xs text-muted-foreground">{analysis.missingEvidence.join(", ")}</p></div>}</div>
            </div>
            {analysis.citations.length > 0 && <div className="flex flex-col gap-2 border-t border-border pt-4"><h4 className="text-xs font-semibold text-foreground">Sources</h4>{analysis.citations.map((citation) => <div key={citation.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-foreground">[{citation.id}] {citation.reportName}</span><span className="font-mono text-[10px] text-muted-foreground">v{citation.version} · result {citation.resultSet} · {citation.rowCount} rows · {citation.source}</span></div>)}</div>}
            {analysis.recommendations.length > 0 && <div className="flex flex-col gap-2 border-t border-border pt-4"><h4 className="text-xs font-semibold text-foreground">Evidence-based actions</h4>{analysis.recommendations.map((recommendation) => <div key={recommendation.action} className="flex gap-2"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><p className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">{recommendation.action}</span> {recommendation.rationale} {recommendation.citationIds.map((id) => citations.has(id) ? `[${id}]` : "").join(" ")}</p></div>)}</div>}
          </>
        )}
      </div>
    </section>
  );
}

// ── Main KpiIntelligence component ────────────────────────────────────────────

export function KpiIntelligence() {
  const [data, setData] = useState<KpiIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<KpiCard | null>(null);
  const [activePrompt, setActivePrompt] = useState<{ prompt: string; kpi: string } | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [evidenceAnalysis, setEvidenceAnalysis] = useState<KpiEvidenceAnalysis | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kpi/intelligence");
      if (!res.ok) throw new Error("Failed to fetch");
      const json: KpiIntelligenceResponse = await res.json();
      setData(json);
    } catch {
      setError("Failed to load KPI intelligence data.");
    } finally {
      setLoading(false);
    }
  }, []);

  function handlePromptClick(prompt: string, kpiName: string) {
    setActivePrompt({ prompt, kpi: kpiName });
    document.getElementById("kpi-ask-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function analyzeWithEvidence(startDate: string, endDate: string) {
    if (!activeCard) return;
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const response = await fetch("/api/kpi/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiKey: activeCard.kpiKey, startDate, endDate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Evidence analysis failed");
      setEvidenceAnalysis(payload.analysis as KpiEvidenceAnalysis);
    } catch (requestError) {
      setEvidenceError(requestError instanceof Error ? requestError.message : "Evidence analysis failed");
    } finally {
      setEvidenceLoading(false);
    }
  }

  function selectCard(card: KpiCard) {
    setActiveCard((previous) => previous?.kpiKey === card.kpiKey ? null : card);
    setEvidenceAnalysis(null);
    setEvidenceError(null);
  }

  // Derive distinct domain values from the cards so filter tabs always match
  const allDomains = data
    ? Array.from(new Set(data.kpiCards.map((c) => c.domain))).sort()
    : [];
  const categories = ["All", ...allDomains] as string[];
  const filteredCards = (data?.kpiCards ?? []).filter(
    (c) => filter === "All" || c.domain === filter
  );

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!data && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Brain className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-base font-semibold text-foreground">KPI Intelligence</p>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Load KPI cards with AI-generated insights, follow-up prompts, business recommendations, schema intelligence, and a Power BI-ready export.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Load KPI Intelligence
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="text-sm">Loading KPI intelligence...</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-5">

      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground">Invoice Period: <span className="text-foreground font-mono font-medium">{data.invoicePeriod}</span></p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Generated {new Date(data.generatedAt).toLocaleTimeString()}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category filter */}
          <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-0.5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === cat
                    ? "bg-card text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 transition-colors hover:border-primary/40"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredCards.map((card) => (
          <KpiCardComponent
            key={card.kpiKey}
            card={card}
            isActive={activeCard?.kpiKey === card.kpiKey}
            onPromptClick={handlePromptClick}
            onSelect={selectCard}
          />
        ))}
      </div>

      {/* Active card detail */}
      {activeCard && (
        <KpiDetailPanel
          card={activeCard}
          onPromptClick={handlePromptClick}
          onClose={() => { setActiveCard(null); setEvidenceAnalysis(null); }}
        />
      )}

      {activeCard && (
        <EvidenceAnalysisPanel
          card={activeCard}
          analysis={evidenceAnalysis}
          loading={evidenceLoading}
          error={evidenceError}
          onAnalyze={analyzeWithEvidence}
        />
      )}

      {/* Recommendations */}
      <RecommendationsPanel recs={data.recommendations} />

      {/* Ask AI box */}
      <div id="kpi-ask-box">
        <AskAiBox
          context={evidenceAnalysis?.askContext ?? data.askContext}
          activePrompt={activePrompt}
          onClear={() => setActivePrompt(null)}
        />
      </div>

      {/* Schema Intelligence */}
      <SchemaIntelligencePanel
        schema={data.schemaIntelligence}
        branches={data.branchDirectory ?? []}
      />

      {/* Power BI Export */}
      <PowerBiExport schema={data.powerBiSchema} />
    </div>
  );
}
