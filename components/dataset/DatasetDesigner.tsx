"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  GitMerge,
  Info,
  Layers,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type RelType = "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
type RelStatus = "Suggested" | "Accepted" | "Rejected";

interface TableDef {
  name: string;
  schema: string;
  recordCount: number;
  columnCount: number;
  primaryKeys: string[];
  foreignKeys: string[];
  businessDescription: string;
  columns: ColumnDef[];
}

interface ColumnDef {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  nullable: boolean;
  description: string;
}

interface Relationship {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: RelType;
  confidence: number;
  status: RelStatus;
  reasons: string[];
  createdBy: string;
  createdDate: string;
}

interface SemanticDataset {
  datasetId: string;
  datasetName: string;
  description: string;
  tables: string[];
  relationships: string[];
  dimensions: string[];
  measures: string[];
  owner: string;
  version: string;
  status: "Draft" | "Published" | "Deprecated";
  createdDate: string;
}

type DesignerTab = "discovery" | "canvas" | "relationships" | "datasets";

// ── Static source catalog ─────────────────────────────────────────────────────

const SOURCE_TABLES: TableDef[] = [
  {
    name: "CLIENT_EPISODES_ALL",
    schema: "dbo",
    recordCount: 284_512,
    columnCount: 47,
    primaryKeys: ["epi_id"],
    foreignKeys: ["epi_branchcode", "epi_slid", "epi_caretypeid"],
    businessDescription: "Core patient episode table. One row per active care episode across all service lines.",
    columns: [
      { name: "epi_id",            type: "int",      isPk: true,  isFk: false, nullable: false, description: "Primary key — unique episode identifier" },
      { name: "epi_branchcode",    type: "varchar",  isPk: false, isFk: true,  nullable: false, description: "FK → BRANCHES.branch_code" },
      { name: "epi_slid",          type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → SERVICE_LINES.service_line_id" },
      { name: "epi_caretypeid",    type: "int",      isPk: false, isFk: true,  nullable: true,  description: "FK → CARE_TYPES.ct_id" },
      { name: "epi_SocDate",       type: "date",     isPk: false, isFk: false, nullable: false, description: "Start of Care date" },
      { name: "epi_DischargeDate", type: "date",     isPk: false, isFk: false, nullable: true,  description: "Discharge date (NULL = still active)" },
      { name: "epi_payor",         type: "varchar",  isPk: false, isFk: false, nullable: true,  description: "Primary payor classification" },
      { name: "epi_recertDate",    type: "date",     isPk: false, isFk: false, nullable: true,  description: "Most recent recertification date" },
    ],
  },
  {
    name: "CLIENT_EPISODE_VISITS_ALL",
    schema: "dbo",
    recordCount: 2_148_932,
    columnCount: 32,
    primaryKeys: ["visit_id"],
    foreignKeys: ["epi_id", "worker_id", "discipline_id"],
    businessDescription: "Visit-level detail for all episodes — linked to episodes via epi_id.",
    columns: [
      { name: "visit_id",       type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key — unique visit" },
      { name: "epi_id",         type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "worker_id",      type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → WORKER_BASE.worker_id" },
      { name: "visit_date",     type: "date",    isPk: false, isFk: false, nullable: false, description: "Date of service visit" },
      { name: "visit_points",   type: "decimal", isPk: false, isFk: false, nullable: true,  description: "Worker productivity points for visit" },
      { name: "discipline_id",  type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → DISCIPLINES.discipline_id" },
    ],
  },
  {
    name: "CLIENT_EPISODE_VISIT_NOTES",
    schema: "dbo",
    recordCount: 2_101_445,
    columnCount: 18,
    primaryKeys: ["note_id"],
    foreignKeys: ["visit_id", "epi_id"],
    businessDescription: "Clinical notes and OASIS documentation attached to visits.",
    columns: [
      { name: "note_id",      type: "int",      isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "visit_id",     type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODE_VISITS_ALL.visit_id" },
      { name: "epi_id",       type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "note_type",    type: "varchar",  isPk: false, isFk: false, nullable: false, description: "Note type (OASIS, Narrative, Assessment)" },
      { name: "note_date",    type: "datetime", isPk: false, isFk: false, nullable: false, description: "Note creation timestamp" },
      { name: "note_text",    type: "nvarchar", isPk: false, isFk: false, nullable: true,  description: "Clinical note content" },
    ],
  },
  {
    name: "CLIENT_EPISODE_RECERT_HISTORY",
    schema: "dbo",
    recordCount: 412_890,
    columnCount: 14,
    primaryKeys: ["recert_id"],
    foreignKeys: ["epi_id"],
    businessDescription: "Recertification history per episode — tracks cert periods and renewal dates.",
    columns: [
      { name: "recert_id",   type: "int",  isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "epi_id",      type: "int",  isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "cert_period", type: "int",  isPk: false, isFk: false, nullable: false, description: "Certification period number (1, 2, 3...)" },
      { name: "cert_start",  type: "date", isPk: false, isFk: false, nullable: false, description: "Cert period start date" },
      { name: "cert_end",    type: "date", isPk: false, isFk: false, nullable: false, description: "Cert period end date" },
    ],
  },
  {
    name: "CLIENT_EPISODE_ADMISSION_TYPES",
    schema: "dbo",
    recordCount: 38_120,
    columnCount: 8,
    primaryKeys: ["admission_type_id"],
    foreignKeys: ["epi_id"],
    businessDescription: "Lookup table mapping episodes to admission type classifications.",
    columns: [
      { name: "admission_type_id", type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "epi_id",            type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "admission_type",    type: "varchar", isPk: false, isFk: false, nullable: false, description: "Admission type label (New, Recert, Resumption)" },
    ],
  },
  {
    name: "BRANCHES",
    schema: "dbo",
    recordCount: 16,
    columnCount: 12,
    primaryKeys: ["branch_code"],
    foreignKeys: [],
    businessDescription: "Branch dimension — maps branch codes to names, regions, counties, and states.",
    columns: [
      { name: "branch_code",   type: "varchar", isPk: true,  isFk: false, nullable: false, description: "Primary key — matches epi_branchcode" },
      { name: "branch_name",   type: "varchar", isPk: false, isFk: false, nullable: false, description: "Human-readable branch name" },
      { name: "branch_county", type: "varchar", isPk: false, isFk: false, nullable: true,  description: "County where branch operates" },
      { name: "branch_state",  type: "varchar", isPk: false, isFk: false, nullable: false, description: "State abbreviation" },
      { name: "region",        type: "varchar", isPk: false, isFk: false, nullable: true,  description: "Region grouping (OC, IE, SGV, Desert)" },
      { name: "service_line",  type: "varchar", isPk: false, isFk: false, nullable: true,  description: "Primary service line for this branch" },
    ],
  },
  {
    name: "WORKER_BASE",
    schema: "dbo",
    recordCount: 892,
    columnCount: 24,
    primaryKeys: ["worker_id"],
    foreignKeys: ["branch_code"],
    businessDescription: "Clinician and staff worker registry — linked to visit and productivity data.",
    columns: [
      { name: "worker_id",      type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key — unique worker identifier" },
      { name: "branch_code",    type: "varchar", isPk: false, isFk: true,  nullable: false, description: "FK → BRANCHES.branch_code" },
      { name: "worker_name",    type: "varchar", isPk: false, isFk: false, nullable: false, description: "Full name" },
      { name: "worker_type",    type: "varchar", isPk: false, isFk: false, nullable: false, description: "Employee type (FT, PT, PRN)" },
      { name: "discipline",     type: "varchar", isPk: false, isFk: false, nullable: true,  description: "Clinical discipline (SN, PT, OT, ST)" },
      { name: "hire_date",      type: "date",    isPk: false, isFk: false, nullable: true,  description: "Hire date" },
    ],
  },
  {
    name: "Billing.LINE_ITEMS",
    schema: "Billing",
    recordCount: 1_892_441,
    columnCount: 38,
    primaryKeys: ["li_id"],
    foreignKeys: ["epi_id", "invoice_id"],
    businessDescription: "Billing line items — claim charges, payments, and adjustments per episode.",
    columns: [
      { name: "li_id",           type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "epi_id",          type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "invoice_id",      type: "int",     isPk: false, isFk: true,  nullable: true,  description: "FK → Billing.INVOICES.invoice_id" },
      { name: "li_amount",       type: "decimal", isPk: false, isFk: false, nullable: false, description: "Billed charge amount" },
      { name: "li_paid",         type: "decimal", isPk: false, isFk: false, nullable: true,  description: "Amount paid by payor" },
      { name: "li_claim_status", type: "varchar", isPk: false, isFk: false, nullable: false, description: "Claim status (Submitted, Paid, Denied, Adjusted)" },
      { name: "li_period_start", type: "date",    isPk: false, isFk: false, nullable: false, description: "Period start for billing" },
      { name: "li_period_end",   type: "date",    isPk: false, isFk: false, nullable: false, description: "Period end for billing" },
    ],
  },
  {
    name: "Billing.INVOICES",
    schema: "Billing",
    recordCount: 412_100,
    columnCount: 16,
    primaryKeys: ["invoice_id"],
    foreignKeys: ["epi_id"],
    businessDescription: "Invoice-level billing records — parent to LINE_ITEMS claims.",
    columns: [
      { name: "invoice_id",    type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "epi_id",        type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "invoice_date",  type: "date",    isPk: false, isFk: false, nullable: false, description: "Invoice creation date" },
      { name: "invoice_total", type: "decimal", isPk: false, isFk: false, nullable: false, description: "Total billed amount" },
      { name: "invoice_status",type: "varchar", isPk: false, isFk: false, nullable: false, description: "Invoice status" },
    ],
  },
  {
    name: "PDGM_PERIOD",
    schema: "dbo",
    recordCount: 512_890,
    columnCount: 22,
    primaryKeys: ["period_id"],
    foreignKeys: ["epi_id"],
    businessDescription: "PDGM 30-day period records — tracks HIPPS codes, LUPA status, and reimbursement type.",
    columns: [
      { name: "period_id",      type: "int",     isPk: true,  isFk: false, nullable: false, description: "Primary key" },
      { name: "epi_id",         type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "period_number",  type: "int",     isPk: false, isFk: false, nullable: false, description: "PDGM period number within episode" },
      { name: "hipps_code",     type: "varchar", isPk: false, isFk: false, nullable: true,  description: "HIPPS classification code" },
      { name: "is_lupa",        type: "bit",     isPk: false, isFk: false, nullable: false, description: "1 = LUPA period" },
      { name: "reimbursement_type", type: "varchar", isPk: false, isFk: false, nullable: true, description: "Early/Late, Community/Institutional" },
    ],
  },
];

// ── Pre-seeded inferred relationships ────────────────────────────────────────

const INFERRED_RELATIONSHIPS: Relationship[] = [
  {
    id: "REL-001",
    sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_branchcode",
    targetTable: "BRANCHES",            targetColumn: "branch_code",
    relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted",
    reasons: ["Matching data types (varchar)", "95% value overlap", "Used in 42 existing SQL joins", "Referenced by 49 KPI definitions"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-002",
    sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_slid",
    targetTable: "SERVICE_LINES",       targetColumn: "service_line_id",
    relationshipType: "ManyToOne", confidence: 0.96, status: "Accepted",
    reasons: ["Exact _id suffix pattern", "100% value overlap", "Used in 38 existing SQL joins"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-003",
    sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL",       targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted",
    reasons: ["Exact column name match", "FK metadata declaration", "100% referential integrity"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-004",
    sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "worker_id",
    targetTable: "WORKER_BASE",               targetColumn: "worker_id",
    relationshipType: "ManyToOne", confidence: 0.97, status: "Accepted",
    reasons: ["Exact column name match", "Matching int type", "Used in 12 productivity queries"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-005",
    sourceTable: "Billing.LINE_ITEMS", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted",
    reasons: ["Exact column name match", "FK metadata declaration", "Revenue KPI dependency"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-006",
    sourceTable: "PDGM_PERIOD", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted",
    reasons: ["Exact column name match", "PDGM period is child of episode", "Referenced by LUPA KPI"],
    createdBy: "system", createdDate: "2026-07-20",
  },
  {
    id: "REL-007",
    sourceTable: "WORKER_BASE", sourceColumn: "branch_code",
    targetTable: "BRANCHES",    targetColumn: "branch_code",
    relationshipType: "ManyToOne", confidence: 0.95, status: "Suggested",
    reasons: ["Exact column name match", "Matching varchar type", "Inferred from naming convention"],
    createdBy: "inference", createdDate: "2026-07-20",
  },
  {
    id: "REL-008",
    sourceTable: "CLIENT_EPISODE_VISIT_NOTES", sourceColumn: "visit_id",
    targetTable: "CLIENT_EPISODE_VISITS_ALL",  targetColumn: "visit_id",
    relationshipType: "ManyToOne", confidence: 0.97, status: "Suggested",
    reasons: ["Exact column name match", "Child-to-parent relationship pattern"],
    createdBy: "inference", createdDate: "2026-07-20",
  },
];

const SEED_DATASETS: SemanticDataset[] = [
  {
    datasetId: "DS-001",
    datasetName: "Acacia Enterprise Reporting",
    description: "Core enterprise dataset — episodes, branches, service lines, and billing.",
    tables: ["CLIENT_EPISODES_ALL", "BRANCHES", "SERVICE_LINES", "WORKER_BASE", "Billing.LINE_ITEMS"],
    relationships: ["REL-001", "REL-002", "REL-004", "REL-005"],
    dimensions: ["Branch", "Service Line", "Care Type", "Region", "Payor"],
    measures: ["Census", "Admissions", "Discharges", "Revenue", "Patient Days"],
    owner: "Analytics Team",
    version: "2.4.1",
    status: "Published",
    createdDate: "2026-01-15",
  },
  {
    datasetId: "DS-002",
    datasetName: "PDGM & LUPA Analytics",
    description: "PDGM period-level dataset for LUPA rate analysis and reimbursement modeling.",
    tables: ["CLIENT_EPISODES_ALL", "PDGM_PERIOD", "BRANCHES"],
    relationships: ["REL-001", "REL-006"],
    dimensions: ["Branch", "Period Number", "HIPPS Code", "Reimbursement Type"],
    measures: ["LUPA Rate", "Avg Visits per Period", "Revenue per Period"],
    owner: "Revenue Cycle",
    version: "1.2.0",
    status: "Published",
    createdDate: "2026-03-10",
  },
  {
    datasetId: "DS-003",
    datasetName: "Worker Productivity Dataset",
    description: "Visit and point productivity dataset for clinician performance reporting.",
    tables: ["WORKER_BASE", "CLIENT_EPISODE_VISITS_ALL", "BRANCHES"],
    relationships: ["REL-004", "REL-007"],
    dimensions: ["Worker", "Branch", "Discipline", "Visit Type"],
    measures: ["Total Points", "Achievement %", "Visits per Day"],
    owner: "Operations",
    version: "1.0.3",
    status: "Draft",
    createdDate: "2026-05-20",
  },
];

// ── Relationship type badge ───────────────────────────────────────────────────

function RelTypeBadge({ type }: { type: RelType }) {
  const styles: Record<RelType, string> = {
    ManyToOne:  "bg-primary/15 text-primary border-primary/30",
    OneToMany:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
    OneToOne:   "bg-chart-3/15 text-chart-3 border-chart-3/30",
    ManyToMany: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  };
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border", styles[type])}>
      {type}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? "bg-chart-3" : pct >= 70 ? "bg-chart-5" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Discovery Panel ───────────────────────────────────────────────────────────

function DiscoveryPanel({ onAddToCanvas }: { onAddToCanvas: (t: TableDef) => void }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addedTables, setAddedTables] = useState<Set<string>>(new Set(["CLIENT_EPISODES_ALL", "BRANCHES"]));

  const filtered = SOURCE_TABLES.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.businessDescription.toLowerCase().includes(search.toLowerCase())
  );

  function handleAdd(t: TableDef) {
    setAddedTables((prev) => new Set([...prev, t.name]));
    onAddToCanvas(t);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tables..."
          className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Tables", value: SOURCE_TABLES.length },
          { label: "Columns", value: SOURCE_TABLES.reduce((n, t) => n + t.columnCount, 0) },
          { label: "Records", value: "6.5M+" },
        ].map((s) => (
          <div key={s.label} className="bg-muted/20 border border-border rounded-lg px-3 py-2 text-center">
            <p className="text-sm font-semibold text-primary">{s.value.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table list */}
      <div className="flex flex-col gap-1.5">
        {filtered.map((t) => {
          const isExpanded = expanded === t.name;
          const isAdded = addedTables.has(t.name);
          return (
            <div key={t.name} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : t.name)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Table2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.schema} · {t.columnCount} cols · {t.recordCount.toLocaleString()} rows</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {isAdded ? (
                    <span className="text-[9px] font-medium text-chart-3 bg-chart-3/10 border border-chart-3/20 rounded px-1.5 py-0.5">On Canvas</span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAdd(t); }}
                      className="text-[9px] font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded px-1.5 py-0.5 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      Add
                    </button>
                  )}
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border bg-muted/10">
                  <p className="text-[11px] text-muted-foreground py-2">{t.businessDescription}</p>
                  <div className="flex flex-col gap-0.5">
                    {t.columns.map((c) => (
                      <div key={c.name} className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
                        <div className="flex items-center gap-1 w-4 shrink-0">
                          {c.isPk && <span className="text-[8px] font-bold text-chart-5 bg-chart-5/10 rounded px-0.5">PK</span>}
                          {c.isFk && <span className="text-[8px] font-bold text-primary bg-primary/10 rounded px-0.5">FK</span>}
                        </div>
                        <span className="text-[11px] font-mono text-foreground flex-1 truncate">{c.name}</span>
                        <span className="text-[9px] text-muted-foreground font-mono bg-muted/40 rounded px-1">{c.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Relationship Canvas ───────────────────────────────────────────────────────

interface DragState {
  table: string;
  column: string;
  x: number;
  y: number;
  currentX: number;
  currentY: number;
}

function RelationshipCanvas({
  canvasTables,
  relationships,
  onAccept,
  onRemoveTable,
}: {
  canvasTables: TableDef[];
  relationships: Relationship[];
  onAccept: (rel: Relationship) => void;
  onRemoveTable: (name: string) => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ table: string; column: string } | null>(null);
  const [inference, setInference] = useState<Relationship | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  function inferRelationship(src: { table: string; column: string }, tgt: { table: string; column: string }): Relationship | null {
    if (src.table === tgt.table) return null;
    // Find existing or synthesize
    const existing = INFERRED_RELATIONSHIPS.find(
      (r) =>
        ((r.sourceTable === src.table && r.sourceColumn === src.column &&
          r.targetTable === tgt.table && r.targetColumn === tgt.column) ||
         (r.sourceTable === tgt.table && r.sourceColumn === tgt.column &&
          r.targetTable === src.table && r.targetColumn === src.column))
    );
    if (existing) return { ...existing, status: "Suggested" };

    // Auto-infer from column names
    const confidence = src.column.toLowerCase() === tgt.column.toLowerCase() ? 0.88 : 0.62;
    const reasons: string[] = [];
    if (src.column.toLowerCase() === tgt.column.toLowerCase()) reasons.push("Exact column name match");
    if (src.column.toLowerCase().includes("id") || tgt.column.toLowerCase().includes("id")) reasons.push("_id suffix pattern detected");
    reasons.push(`Inferred from ${src.table} → ${tgt.table} column mapping`);

    return {
      id: `REL-${String(Date.now()).slice(-4)}`,
      sourceTable: src.table, sourceColumn: src.column,
      targetTable: tgt.table, targetColumn: tgt.column,
      relationshipType: "ManyToOne",
      confidence,
      status: "Suggested",
      reasons,
      createdBy: "inference",
      createdDate: new Date().toISOString().slice(0, 10),
    };
  }

  function handleColumnMouseDown(table: string, column: string, e: React.MouseEvent) {
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDragState({ table, column, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, currentX: e.clientX, currentY: e.clientY });
    setDropTarget(null);
    setInference(null);
  }

  function handleColumnMouseEnter(table: string, column: string) {
    if (!dragState || (dragState.table === table && dragState.column === column)) return;
    setDropTarget({ table, column });
  }

  function handleColumnMouseUp(table: string, column: string) {
    if (!dragState || dragState.table === table) { setDragState(null); return; }
    const rel = inferRelationship({ table: dragState.table, column: dragState.column }, { table, column });
    if (rel) setInference(rel);
    setDragState(null);
    setDropTarget(null);
  }

  const canvasRelationships = relationships.filter(
    (r) => canvasTables.some((t) => t.name === r.sourceTable) && canvasTables.some((t) => t.name === r.targetTable)
  );

  return (
    <div className="flex flex-col gap-3 relative">
      {/* Drag instructions */}
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
        Drag any column onto another column to create a relationship. The Smart Inference Engine will analyze the connection automatically.
      </div>

      {/* Active relationship summary */}
      {canvasRelationships.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Accepted", count: canvasRelationships.filter(r => r.status === "Accepted").length, color: "text-chart-3" },
            { label: "Suggested", count: canvasRelationships.filter(r => r.status === "Suggested").length, color: "text-chart-5" },
            { label: "Total", count: canvasRelationships.length, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-muted/20 border border-border rounded-lg px-3 py-2 text-center">
              <p className={cn("text-base font-semibold", s.color)}>{s.count}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative rounded-xl border border-border bg-muted/10 overflow-auto"
        style={{ minHeight: 480 }}
        onMouseMove={(e) => dragState && setDragState((d) => d ? { ...d, currentX: e.clientX, currentY: e.clientY } : null)}
        onMouseUp={() => { setDragState(null); setDropTarget(null); }}
        onMouseLeave={() => { setDragState(null); setDropTarget(null); }}
      >
        {canvasTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Database className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Add tables from Discovery to build relationships</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 p-4 min-w-max">
            {canvasTables.map((table) => (
              <div
                key={table.name}
                className="bg-card border border-border rounded-lg overflow-hidden shadow-sm w-52 shrink-0"
              >
                {/* Table header */}
                <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-b border-primary/20">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Table2 className="w-3 h-3 text-primary shrink-0" />
                    <span className="text-[11px] font-semibold text-foreground truncate">{table.name}</span>
                  </div>
                  <button
                    onClick={() => onRemoveTable(table.name)}
                    className="p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0"
                  >
                    <X className="w-2.5 h-2.5 text-muted-foreground" />
                  </button>
                </div>
                {/* Columns */}
                <div className="flex flex-col">
                  {table.columns.map((col) => {
                    const isDropTarget = dropTarget?.table === table.name && dropTarget?.column === col.name;
                    const isDragging = dragState?.table === table.name && dragState?.column === col.name;
                    return (
                      <div
                        key={col.name}
                        onMouseDown={(e) => handleColumnMouseDown(table.name, col.name, e)}
                        onMouseEnter={() => handleColumnMouseEnter(table.name, col.name)}
                        onMouseUp={() => handleColumnMouseUp(table.name, col.name)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 last:border-0 cursor-grab select-none transition-colors",
                          isDragging && "bg-primary/20 cursor-grabbing",
                          isDropTarget && "bg-chart-3/20 border-l-2 border-l-chart-3",
                          !isDragging && !isDropTarget && "hover:bg-muted/30"
                        )}
                      >
                        <div className="flex items-center gap-0.5 w-5 shrink-0">
                          {col.isPk && <span className="text-[7px] font-bold text-chart-5">PK</span>}
                          {col.isFk && <span className="text-[7px] font-bold text-primary">FK</span>}
                        </div>
                        <span className="text-[10px] font-mono text-foreground flex-1 truncate">{col.name}</span>
                        <span className="text-[8px] text-muted-foreground font-mono shrink-0">{col.type}</span>
                        {col.isFk && <Link2 className="w-2.5 h-2.5 text-primary/60 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Drag ghost line */}
        {dragState && (
          <div
            className="fixed pointer-events-none z-50 text-[10px] text-primary bg-card border border-primary rounded px-2 py-1 shadow-lg"
            style={{ left: dragState.currentX + 8, top: dragState.currentY + 8 }}
          >
            {dragState.table}.{dragState.column} → drop on target column
          </div>
        )}
      </div>

      {/* Relationship lines summary */}
      {canvasRelationships.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Active Relationships on Canvas</p>
          {canvasRelationships.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border rounded-lg text-[11px]">
              <span className="font-mono text-foreground">{r.sourceTable}.{r.sourceColumn}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="font-mono text-foreground">{r.targetTable}.{r.targetColumn}</span>
              <RelTypeBadge type={r.relationshipType} />
              {r.status === "Accepted" ? (
                <CheckCircle2 className="w-3 h-3 text-chart-3 ml-auto shrink-0" />
              ) : (
                <span className="ml-auto text-[9px] text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1">Suggested</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inference popup */}
      {inference && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setInference(null)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Smart Inference Engine</p>
              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-chart-5/15 text-chart-5 border border-chart-5/30 font-semibold">Suggested Relationship</span>
            </div>

            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-foreground bg-muted/50 rounded px-2 py-1">{inference.sourceTable}.{inference.sourceColumn}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground bg-muted/50 rounded px-2 py-1">{inference.targetTable}.{inference.targetColumn}</span>
              </div>

              <div className="flex items-center gap-3">
                <RelTypeBadge type={inference.relationshipType} />
                <div className="flex-1">
                  <ConfidenceBar score={inference.confidence} />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                {inference.reasons.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="w-2.5 h-2.5 text-chart-3 shrink-0" />
                    {r}
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-border mb-4" />

            <div className="flex gap-2">
              <button
                onClick={() => { onAccept({ ...inference, status: "Accepted" }); setInference(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Accept
              </button>
              <button
                onClick={() => setInference(null)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              >
                Modify
              </button>
              <button
                onClick={() => setInference(null)}
                className="px-4 py-2 rounded-lg border border-destructive/40 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Relationships Panel ───────────────────────────────────────────────────────

function RelationshipsPanel({
  relationships,
  onAccept,
  onReject,
}: {
  relationships: Relationship[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "Accepted" | "Suggested" | "Rejected">("all");

  const filtered = relationships.filter((r) => filter === "all" || r.status === filter);
  const counts = {
    all: relationships.length,
    Accepted: relationships.filter(r => r.status === "Accepted").length,
    Suggested: relationships.filter(r => r.status === "Suggested").length,
    Rejected: relationships.filter(r => r.status === "Rejected").length,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {(["all", "Accepted", "Suggested", "Rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors",
              filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
          >
            {f === "all" ? "All" : f} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Relationship rows */}
      <div className="flex flex-col gap-2">
        {filtered.map((r) => (
          <div key={r.id} className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">{r.id}</span>
                  <RelTypeBadge type={r.relationshipType} />
                  {r.status === "Accepted" && <span className="text-[9px] text-chart-3 bg-chart-3/10 border border-chart-3/20 rounded px-1.5 py-0.5 font-semibold">Accepted</span>}
                  {r.status === "Suggested" && <span className="text-[9px] text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1.5 py-0.5 font-semibold">Suggested</span>}
                  {r.status === "Rejected" && <span className="text-[9px] text-destructive bg-destructive/10 border border-destructive/20 rounded px-1.5 py-0.5 font-semibold">Rejected</span>}
                </div>
                {r.status === "Suggested" && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onAccept(r.id)} className="text-[10px] px-2 py-1 rounded bg-chart-3/15 text-chart-3 hover:bg-chart-3/25 transition-colors font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />Accept
                    </button>
                    <button onClick={() => onReject(r.id)} className="text-[10px] px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-medium flex items-center gap-1">
                      <XCircle className="w-2.5 h-2.5" />Reject
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2 text-[11px]">
                <span className="font-mono text-foreground">{r.sourceTable}</span>
                <span className="text-muted-foreground">.</span>
                <span className="font-mono text-primary">{r.sourceColumn}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="font-mono text-foreground">{r.targetTable}</span>
                <span className="text-muted-foreground">.</span>
                <span className="font-mono text-primary">{r.targetColumn}</span>
              </div>

              <div className="mt-2.5">
                <ConfidenceBar score={r.confidence} />
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {r.reasons.map((reason, i) => (
                  <span key={i} className="text-[9px] text-muted-foreground bg-muted/30 rounded px-1.5 py-0.5 border border-border/50">
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Datasets Panel ────────────────────────────────────────────────────────────

function DatasetsPanel({ relationships }: { relationships: Relationship[] }) {
  const [datasets, setDatasets] = useState<SemanticDataset[]>(SEED_DATASETS);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate() {
    if (!newName.trim()) return;
    const ds: SemanticDataset = {
      datasetId: `DS-${String(Date.now()).slice(-3)}`,
      datasetName: newName.trim(),
      description: "New semantic dataset",
      tables: [],
      relationships: [],
      dimensions: [],
      measures: [],
      owner: "Analyst",
      version: "0.1.0",
      status: "Draft",
      createdDate: new Date().toISOString().slice(0, 10),
    };
    setDatasets((prev) => [...prev, ds]);
    setNewName("");
    setCreating(false);
  }

  const statusColors: Record<SemanticDataset["status"], string> = {
    Published:  "bg-chart-3/15 text-chart-3 border-chart-3/30",
    Draft:      "bg-chart-5/15 text-chart-5 border-chart-5/30",
    Deprecated: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Create */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{datasets.length} semantic datasets registered</p>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          New Dataset
        </button>
      </div>

      {creating && (
        <div className="flex gap-2 items-center">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleCreate(); if (e.key === "Escape") setCreating(false); }}
            placeholder="Dataset name..."
            className="flex-1 px-3 py-2 text-sm bg-muted/30 border border-primary/30 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
          />
          <button onClick={handleCreate} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">Create</button>
          <button onClick={() => setCreating(false)} className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        </div>
      )}

      {/* Dataset cards */}
      <div className="flex flex-col gap-2">
        {datasets.map((ds) => {
          const dsRelationships = relationships.filter((r) => ds.relationships.includes(r.id));
          return (
            <div key={ds.datasetId} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-mono text-muted-foreground">{ds.datasetId}</span>
                  <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border", statusColors[ds.status])}>
                    {ds.status}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1 py-0.5">v{ds.version}</span>
                </div>
                <button className="p-1 rounded hover:bg-muted/30 transition-colors">
                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>

              <p className="text-sm font-semibold text-foreground">{ds.datasetName}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{ds.description}</p>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-muted/20 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground mb-1">Tables ({ds.tables.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {ds.tables.map((t) => (
                      <span key={t} className="text-[9px] font-mono text-foreground bg-muted/40 rounded px-1 py-0.5">{t.replace("CLIENT_EPISODE", "CE").replace("_ALL", "")}</span>
                    ))}
                    {ds.tables.length === 0 && <span className="text-[9px] text-muted-foreground italic">None added</span>}
                  </div>
                </div>
                <div className="bg-muted/20 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground mb-1">Relationships ({ds.relationships.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {ds.relationships.map((rid) => (
                      <span key={rid} className="text-[9px] font-mono text-primary bg-primary/10 rounded px-1 py-0.5">{rid}</span>
                    ))}
                    {ds.relationships.length === 0 && <span className="text-[9px] text-muted-foreground italic">None defined</span>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {ds.measures.map((m) => (
                  <span key={m} className="text-[9px] text-chart-2 bg-chart-2/10 border border-chart-2/20 rounded px-1.5 py-0.5">{m}</span>
                ))}
                {ds.dimensions.map((d) => (
                  <span key={d} className="text-[9px] text-muted-foreground bg-muted/30 border border-border/50 rounded px-1.5 py-0.5">{d}</span>
                ))}
              </div>

              <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50">
                <span className="text-[10px] text-muted-foreground">Owner: <span className="text-foreground">{ds.owner}</span></span>
                <span className="text-[10px] text-muted-foreground">Created: {ds.createdDate}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main DatasetDesigner ──────────────────────────────────────────────────────

export function DatasetDesigner() {
  const [tab, setTab] = useState<DesignerTab>("discovery");
  const [canvasTables, setCanvasTables] = useState<TableDef[]>([
    SOURCE_TABLES.find((t) => t.name === "CLIENT_EPISODES_ALL")!,
    SOURCE_TABLES.find((t) => t.name === "BRANCHES")!,
  ]);
  const [relationships, setRelationships] = useState<Relationship[]>(INFERRED_RELATIONSHIPS);
  const [running, setRunning] = useState(false);

  function addToCanvas(t: TableDef) {
    setCanvasTables((prev) => prev.some((p) => p.name === t.name) ? prev : [...prev, t]);
    setTab("canvas");
  }

  function removeFromCanvas(name: string) {
    setCanvasTables((prev) => prev.filter((t) => t.name !== name));
  }

  function acceptRelationship(rel: Relationship) {
    setRelationships((prev) => {
      const exists = prev.find((r) => r.id === rel.id);
      if (exists) return prev.map((r) => r.id === rel.id ? { ...r, status: "Accepted" } : r);
      return [...prev, { ...rel, status: "Accepted" }];
    });
  }

  function rejectRelationship(id: string) {
    setRelationships((prev) => prev.map((r) => r.id === id ? { ...r, status: "Rejected" } : r));
  }

  async function runInference() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 1200));
    setRelationships((prev) => prev.map((r) => r.status === "Suggested" ? r : r));
    setRunning(false);
  }

  const TABS: { id: DesignerTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "discovery",     label: "Table Discovery",     icon: Search,    badge: SOURCE_TABLES.length },
    { id: "canvas",        label: "Relationship Canvas", icon: GitMerge,  badge: canvasTables.length },
    { id: "relationships", label: "Relationship Manager",icon: GitBranch, badge: relationships.filter(r => r.status !== "Rejected").length },
    { id: "datasets",      label: "Semantic Datasets",   icon: Layers,    badge: SEED_DATASETS.length },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Dataset Designer</h2>
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-chart-3/15 text-chart-3 border-chart-3/30">v1.0</span>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              Discover tables, build semantic datasets, define PK/FK relationships via drag-and-drop, and publish reusable analytical models.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runInference}
              disabled={running}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium border border-primary/20 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {running ? "Inferring..." : "Run Inference"}
            </button>
            <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Schema
            </button>
          </div>
        </div>

        {/* Scope summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-border">
          {[
            { label: "Tables",        value: 125,  sub: "discovered" },
            { label: "Relationships", value: 412,  sub: "mapped" },
            { label: "Datasets",      value: 38,   sub: "semantic" },
            { label: "KPIs",          value: 49,   sub: "registered" },
            { label: "Reports",       value: 72,   sub: "catalog" },
            { label: "Columns",       value: "3.4K", sub: "indexed" },
          ].map((s) => (
            <div key={s.label} className="bg-muted/15 rounded-lg px-3 py-2">
              <p className="text-base font-semibold text-primary">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</p>
              <p className="text-[10px] text-foreground font-medium">{s.label}</p>
              <p className="text-[9px] text-muted-foreground">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {badge !== undefined && (
              <span className={cn(
                "text-[9px] font-semibold rounded-full px-1.5 py-0.5 min-w-[16px] text-center",
                tab === id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "discovery" && <DiscoveryPanel onAddToCanvas={addToCanvas} />}
        {tab === "canvas" && (
          <RelationshipCanvas
            canvasTables={canvasTables}
            relationships={relationships}
            onAccept={acceptRelationship}
            onRemoveTable={removeFromCanvas}
          />
        )}
        {tab === "relationships" && (
          <RelationshipsPanel
            relationships={relationships}
            onAccept={(id) => setRelationships((prev) => prev.map((r) => r.id === id ? { ...r, status: "Accepted" } : r))}
            onReject={rejectRelationship}
          />
        )}
        {tab === "datasets" && (
          <DatasetsPanel relationships={relationships} />
        )}
      </div>
    </div>
  );
}
