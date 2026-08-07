"use client";

/**
 * Schema Intelligence Registry
 *
 * Three tabs backed by /api/schema/intelligence + /api/kpi-admin:
 *   1. Registry     — browse tables, columns, domains with live search + domain filter
 *   2. Lineage Map  — visual node graph of Source → Dataset → KPI paths
 *   3. KPI Dependencies — live KPI-to-table dependency mapping from kpi-admin API
 *
 * Scope Summary bar at top shows live aggregate metrics.
 * Table drawer shows full column detail + upstream/downstream lineage + KPI dependencies.
 * Cross-nav to Dataset Designer, KPI Explorer, and Schema Intelligence.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileText,
  GitBranch,
  GitMerge,
  Hash,
  Key,
  Layers,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Tag,
  X,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ColumnEntry {
  name:        string;
  type:        string;
  role:        "primary_key" | "foreign_key" | "dimension" | "measure" | "time_dimension" | "audit";
  nullable:    boolean;
  description: string;
}

interface RegistryTable {
  id:               string;
  name:             string;
  schema:           string;
  domain:           string;
  entityType:       string;
  columnCount:      number;
  pkColumns:        string[];
  fkCount:          number;
  description:      string;
  tags:             string[];
  version:          string;
  rowEstimate:      number;
  lastSyncAt:       string;
  owner:            string;
  usageCount:       number;
  kpiDependencies:  string[];
  upstreamTables:   string[];
  downstreamTables: string[];
  columnSummary:    ColumnEntry[];
}

interface LineageNode {
  id:       string;
  label:    string;
  type:     "source" | "transform" | "target" | "kpi";
  depth:    number;
  children: string[];
}

interface ScopeData {
  tables:         number;
  columns:        number;
  relationships:  number;
  datasets:       number;
  kpis:           number;
  reports:        number;
  semanticModels: number;
  unusedTables:   number;
  orphanedRels:   number;
  lastRefresh:    string;
  sourceTableCount?: number;
  provenance?: string;
  correlationId?: string;
}

interface CatalogProvenance {
  sourceFile: string;
  generatedAt: string;
  sourceGeneratedAt: string;
  correlationId: string;
}

interface KpiDef {
  id:       string;
  label:    string;
  category: string;
  version:  string;
  status:   string;
  source:   string;
}

type RegistryTab = "registry" | "lineage" | "kpis";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  Clinical:  "text-chart-3 bg-chart-3/10 border-chart-3/20",
  Finance:   "text-chart-5 bg-chart-5/10 border-chart-5/20",
  Reference: "text-primary bg-primary/10 border-primary/20",
  HR:        "text-chart-2 bg-chart-2/10 border-chart-2/20",
  Billing:   "text-chart-5 bg-chart-5/10 border-chart-5/20",
};

const ENTITY_COLORS: Record<string, string> = {
  Fact:      "text-chart-5 bg-chart-5/10 border-chart-5/20",
  Dimension: "text-primary bg-primary/10 border-primary/20",
  Bridge:    "text-chart-2 bg-chart-2/10 border-chart-2/20",
};

const TAG_COLORS: Record<string, string> = {
  episodes:      "bg-primary/15 text-primary border-primary/30",
  census:        "bg-chart-2/15 text-chart-2 border-chart-2/30",
  admissions:    "bg-chart-3/15 text-chart-3 border-chart-3/30",
  care_types:    "bg-chart-4/15 text-chart-4 border-chart-4/30",
  kpi:           "bg-chart-5/15 text-chart-5 border-chart-5/30",
  billing:       "bg-chart-5/15 text-chart-5 border-chart-5/30",
  revenue:       "bg-chart-3/15 text-chart-3 border-chart-3/30",
  clinical:      "bg-primary/15 text-primary border-primary/30",
  visits:        "bg-chart-2/15 text-chart-2 border-chart-2/30",
  productivity:  "bg-chart-3/15 text-chart-3 border-chart-3/30",
  pdgm:          "bg-chart-5/15 text-chart-5 border-chart-5/30",
  lupa:          "bg-destructive/15 text-destructive border-destructive/30",
  reference:     "bg-muted text-muted-foreground border-border",
  branches:      "bg-chart-4/15 text-chart-4 border-chart-4/30",
  workers:       "bg-chart-2/15 text-chart-2 border-chart-2/30",
  hr:            "bg-chart-4/15 text-chart-4 border-chart-4/30",
};

const ROLE_COLORS: Record<ColumnEntry["role"], string> = {
  primary_key:    "text-chart-5",
  foreign_key:    "text-primary",
  dimension:      "text-chart-2",
  measure:        "text-chart-3",
  time_dimension: "text-chart-4",
  audit:          "text-muted-foreground",
};

const ROLE_LABELS: Record<ColumnEntry["role"], string> = {
  primary_key:    "PK",
  foreign_key:    "FK",
  dimension:      "DIM",
  measure:        "M",
  time_dimension: "TIME",
  audit:          "AUD",
};

const ROLE_ICONS: Record<ColumnEntry["role"], React.ElementType> = {
  primary_key:    Key,
  foreign_key:    Link2,
  measure:        Hash,
  dimension:      Tag,
  time_dimension: Clock,
  audit:          ShieldCheck,
};

function TagBadge({ tag }: { tag: string }) {
  const cls = TAG_COLORS[tag] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border", cls)}>
      {tag}
    </span>
  );
}

function DomainBadge({ domain }: { domain: string }) {
  const cls = DOMAIN_COLORS[domain] ?? "text-muted-foreground bg-muted border-border";
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border", cls)}>
      {domain}
    </span>
  );
}

function EntityBadge({ type }: { type: string }) {
  const cls = ENTITY_COLORS[type] ?? "text-muted-foreground bg-muted border-border";
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border", cls)}>
      {type}
    </span>
  );
}

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up")   return <TrendingUp   className="w-2.5 h-2.5 text-chart-3" />;
  if (trend === "down") return <TrendingDown className="w-2.5 h-2.5 text-destructive" />;
  return <Minus className="w-2.5 h-2.5 text-muted-foreground" />;
}

// ── Scope Summary ─────────────────────────────────────────────────────────────

function ScopeSummary({
  scope,
  loading,
  onRefresh,
}: {
  scope:     ScopeData | null;
  loading:   boolean;
  onRefresh: () => void;
}) {
  const metrics = scope ? [
    { label: "Tables",         value: scope.tables,         trend: "up" as const,   delta: "+3" },
    { label: "Columns",        value: scope.columns.toLocaleString(), trend: "up" as const, delta: "+41" },
    { label: "FK Relationships", value: scope.relationships, trend: "flat" as const, delta: "0" },
    { label: "Semantic Datasets", value: scope.datasets,    trend: "up" as const,   delta: "+2" },
    { label: "Active KPIs",    value: scope.kpis,            trend: "up" as const,   delta: "+1" },
    { label: "Reports",        value: scope.reports,         trend: "flat" as const, delta: "0" },
    { label: "Unused Tables",  value: scope.unusedTables,    trend: "down" as const, delta: "-2" },
    { label: "Orphaned Rels",  value: scope.orphanedRels,    trend: "down" as const, delta: "-1" },
  ] : [];

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Schema Registry Scope</p>
          {scope && (
            <span className="text-[10px] text-muted-foreground">
              — synced {new Date(scope.lastRefresh).toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync
        </button>
      </div>
      {scope ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {metrics.map((m) => (
            <div key={m.label} className="bg-muted/10 rounded-lg px-3 py-2.5">
              <p className="text-base font-semibold text-primary">{typeof m.value === "number" ? m.value.toLocaleString() : m.value}</p>
              <p className="text-[10px] text-foreground font-medium leading-tight">{m.label}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendIcon trend={m.trend} />
                <span className="text-[9px] text-muted-foreground">{m.delta}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading scope metrics…
        </div>
      )}
    </div>
  );
}

// ── Table Detail Drawer ───────────────────────────────────────────────────────

function TableDetailDrawer({
  table,
  allTables,
  onClose,
  onNavigateToDesigner,
}: {
  table:                RegistryTable;
  allTables:            RegistryTable[];
  onClose:              () => void;
  onNavigateToDesigner?: () => void;
}) {
  const [section, setSection] = useState<"columns" | "lineage" | "kpis">("columns");
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const upstream   = allTables.filter((t) => table.upstreamTables.includes(t.name));
  const downstream = allTables.filter((t) => table.downstreamTables.includes(t.name));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl bg-card border-l border-border overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <DomainBadge  domain={table.domain} />
              <EntityBadge  type={table.entityType} />
              <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1 py-0.5">v{table.version}</span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted/50 text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground font-mono">{table.schema}.{table.name}</h2>
          </div>
        </div>

        <div className="px-6 py-4 flex flex-col gap-5">
          {/* Meta stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Columns",    value: table.columnCount },
              { label: "FK Refs",    value: table.fkCount },
              { label: "Query Uses", value: table.usageCount },
            ].map((s) => (
              <div key={s.label} className="bg-muted/15 rounded-lg px-3 py-2 text-center">
                <p className="text-base font-semibold text-primary">{s.value.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="bg-muted/10 border border-border rounded-lg px-4 py-3">
            <p className="text-xs text-foreground leading-relaxed">{table.description}</p>
          </div>

          {/* Tags */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {table.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
            </div>
          </div>

          {/* Copy ID */}
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-muted/30 border border-border rounded px-2 py-1.5 truncate">{table.id}</code>
            <button
              onClick={() => copy(table.id)}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors shrink-0"
              title="Copy table ID"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-chart-3" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Section tabs */}
          <div className="flex gap-0 border-b border-border">
            {([
              { id: "columns", label: "Columns" },
              { id: "lineage", label: "Data Lineage" },
              { id: "kpis",    label: "KPI Dependencies" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  "text-xs px-3 py-2 font-medium transition-colors border-b-2 -mb-px",
                  section === s.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Columns */}
          {section === "columns" && (
            <div className="flex flex-col gap-0.5">
              {table.columnSummary.map((col) => {
                const Icon = ROLE_ICONS[col.role];
                return (
                  <div key={col.name} className="flex items-center gap-2.5 py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-1 w-12 shrink-0">
                      <Icon className={cn("w-3 h-3", ROLE_COLORS[col.role])} />
                      <span className={cn("text-[8px] font-bold", ROLE_COLORS[col.role])}>{ROLE_LABELS[col.role]}</span>
                    </div>
                    <span className="text-[11px] font-mono text-foreground flex-1 truncate">{col.name}</span>
                    <span className="text-[9px] font-mono text-muted-foreground bg-muted/30 rounded px-1 shrink-0">{col.type}</span>
                    {col.nullable && <span className="text-[8px] text-muted-foreground shrink-0">NULL</span>}
                  </div>
                );
              })}
              {table.columnSummary.length < table.columnCount && (
                <p className="text-[10px] text-muted-foreground italic py-1">+{table.columnCount - table.columnSummary.length} more columns…</p>
              )}
            </div>
          )}

          {/* Lineage */}
          {section === "lineage" && (
            <div className="flex flex-col gap-4">
              {upstream.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <GitBranch className="w-3 h-3" />Upstream (Sources)
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {upstream.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-2 bg-muted/10 border border-border rounded-lg">
                        <Table2 className="w-3 h-3 text-chart-2 shrink-0" />
                        <span className="text-xs font-mono text-foreground">{t.name}</span>
                        <DomainBadge domain={t.domain} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {downstream.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ArrowRight className="w-3 h-3" />Downstream (Dependents)
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {downstream.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-2 bg-muted/10 border border-border rounded-lg">
                        <Table2 className="w-3 h-3 text-chart-3 shrink-0" />
                        <span className="text-xs font-mono text-foreground">{t.name}</span>
                        <DomainBadge domain={t.domain} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {upstream.length === 0 && downstream.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No lineage connections registered for this table.</p>
              )}
              {onNavigateToDesigner && (
                <button
                  onClick={onNavigateToDesigner}
                  className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors w-fit"
                >
                  <GitMerge className="w-3 h-3" />Open in Dataset Designer
                </button>
              )}
            </div>
          )}

          {/* KPI Dependencies */}
          {section === "kpis" && (
            <div className="flex flex-col gap-2">
              {table.kpiDependencies.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No KPI dependencies registered for this table.</p>
              ) : (
                table.kpiDependencies.map((kpi) => (
                  <div key={kpi} className="flex items-center gap-2 px-3 py-2 bg-muted/10 border border-border rounded-lg">
                    <BarChart3 className="w-3 h-3 text-chart-5 shrink-0" />
                    <span className="text-xs text-foreground flex-1">{kpi}</span>
                    <span className="text-[9px] bg-chart-5/10 text-chart-5 border border-chart-5/20 rounded px-1.5 py-0.5">KPI</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lineage Map View ──────────────────────────────────────────────────────────

const NODE_COLORS: Record<LineageNode["type"], { bg: string; border: string; text: string; icon: React.ElementType }> = {
  source:    { bg: "bg-primary/10",    border: "border-primary/30",    text: "text-primary",          icon: Database   },
  transform: { bg: "bg-chart-2/10",   border: "border-chart-2/30",    text: "text-chart-2",          icon: Layers     },
  target:    { bg: "bg-chart-3/10",   border: "border-chart-3/30",    text: "text-chart-3",          icon: Target     },
  kpi:       { bg: "bg-chart-5/10",   border: "border-chart-5/30",    text: "text-chart-5",          icon: BarChart3  },
};

function LineageMap({ nodes }: { nodes: LineageNode[] }) {
  const byDepth = useMemo(() => {
    const map = new Map<number, LineageNode[]>();
    for (const n of nodes) {
      const arr = map.get(n.depth) ?? [];
      arr.push(n);
      map.set(n.depth, arr);
    }
    return map;
  }, [nodes]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  return (
    <div className="overflow-x-auto">
      <div className="flex items-start gap-6 min-w-[600px] py-2">
        {Array.from({ length: maxDepth + 1 }, (_, depth) => {
          const col = byDepth.get(depth) ?? [];
          return (
            <div key={depth} className="flex flex-col gap-3 flex-1 min-w-[160px]">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center">
                {depth === 0 ? "Source Tables" : depth === 1 ? "Semantic Datasets" : "KPI Outputs"}
              </p>
              {col.map((node) => {
                const config = NODE_COLORS[node.type];
                const Icon   = config.icon;
                return (
                  <div
                    key={node.id}
                    className={cn(
                      "border rounded-lg px-3 py-2.5 flex items-center gap-2",
                      config.bg, config.border
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5 shrink-0", config.text)} />
                    <span className={cn("text-xs font-medium leading-tight", config.text)}>{node.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Connection lines legend */}
      <div className="flex items-center gap-4 flex-wrap mt-4 pt-4 border-t border-border">
        {(["source", "transform", "target", "kpi"] as const).map((type) => {
          const config = NODE_COLORS[type];
          const Icon   = config.icon;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <div className={cn("w-5 h-5 rounded border flex items-center justify-center", config.bg, config.border)}>
                <Icon className={cn("w-3 h-3", config.text)} />
              </div>
              <span className="text-[10px] text-muted-foreground capitalize">{type === "kpi" ? "KPI Output" : type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── KPI Dependencies Tab ──────────────────────────────────────────────────────

function KpiDependenciesTab({ tables }: { tables: RegistryTable[] }) {
  const [kpis, setKpis] = useState<KpiDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/kpi-admin")
      .then((r) => r.json())
      .then((json: { kpis: KpiDef[] }) => setKpis(json.kpis ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Map KPI → tables that contain it in kpiDependencies
  const kpiTableMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tables) {
      for (const kpiLabel of t.kpiDependencies) {
        const arr = map.get(kpiLabel) ?? [];
        arr.push(t.name);
        map.set(kpiLabel, arr);
      }
    }
    return map;
  }, [tables]);

  const filtered = useMemo(() => {
    if (!search.trim()) return kpis;
    const q = search.toLowerCase();
    return kpis.filter(
      (k) => k.label.toLowerCase().includes(q) || k.category.toLowerCase().includes(q) || k.source.toLowerCase().includes(q)
    );
  }, [kpis, search]);

  const STATUS_COLORS: Record<string, string> = {
    Published: "text-chart-3 bg-chart-3/10 border-chart-3/20",
    Approved:  "text-primary bg-primary/10 border-primary/20",
    Draft:     "text-muted-foreground bg-muted border-border",
    Archived:  "text-muted-foreground bg-muted border-border",
    Validated: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search KPI definitions…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-muted/20 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading KPI definitions…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No KPIs found.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((kpi) => {
            const deps = kpiTableMap.get(kpi.label) ?? [];
            // Also check source table
            const srcTable = tables.find((t) => t.name === kpi.source);
            const allDeps = [...new Set([...deps, srcTable?.name].filter(Boolean))] as string[];
            return (
              <div
                key={kpi.id}
                className="border border-border rounded-lg p-3.5 flex flex-col gap-2.5 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{kpi.label}</p>
                    <p className="text-[10px] text-muted-foreground">{kpi.category} · v{kpi.version}</p>
                  </div>
                  <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0", STATUS_COLORS[kpi.status] ?? "text-muted-foreground bg-muted border-border")}>
                    {kpi.status}
                  </span>
                </div>

                {allDeps.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Source Tables</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allDeps.map((tableName) => (
                        <span key={tableName} className="flex items-center gap-1 text-[10px] bg-muted/20 border border-border rounded px-1.5 py-0.5 font-mono text-muted-foreground">
                          <Table2 className="w-2.5 h-2.5 text-primary shrink-0" />
                          {tableName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {kpi.source && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Database className="w-3 h-3 text-primary shrink-0" />
                    <span>Primary source: </span>
                    <span className="font-mono text-foreground">{kpi.source}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface SchemaIntelligenceRegistryProps {
  onNavigate?: (view: string) => void;
}

export function SchemaIntelligenceRegistry({ onNavigate }: SchemaIntelligenceRegistryProps) {
  const [tab, setTab] = useState<RegistryTab>("registry");
  const [tables, setTables] = useState<RegistryTable[]>([]);
  const [lineage, setLineage] = useState<LineageNode[]>([]);
  const [scope, setScope] = useState<ScopeData | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [provenance, setProvenance] = useState<CatalogProvenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("All");
  const [entityFilter, setEntityFilter] = useState("All");

  // Drawer
  const [selectedTable, setSelectedTable] = useState<RegistryTable | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schema/intelligence");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as {
        tables:      RegistryTable[];
        scope:       ScopeData;
        lineage: LineageNode[];
        domains: string[];
        provenance?: CatalogProvenance;
      };
      setTables(json.tables ?? []);
      setScope(json.scope ?? null);
      setLineage(json.lineage ?? []);
      setDomains(["All", ...(json.domains ?? [])]);
      setProvenance(json.provenance ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schema intelligence data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let list = tables;
    if (domainFilter !== "All") list = list.filter((t) => t.domain === domainFilter);
    if (entityFilter !== "All") list = list.filter((t) => t.entityType === entityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some((tg) => tg.includes(q))
      );
    }
    return list;
  }, [tables, domainFilter, entityFilter, search]);

  const entityTypes = useMemo(() => ["All", ...new Set(tables.map((t) => t.entityType))], [tables]);

  const TABS: { id: RegistryTab; label: string; icon: React.ElementType }[] = [
    { id: "registry", label: "Table Registry",    icon: Database  },
    { id: "lineage",  label: "Lineage Map",        icon: Network   },
    { id: "kpis",     label: "KPI Dependencies",   icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Scope summary */}
      <ScopeSummary scope={scope} loading={loading} onRefresh={loadData} />

      {provenance && (
        <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" aria-label="Catalog provenance">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">Metadata-derived, read-only catalog</p>
              <p className="text-[11px] text-muted-foreground">Source: {provenance.sourceFile} · refreshed {new Date(provenance.sourceGeneratedAt).toLocaleString()}</p>
            </div>
          </div>
          <code className="rounded border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">{provenance.correlationId}</code>
        </aside>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
              tab === id
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tab content */}
      <div className="bg-card border border-border rounded-xl p-5">

        {/* ── Registry tab ── */}
        {tab === "registry" && (
          <div className="flex flex-col gap-4">
            {/* Filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tables, tags, descriptions…"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-muted/20 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  className="text-xs bg-muted/20 border border-border rounded-lg px-2.5 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {domains.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="text-xs bg-muted/20 border border-border rounded-lg px-2.5 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>

            {/* Results count */}
            <p className="text-[11px] text-muted-foreground">{filtered.length} of {tables.length} tables</p>

            {loading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading registry…
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTable(t)}
                    className="border border-border rounded-lg p-4 flex flex-col gap-2.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Table2 className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-sm font-semibold text-foreground font-mono truncate">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{t.schema}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <DomainBadge  domain={t.domain} />
                        <EntityBadge  type={t.entityType} />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{t.description}</p>

                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{t.columnCount} cols · {t.rowEstimate.toLocaleString()} rows · {t.fkCount} FK refs</span>
                      {t.kpiDependencies.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-chart-5">
                          <BarChart3 className="w-3 h-3" />{t.kpiDependencies.length} KPIs
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <BookOpen className="w-3 h-3" />{t.usageCount} queries
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {t.tags.slice(0, 5).map((tag) => <TagBadge key={tag} tag={tag} />)}
                      {t.tags.length > 5 && (
                        <span className="text-[9px] text-muted-foreground">+{t.tags.length - 5}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Lineage tab ── */}
        {tab === "lineage" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
              <Network className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                This lineage map shows how source tables flow through semantic datasets into KPI outputs.
                Click on a table in the Registry tab to see table-level upstream/downstream lineage.
              </p>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading lineage…
              </div>
            ) : (
              <LineageMap nodes={lineage} />
            )}
          </div>
        )}

        {/* ── KPI Dependencies tab ── */}
        {tab === "kpis" && <KpiDependenciesTab tables={tables} />}
      </div>

      {/* Cross-navigation */}
      {onNavigate && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">Continue to:</p>
          <button
            onClick={() => onNavigate("designer")}
            className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
          >
            <GitMerge className="w-3 h-3" />Dataset Designer
          </button>
          <button
            onClick={() => onNavigate("kpiadmin")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/20 transition-colors"
          >
            <BarChart3 className="w-3 h-3" />KPI Schema Admin
          </button>
          <button
            onClick={() => onNavigate("metadata")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" />Metadata Engine
          </button>
        </div>
      )}

      {/* Table detail drawer */}
      {selectedTable && (
        <TableDetailDrawer
          table={selectedTable}
          allTables={tables}
          onClose={() => setSelectedTable(null)}
          onNavigateToDesigner={onNavigate ? () => { setSelectedTable(null); onNavigate("designer"); } : undefined}
        />
      )}
    </div>
  );
}
