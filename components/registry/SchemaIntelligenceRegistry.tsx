"use client";

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
  Info,
  Key,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Tag,
  Zap,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegistryTable {
  id: string;
  name: string;
  schema: string;
  domain: string;
  entityType: string;
  columnCount: number;
  pkColumns: string[];
  fkCount: number;
  description: string;
  tags: string[];
  version: string;
  rowEstimate: number;
  lastSyncAt: string;
  owner: string;
  usageCount: number;
  kpiDependencies: string[];
  upstreamTables: string[];
  downstreamTables: string[];
  columnSummary: ColumnEntry[];
}

interface ColumnEntry {
  name: string;
  type: string;
  role: "primary_key" | "foreign_key" | "dimension" | "measure" | "time_dimension" | "audit";
  nullable: boolean;
  description: string;
}

interface LineageNode {
  id: string;
  label: string;
  type: "source" | "transform" | "target" | "kpi";
  depth: number;
  children: string[];
}

interface ScopeMetric {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "flat";
  delta?: string;
  sub: string;
}

// ── Static data ───────────────────────────────────────────────────────────────

const REGISTRY_TABLES: RegistryTable[] = [
  {
    id: "dbo.CLIENT_EPISODES_ALL",
    name: "CLIENT_EPISODES_ALL",
    schema: "dbo",
    domain: "Clinical",
    entityType: "Fact",
    columnCount: 47,
    pkColumns: ["epi_id"],
    fkCount: 6,
    description: "Core patient episode table. One row per active care episode across all service lines. Foundation of admissions, census, discharge, and PDGM KPIs.",
    tags: ["episodes", "census", "admissions", "care_types", "kpi"],
    version: "3.1.2",
    rowEstimate: 284_512,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "Clinical Ops",
    usageCount: 187,
    kpiDependencies: ["ADC", "Census", "Admissions", "Discharge Rate", "LUPA %", "Live Discharge %"],
    upstreamTables: [],
    downstreamTables: ["CLIENT_EPISODE_VISITS_ALL", "PDGM_PERIOD", "Billing.LINE_ITEMS", "CLIENT_EPISODE_RECERT_HISTORY"],
    columnSummary: [
      { name: "epi_id",            type: "int",     role: "primary_key",   nullable: false, description: "Unique episode identifier" },
      { name: "epi_branchcode",    type: "varchar", role: "foreign_key",   nullable: false, description: "FK → BRANCHES" },
      { name: "epi_slid",          type: "int",     role: "foreign_key",   nullable: false, description: "FK → SERVICE_LINES" },
      { name: "epi_SocDate",       type: "date",    role: "time_dimension",nullable: false, description: "Start of Care date" },
      { name: "epi_DischargeDate", type: "date",    role: "time_dimension",nullable: true,  description: "Discharge date (NULL = active)" },
      { name: "epi_payor",         type: "varchar", role: "dimension",     nullable: true,  description: "Primary payor" },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_VISITS_ALL",
    name: "CLIENT_EPISODE_VISITS_ALL",
    schema: "dbo",
    domain: "Clinical",
    entityType: "Fact",
    columnCount: 32,
    pkColumns: ["visit_id"],
    fkCount: 4,
    description: "Visit-level detail — one row per clinical visit. Drives productivity, utilization, and LUPA rate calculations.",
    tags: ["visits", "productivity", "clinical", "kpi"],
    version: "2.8.0",
    rowEstimate: 2_148_932,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "Clinical Ops",
    usageCount: 142,
    kpiDependencies: ["Visit Rate", "LUPA %", "Worker Productivity", "Discipline Mix"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: ["CLIENT_EPISODE_VISIT_NOTES"],
    columnSummary: [
      { name: "visit_id",     type: "int",     role: "primary_key",  nullable: false, description: "Unique visit identifier" },
      { name: "epi_id",       type: "int",     role: "foreign_key",  nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "worker_id",    type: "int",     role: "foreign_key",  nullable: false, description: "FK → WORKER_BASE" },
      { name: "visit_date",   type: "date",    role: "time_dimension",nullable: false, description: "Service date" },
      { name: "visit_points", type: "decimal", role: "measure",      nullable: true,  description: "Productivity points" },
    ],
  },
  {
    id: "dbo.BRANCHES",
    name: "BRANCHES",
    schema: "dbo",
    domain: "Reference",
    entityType: "Dimension",
    columnCount: 12,
    pkColumns: ["branch_code"],
    fkCount: 0,
    description: "Branch dimension — maps 16 active branches to names, regions, counties, and states. Used in nearly every query for geographic slicing.",
    tags: ["branches", "service_lines", "reference"],
    version: "1.4.1",
    rowEstimate: 16,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "Analytics Team",
    usageCount: 264,
    kpiDependencies: ["Branch ADC", "Branch Revenue", "Branch Census"],
    upstreamTables: [],
    downstreamTables: ["CLIENT_EPISODES_ALL", "WORKER_BASE", "Billing.LINE_ITEMS"],
    columnSummary: [
      { name: "branch_code",   type: "varchar", role: "primary_key", nullable: false, description: "PK — matches all FK references" },
      { name: "branch_name",   type: "varchar", role: "dimension",   nullable: false, description: "Display name" },
      { name: "region",        type: "varchar", role: "dimension",   nullable: true,  description: "Regional grouping" },
      { name: "branch_state",  type: "varchar", role: "dimension",   nullable: false, description: "State abbreviation" },
    ],
  },
  {
    id: "dbo.WORKER_BASE",
    name: "WORKER_BASE",
    schema: "dbo",
    domain: "HR",
    entityType: "Dimension",
    columnCount: 24,
    pkColumns: ["worker_id"],
    fkCount: 1,
    description: "Clinician and staff worker registry — 892 active workers. Central to productivity, staffing ratio, and FTE reporting.",
    tags: ["workers", "productivity", "hr"],
    version: "2.1.0",
    rowEstimate: 892,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "HR Analytics",
    usageCount: 89,
    kpiDependencies: ["FTE Count", "Worker Points Achievement %", "Census per EE"],
    upstreamTables: ["BRANCHES"],
    downstreamTables: ["CLIENT_EPISODE_VISITS_ALL"],
    columnSummary: [
      { name: "worker_id",   type: "int",     role: "primary_key", nullable: false, description: "Unique worker ID" },
      { name: "branch_code", type: "varchar", role: "foreign_key", nullable: false, description: "FK → BRANCHES" },
      { name: "worker_name", type: "varchar", role: "dimension",   nullable: false, description: "Full name" },
      { name: "hire_date",   type: "date",    role: "time_dimension",nullable: true, description: "Hire date" },
    ],
  },
  {
    id: "Billing.LINE_ITEMS",
    name: "LINE_ITEMS",
    schema: "Billing",
    domain: "Finance",
    entityType: "Fact",
    columnCount: 38,
    pkColumns: ["li_id"],
    fkCount: 2,
    description: "Billing line items — charges, payments, and adjustments. Foundation for revenue, AR, and claim-status KPIs.",
    tags: ["billing", "revenue", "kpi"],
    version: "4.0.1",
    rowEstimate: 1_892_441,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "Revenue Cycle",
    usageCount: 118,
    kpiDependencies: ["Revenue per Patient Day", "Unbilled Claims", "Contribution Margin"],
    upstreamTables: ["CLIENT_EPISODES_ALL", "Billing.INVOICES"],
    downstreamTables: [],
    columnSummary: [
      { name: "li_id",           type: "int",     role: "primary_key", nullable: false, description: "Unique line item" },
      { name: "epi_id",          type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "li_amount",       type: "decimal", role: "measure",     nullable: false, description: "Billed charge amount" },
      { name: "li_paid",         type: "decimal", role: "measure",     nullable: true,  description: "Paid amount" },
      { name: "li_claim_status", type: "varchar", role: "dimension",   nullable: false, description: "Claim status" },
    ],
  },
  {
    id: "dbo.PDGM_PERIOD",
    name: "PDGM_PERIOD",
    schema: "dbo",
    domain: "Clinical",
    entityType: "Fact",
    columnCount: 22,
    pkColumns: ["period_id"],
    fkCount: 1,
    description: "PDGM 30-day period records — HIPPS codes, LUPA status, and reimbursement type. Required for CMS payment model analytics.",
    tags: ["pdgm", "lupa", "billing", "kpi"],
    version: "1.3.0",
    rowEstimate: 512_890,
    lastSyncAt: "2026-07-20T08:00:00Z",
    owner: "Revenue Cycle",
    usageCount: 71,
    kpiDependencies: ["LUPA %", "PDGM Reimbursement", "HH-CAHPS"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: [],
    columnSummary: [
      { name: "period_id",          type: "int",     role: "primary_key", nullable: false, description: "Unique period" },
      { name: "epi_id",             type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "hipps_code",         type: "varchar", role: "dimension",   nullable: true,  description: "HIPPS code" },
      { name: "is_lupa",            type: "bit",     role: "measure",     nullable: false, description: "LUPA flag" },
      { name: "reimbursement_type", type: "varchar", role: "dimension",   nullable: true,  description: "Early/Late, Community/Institutional" },
    ],
  },
];

const SCOPE_METRICS: ScopeMetric[] = [
  { label: "Total Tables",       value: 125, trend: "up",   delta: "+3",    sub: "vs last sync" },
  { label: "Total Columns",      value: "3.4K", trend: "up", delta: "+41",  sub: "indexed" },
  { label: "FK Relationships",   value: 412, trend: "flat", delta: "0",     sub: "verified" },
  { label: "Semantic Datasets",  value: 38,  trend: "up",   delta: "+2",    sub: "registered" },
  { label: "KPI Dependencies",   value: 49,  trend: "up",   delta: "+1",    sub: "active definitions" },
  { label: "Avg Column Entropy", value: "0.74", trend: "down", delta: "-0.02", sub: "data quality score" },
];

const LINEAGE_NODES: LineageNode[] = [
  { id: "n1",  label: "CLIENT_EPISODES_ALL",       type: "source",    depth: 0, children: ["n3", "n4", "n5", "n6"] },
  { id: "n2",  label: "BRANCHES",                  type: "source",    depth: 0, children: ["n3"] },
  { id: "n3",  label: "DS-001: Enterprise Rpt",    type: "transform", depth: 1, children: ["n7", "n8"] },
  { id: "n4",  label: "DS-002: PDGM Analytics",    type: "transform", depth: 1, children: ["n9"] },
  { id: "n5",  label: "Billing.LINE_ITEMS",         type: "source",    depth: 0, children: ["n3"] },
  { id: "n6",  label: "PDGM_PERIOD",               type: "source",    depth: 0, children: ["n4"] },
  { id: "n7",  label: "KPI: ADC",                  type: "kpi",       depth: 2, children: [] },
  { id: "n8",  label: "KPI: Revenue/Patient Day",  type: "kpi",       depth: 2, children: [] },
  { id: "n9",  label: "KPI: LUPA Rate",            type: "kpi",       depth: 2, children: [] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  service_lines: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  workers:       "bg-chart-2/15 text-chart-2 border-chart-2/30",
  hr:            "bg-chart-4/15 text-chart-4 border-chart-4/30",
};

const DOMAIN_COLORS: Record<string, string> = {
  Clinical:   "text-chart-3 bg-chart-3/10 border-chart-3/20",
  Finance:    "text-chart-5 bg-chart-5/10 border-chart-5/20",
  Reference:  "text-primary bg-primary/10 border-primary/20",
  HR:         "text-chart-2 bg-chart-2/10 border-chart-2/20",
  Billing:    "text-chart-5 bg-chart-5/10 border-chart-5/20",
};

const ENTITY_COLORS: Record<string, string> = {
  Fact:      "text-chart-5 bg-chart-5/10 border-chart-5/20",
  Dimension: "text-primary bg-primary/10 border-primary/20",
  Bridge:    "text-chart-2 bg-chart-2/10 border-chart-2/20",
};

const ROLE_COLORS: Record<ColumnEntry["role"], string> = {
  primary_key:   "text-chart-5",
  foreign_key:   "text-primary",
  dimension:     "text-chart-2",
  measure:       "text-chart-3",
  time_dimension:"text-chart-4",
  audit:         "text-muted-foreground",
};

const ROLE_LABELS: Record<ColumnEntry["role"], string> = {
  primary_key:   "PK",
  foreign_key:   "FK",
  dimension:     "DIM",
  measure:       "M",
  time_dimension:"TIME",
  audit:         "AUD",
};

function TagBadge({ tag }: { tag: string }) {
  const cls = TAG_COLORS[tag] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border", cls)}>
      {tag}
    </span>
  );
}

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up")   return <span className="text-chart-3 text-[10px]">↑</span>;
  if (trend === "down") return <span className="text-destructive text-[10px]">↓</span>;
  return <span className="text-muted-foreground text-[10px]">→</span>;
}

function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, []);
  return { copy, copied };
}

