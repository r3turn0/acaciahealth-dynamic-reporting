"use client";

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Brain,
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
import { cn } from "@/lib/utils";
import { FileUploadButton } from "@/components/ui/FileUpload";
import type { UploadedFile } from "@/components/ui/FileUpload";
import type {
  KpiIntelligenceResponse,
  KpiCard,
  Recommendation,
  KpiDefinition,
  KpiRelationship,
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

function SchemaIntelligencePanel({ schema }: { schema: KpiIntelligenceResponse["schemaIntelligence"] }) {
  const [open, setOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<"definitions" | "fields" | "relationships">("definitions");

  const sections = [
    { id: "definitions" as const, label: "KPI Definitions", icon: BookOpen },
    { id: "fields" as const, label: "Field Mapping", icon: Database },
    { id: "relationships" as const, label: "Relationships", icon: GitBranch },
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

  function copy() {
    navigator.clipboard.writeText(json);
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

// ── Ask AI box ────────────────────────────────────────────────────────────────

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
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim()) return;
    setLoading(true);
    setResponse(null);
    const fullQuestion = attachedFile
      ? `${question}\n\n${attachedFile.content}`
      : question;
    try {
      const res = await fetch("/api/generate-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullQuestion, context }),
      });
      const json = await res.json();
      const plan = json.plan;
      if (plan) {
        setResponse(
          `**Strategy:** ${plan.strategy}\n\n**SQL:**\n\`\`\`sql\n${plan.sql}\n\`\`\`\n\n**Explanation:** ${plan.explanation}\n\n**Tables used:** ${(plan.tables_used ?? []).join(", ")}`
        );
      } else {
        setResponse(json.error ?? "No response returned.");
      }
    } catch {
      setResponse("Failed to process request. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-populate when a prompt chip is clicked
  const displayPrompt = activePrompt
    ? `${activePrompt.prompt} — ${activePrompt.kpi}`
    : null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Ask a Question</h3>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {activePrompt && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20">
            <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" />
            <p className="text-xs text-primary flex-1">{displayPrompt}</p>
            <button onClick={onClear} className="text-primary/60 hover:text-primary transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(activePrompt ? `${activePrompt.prompt} for ${activePrompt.kpi}` : input); } }}
              placeholder={activePrompt ? "Press Enter to run this prompt, or type a custom question..." : "E.g. Why did revenue per visit drop in June?"}
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => ask(activePrompt ? `${activePrompt.prompt} for ${activePrompt.kpi}` : input)}
              disabled={loading || (!input.trim() && !activePrompt)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <FileUploadButton
            file={attachedFile}
            onFile={setAttachedFile}
          />
        </div>

        {response && (
          <div className="mt-1 p-3 rounded-lg bg-muted/30 border border-border">
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{response}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main KpiIntelligence component ────────────────────────────────────────────

export function KpiIntelligence() {
  const [data, setData] = useState<KpiIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<KpiCard | null>(null);
  const [activePrompt, setActivePrompt] = useState<{ prompt: string; kpi: string } | null>(null);
  const [filter, setFilter] = useState<"All" | "Financial" | "Clinical" | "Operational">("All");

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
    // Scroll to ask box
    document.getElementById("kpi-ask-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const categories = ["All", "Financial", "Clinical", "Operational"] as const;
  const filteredCards = data?.kpiCards.filter(
    (c) => filter === "All" || c.category === filter
  ) ?? [];

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
            onSelect={(c) => setActiveCard((prev) => prev?.kpiKey === c.kpiKey ? null : c)}
          />
        ))}
      </div>

      {/* Active card detail */}
      {activeCard && (
        <KpiDetailPanel
          card={activeCard}
          onPromptClick={handlePromptClick}
          onClose={() => setActiveCard(null)}
        />
      )}

      {/* Recommendations */}
      <RecommendationsPanel recs={data.recommendations} />

      {/* Ask AI box */}
      <div id="kpi-ask-box">
        <AskAiBox
          context={data.askContext}
          activePrompt={activePrompt}
          onClear={() => setActivePrompt(null)}
        />
      </div>

      {/* Schema Intelligence */}
      <SchemaIntelligencePanel schema={data.schemaIntelligence} />

      {/* Power BI Export */}
      <PowerBiExport schema={data.powerBiSchema} />
    </div>
  );
}