// ── Scope Summary ─────────────────────────────────────────────────────────────

function ScopeSummary({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Schema Registry Scope</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Sync
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {SCOPE_METRICS.map((m) => (
          <div key={m.label} className="bg-muted/15 rounded-lg px-3 py-2.5">
            <p className="text-base font-semibold text-primary">{typeof m.value === "number" ? m.value.toLocaleString() : m.value}</p>
            <p className="text-[11px] text-foreground font-medium">{m.label}</p>
            {m.trend && (
              <div className="flex items-center gap-1 mt-0.5">
                <TrendIcon trend={m.trend} />
                <span className="text-[9px] text-muted-foreground">{m.delta} {m.sub}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Table Detail Drawer ───────────────────────────────────────────────────────

function TableDetailDrawer({ table, onClose }: { table: RegistryTable; onClose: () => void }) {
  const { copy, copied } = useCopyToClipboard();
  const [activeSection, setActiveSection] = useState<"columns" | "lineage" | "kpis">("columns");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl bg-card border-l border-border overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border", DOMAIN_COLORS[table.domain] ?? "text-muted-foreground bg-muted border-border")}>{table.domain}</span>
              <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border", ENTITY_COLORS[table.entityType] ?? "text-muted-foreground bg-muted border-border")}>{table.entityType}</span>
              <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1 py-0.5">v{table.version}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground"
              aria-label="Close drawer"
            >
              <span className="sr-only">Close</span>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
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
              { label: "Columns",  value: table.columnCount },
              { label: "FK Refs",  value: table.fkCount },
              { label: "Query Uses", value: table.usageCount },
            ].map((s) => (
              <div key={s.label} className="bg-muted/20 rounded-lg px-3 py-2 text-center">
                <p className="text-base font-semibold text-primary">{s.value.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="bg-muted/15 border border-border rounded-lg px-4 py-3">
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
            <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-muted/30 border border-border rounded px-2 py-1.5">{table.id}</code>
            <button
              onClick={() => copy(table.id)}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              title="Copy table ID"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-chart-3" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 border-b border-border">
            {(["columns", "lineage", "kpis"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={cn(
                  "text-xs px-3 py-2 font-medium transition-colors border-b-2 -mb-px capitalize",
                  activeSection === s ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {s === "kpis" ? "KPI Dependencies" : s === "lineage" ? "Data Lineage" : "Columns"}
              </button>
            ))}
          </div>

          {/* Columns */}
          {activeSection === "columns" && (
            <div className="flex flex-col gap-0.5">
              {table.columnSummary.map((col) => (
                <div key={col.name} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <span className={cn("text-[8px] font-bold w-8 shrink-0", ROLE_COLORS[col.role])}>
                    {ROLE_LABELS[col.role]}
                  </span>
                  <span className="text-[11px] font-mono text-foreground flex-1 truncate">{col.name}</span>
                  <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1">{col.type}</span>
                  {col.nullable && <span className="text-[8px] text-muted-foreground">NULL</span>}
                </div>
              ))}
              {table.columnSummary.length < table.columnCount && (
                <p className="text-[10px] text-muted-foreground italic py-1">+{table.columnCount - table.columnSummary.length} more columns…</p>
              )}
            </div>
          )}

          {/* Lineage */}
          {activeSection === "lineage" && (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upstream Tables</p>
                {table.upstreamTables.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Source table — no upstream dependencies</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {table.upstreamTables.map((t) => (
                      <div key={t} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground bg-muted/20 rounded px-2 py-1.5">
                        <ArrowRight className="w-3 h-3 text-muted-foreground rotate-180 shrink-0" />
                        {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Downstream Tables</p>
                {table.downstreamTables.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">No downstream dependents</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {table.downstreamTables.map((t) => (
                      <div key={t} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground bg-muted/20 rounded px-2 py-1.5">
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* KPIs */}
          {activeSection === "kpis" && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-muted-foreground">{table.kpiDependencies.length} KPI definitions depend on this table</p>
              {table.kpiDependencies.map((kpi) => (
                <div key={kpi} className="flex items-center gap-2 px-3 py-2 bg-muted/15 border border-border rounded-lg">
                  <Target className="w-3 h-3 text-chart-5 shrink-0" />
                  <span className="text-[11px] text-foreground">{kpi}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer meta */}
          <div className="pt-2 border-t border-border flex flex-wrap gap-3">
            <span className="text-[10px] text-muted-foreground">Owner: <span className="text-foreground">{table.owner}</span></span>
            <span className="text-[10px] text-muted-foreground">Rows: <span className="text-foreground font-mono">{table.rowEstimate.toLocaleString()}</span></span>
            <span className="text-[10px] text-muted-foreground">Last sync: <span className="text-foreground">{new Date(table.lastSyncAt).toLocaleDateString()}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lineage Map ───────────────────────────────────────────────────────────────

function LineageMap() {
  const TYPE_STYLES: Record<LineageNode["type"], string> = {
    source:    "bg-muted/30 border-border text-muted-foreground",
    transform: "bg-primary/10 border-primary/30 text-primary",
    target:    "bg-chart-3/10 border-chart-3/30 text-chart-3",
    kpi:       "bg-chart-5/10 border-chart-5/30 text-chart-5",
  };
  const TYPE_ICONS: Record<LineageNode["type"], React.ElementType> = {
    source:    Database,
    transform: GitMerge,
    target:    Target,
    kpi:       BarChart3,
  };

  const depths = [0, 1, 2];

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Data Lineage Map</p>
        <span className="text-[9px] text-muted-foreground ml-auto">Source → Transform → KPI</span>
      </div>
      <div className="flex gap-6 overflow-x-auto pb-2">
        {depths.map((d) => {
          const nodes = LINEAGE_NODES.filter((n) => n.depth === d);
          return (
            <div key={d} className="flex flex-col gap-3 min-w-[180px]">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
                {d === 0 ? "Source Tables" : d === 1 ? "Semantic Datasets" : "KPI Outputs"}
              </p>
              {nodes.map((node) => {
                const Icon = TYPE_ICONS[node.type];
                return (
                  <div
                    key={node.id}
                    className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium", TYPE_STYLES[node.type])}
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="truncate">{node.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {(["source", "transform", "kpi"] as const).map((t) => (
          <div key={t} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full border", TYPE_STYLES[t])} />
            {t === "source" ? "Source Table" : t === "transform" ? "Semantic Dataset" : "KPI Output"}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type RegistryView = "registry" | "lineage";

export function SchemaIntelligenceRegistry() {
  const [view, setView] = useState<RegistryView>("registry");
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [selectedTable, setSelectedTable] = useState<RegistryTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  async function handleRefresh() {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
  }

  const domains = useMemo(() => ["all", ...Array.from(new Set(REGISTRY_TABLES.map((t) => t.domain)))], []);
  const entities = useMemo(() => ["all", ...Array.from(new Set(REGISTRY_TABLES.map((t) => t.entityType)))], []);

  const filtered = useMemo(() => REGISTRY_TABLES.filter((t) => {
    const matchSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some((tag) => tag.includes(search.toLowerCase()));
    const matchDomain = domainFilter === "all" || t.domain === domainFilter;
    const matchEntity = entityFilter === "all" || t.entityType === entityFilter;
    return matchSearch && matchDomain && matchEntity;
  }), [search, domainFilter, entityFilter]);

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Scope summary */}
      <ScopeSummary onRefresh={handleRefresh} loading={loading} />

      {/* View switch */}
      <div className="flex gap-1 border-b border-border">
        {(["registry", "lineage"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-4 py-2.5 font-medium transition-colors border-b-2 -mb-px capitalize",
              view === v ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {v === "registry" ? <Database className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
            {v === "registry" ? "Schema Registry" : "Lineage Map"}
          </button>
        ))}
      </div>

      {view === "lineage" && <LineageMap />}

      {view === "registry" && (
        <div className="flex flex-col gap-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tables, descriptions, tags..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="text-xs bg-muted/30 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {domains.map((d) => <option key={d} value={d}>{d === "all" ? "All Domains" : d}</option>)}
            </select>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="text-xs bg-muted/30 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {entities.map((e) => <option key={e} value={e}>{e === "all" ? "All Types" : e}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground shrink-0">{filtered.length} / {REGISTRY_TABLES.length} tables</span>
          </div>

          {/* Table registry list */}
          <div className="flex flex-col gap-2">
            {filtered.map((table) => {
              const isExpanded = expandedRows.has(table.id);
              return (
                <div key={table.id} className="border border-border rounded-lg overflow-hidden">
                  {/* Row header */}
                  <button
                    onClick={() => toggleRow(table.id)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Table2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold font-mono text-foreground">{table.name}</span>
                          <span className="text-[9px] text-muted-foreground font-mono">{table.schema}</span>
                          <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border", DOMAIN_COLORS[table.domain] ?? "text-muted-foreground bg-muted border-border")}>
                            {table.domain}
                          </span>
                          <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border", ENTITY_COLORS[table.entityType] ?? "text-muted-foreground bg-muted border-border")}>
                            {table.entityType}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{table.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <div className="hidden sm:flex gap-3 text-[10px] text-muted-foreground">
                        <span>{table.columnCount} cols</span>
                        <span>{table.rowEstimate.toLocaleString()} rows</span>
                        <span className="text-chart-5">{table.usageCount} uses</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedTable(table); }}
                        className="text-[9px] font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded px-2 py-0.5 transition-colors whitespace-nowrap"
                      >
                        Details
                      </button>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Expanded inline preview */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border bg-muted/5">
                      <div className="flex flex-wrap gap-1.5 mt-3 mb-3">
                        {table.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {table.columnSummary.map((col) => (
                          <div key={col.name} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                            <span className={cn("text-[8px] font-bold w-7 shrink-0", ROLE_COLORS[col.role])}>
                              {ROLE_LABELS[col.role]}
                            </span>
                            <span className="text-[11px] font-mono text-foreground flex-1 truncate">{col.name}</span>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1">{col.type}</span>
                            <span className="text-[9px] text-muted-foreground hidden sm:block truncate max-w-48">{col.description}</span>
                          </div>
                        ))}
                        {table.columnSummary.length < table.columnCount && (
                          <p className="text-[10px] text-muted-foreground italic py-1">+{table.columnCount - table.columnSummary.length} more columns — click Details to view all</p>
                        )}
                      </div>
                      {/* KPI deps summary */}
                      {table.kpiDependencies.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">KPI Dependencies</p>
                          <div className="flex flex-wrap gap-1.5">
                            {table.kpiDependencies.map((kpi) => (
                              <span key={kpi} className="text-[9px] text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1.5 py-0.5">{kpi}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <Search className="w-8 h-8 opacity-30" />
                <p className="text-sm">No tables match your filters</p>
                <button onClick={() => { setSearch(""); setDomainFilter("all"); setEntityFilter("all"); }} className="text-xs text-primary hover:underline">Clear filters</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table detail drawer */}
      {selectedTable && (
        <TableDetailDrawer table={selectedTable} onClose={() => setSelectedTable(null)} />
      )}
    </div>
  );
}
