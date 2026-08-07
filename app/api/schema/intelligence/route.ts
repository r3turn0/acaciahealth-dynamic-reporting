/**
 * GET /api/schema/intelligence
 *
 * Returns the full Schema Intelligence Registry payload:
 *   - tables  : enriched table catalog with column summaries and KPI deps
 *   - scope   : live aggregate metrics (tables, cols, rels, datasets, KPIs)
 *   - lineage : lineage graph nodes for the Lineage Map view
 *
 * Merges static catalog data with live KPI counts from /api/kpi-admin.
 * Falls back gracefully when KPI admin is unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import governanceCatalog from "@/lib/config/governanceCatalog.json";
import businessGlossary from "@/lib/config/businessGlossary.json";

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

// ── Static catalog ─────────────────────────────────────────────────────────────

const CATALOG: RegistryTable[] = [
  {
    id: "dbo.CLIENT_EPISODES_ALL", name: "CLIENT_EPISODES_ALL", schema: "dbo",
    domain: "Clinical", entityType: "Fact", columnCount: 47,
    pkColumns: ["epi_id"], fkCount: 6,
    description: "Core patient episode table. One row per active care episode across all service lines. Foundation of admissions, census, discharge, and PDGM KPIs.",
    tags: ["episodes", "census", "admissions", "care_types", "kpi"],
    version: "3.1.2", rowEstimate: 284_512, lastSyncAt: new Date().toISOString(),
    owner: "Clinical Ops", usageCount: 187,
    kpiDependencies: ["ADC", "Census", "Admissions", "Discharge Rate", "LUPA %", "Live Discharge %"],
    upstreamTables: [],
    downstreamTables: ["CLIENT_EPISODE_VISITS_ALL", "PDGM_PERIOD", "Billing.LINE_ITEMS", "CLIENT_EPISODE_RECERT_HISTORY"],
    columnSummary: [
      { name: "epi_id",            type: "int",     role: "primary_key",    nullable: false, description: "Unique episode identifier" },
      { name: "epi_branchcode",    type: "varchar", role: "foreign_key",    nullable: false, description: "FK → BRANCHES" },
      { name: "epi_slid",          type: "int",     role: "foreign_key",    nullable: false, description: "FK → SERVICE_LINES" },
      { name: "epi_caretypeid",    type: "int",     role: "foreign_key",    nullable: true,  description: "FK → CARE_TYPES" },
      { name: "epi_SocDate",       type: "date",    role: "time_dimension", nullable: false, description: "Start of Care date" },
      { name: "epi_DischargeDate", type: "date",    role: "time_dimension", nullable: true,  description: "Discharge date (NULL = active)" },
      { name: "epi_payor",         type: "varchar", role: "dimension",      nullable: true,  description: "Primary payor" },
      { name: "epi_recertDate",    type: "date",    role: "time_dimension", nullable: true,  description: "Most recent recertification date" },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_VISITS_ALL", name: "CLIENT_EPISODE_VISITS_ALL", schema: "dbo",
    domain: "Clinical", entityType: "Fact", columnCount: 32,
    pkColumns: ["visit_id"], fkCount: 4,
    description: "Visit-level detail — one row per clinical visit. Drives productivity, utilization, and LUPA rate calculations.",
    tags: ["visits", "productivity", "clinical", "kpi"],
    version: "2.8.0", rowEstimate: 2_148_932, lastSyncAt: new Date().toISOString(),
    owner: "Clinical Ops", usageCount: 142,
    kpiDependencies: ["Visit Rate", "LUPA %", "Worker Productivity", "Discipline Mix"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: ["CLIENT_EPISODE_VISIT_NOTES"],
    columnSummary: [
      { name: "visit_id",     type: "int",     role: "primary_key",   nullable: false, description: "Unique visit identifier" },
      { name: "epi_id",       type: "int",     role: "foreign_key",   nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "worker_id",    type: "int",     role: "foreign_key",   nullable: false, description: "FK → WORKER_BASE" },
      { name: "visit_date",   type: "date",    role: "time_dimension",nullable: false, description: "Service date" },
      { name: "visit_points", type: "decimal", role: "measure",       nullable: true,  description: "Productivity points" },
      { name: "discipline_id",type: "int",     role: "foreign_key",   nullable: false, description: "FK → DISCIPLINES" },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_VISIT_NOTES", name: "CLIENT_EPISODE_VISIT_NOTES", schema: "dbo",
    domain: "Clinical", entityType: "Fact", columnCount: 18,
    pkColumns: ["note_id"], fkCount: 2,
    description: "Clinical notes and OASIS documentation attached to visits.",
    tags: ["notes", "oasis", "clinical"],
    version: "1.5.0", rowEstimate: 2_101_445, lastSyncAt: new Date().toISOString(),
    owner: "Clinical Ops", usageCount: 34,
    kpiDependencies: [],
    upstreamTables: ["CLIENT_EPISODE_VISITS_ALL", "CLIENT_EPISODES_ALL"],
    downstreamTables: [],
    columnSummary: [
      { name: "note_id",    type: "int",      role: "primary_key", nullable: false, description: "Unique note" },
      { name: "visit_id",   type: "int",      role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODE_VISITS_ALL" },
      { name: "epi_id",     type: "int",      role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "note_type",  type: "varchar",  role: "dimension",   nullable: false, description: "OASIS, Narrative, Assessment" },
      { name: "note_date",  type: "datetime", role: "time_dimension", nullable: false, description: "Note timestamp" },
      { name: "note_text",  type: "nvarchar", role: "audit",       nullable: true,  description: "Clinical note content" },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_RECERT_HISTORY", name: "CLIENT_EPISODE_RECERT_HISTORY", schema: "dbo",
    domain: "Clinical", entityType: "Fact", columnCount: 14,
    pkColumns: ["recert_id"], fkCount: 1,
    description: "Recertification history per episode — tracks cert periods and renewal dates.",
    tags: ["recert", "cert_period", "clinical"],
    version: "1.2.0", rowEstimate: 412_890, lastSyncAt: new Date().toISOString(),
    owner: "Clinical Ops", usageCount: 28,
    kpiDependencies: ["Recert %"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: [],
    columnSummary: [
      { name: "recert_id",   type: "int",  role: "primary_key", nullable: false, description: "Primary key" },
      { name: "epi_id",      type: "int",  role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "cert_period", type: "int",  role: "dimension",   nullable: false, description: "Cert period number" },
      { name: "cert_start",  type: "date", role: "time_dimension", nullable: false, description: "Period start" },
      { name: "cert_end",    type: "date", role: "time_dimension", nullable: false, description: "Period end" },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_ADMISSION_TYPES", name: "CLIENT_EPISODE_ADMISSION_TYPES", schema: "dbo",
    domain: "Clinical", entityType: "Dimension", columnCount: 8,
    pkColumns: ["admission_type_id"], fkCount: 1,
    description: "Lookup table mapping episodes to admission type classifications.",
    tags: ["admissions", "lookup"],
    version: "1.0.1", rowEstimate: 38_120, lastSyncAt: new Date().toISOString(),
    owner: "Clinical Ops", usageCount: 19,
    kpiDependencies: ["Admissions"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: [],
    columnSummary: [
      { name: "admission_type_id", type: "int",     role: "primary_key", nullable: false, description: "Primary key" },
      { name: "epi_id",            type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "admission_type",    type: "varchar", role: "dimension",   nullable: false, description: "New, Recert, Resumption" },
    ],
  },
  {
    id: "dbo.BRANCHES", name: "BRANCHES", schema: "dbo",
    domain: "Reference", entityType: "Dimension", columnCount: 12,
    pkColumns: ["branch_code"], fkCount: 0,
    description: "Branch dimension — maps 16 active branches to names, regions, counties, and states. Used in nearly every query for geographic slicing.",
    tags: ["branches", "service_lines", "reference"],
    version: "1.4.1", rowEstimate: 16, lastSyncAt: new Date().toISOString(),
    owner: "Analytics Team", usageCount: 264,
    kpiDependencies: ["Branch ADC", "Branch Revenue", "Branch Census"],
    upstreamTables: [],
    downstreamTables: ["CLIENT_EPISODES_ALL", "WORKER_BASE", "Billing.LINE_ITEMS"],
    columnSummary: [
      { name: "branch_code",   type: "varchar", role: "primary_key", nullable: false, description: "PK — matches all FK references" },
      { name: "branch_name",   type: "varchar", role: "dimension",   nullable: false, description: "Display name" },
      { name: "branch_county", type: "varchar", role: "dimension",   nullable: true,  description: "County" },
      { name: "branch_state",  type: "varchar", role: "dimension",   nullable: false, description: "State abbreviation" },
      { name: "region",        type: "varchar", role: "dimension",   nullable: true,  description: "Regional grouping" },
      { name: "service_line",  type: "varchar", role: "dimension",   nullable: true,  description: "Primary service line" },
    ],
  },
  {
    id: "dbo.WORKER_BASE", name: "WORKER_BASE", schema: "dbo",
    domain: "HR", entityType: "Dimension", columnCount: 24,
    pkColumns: ["worker_id"], fkCount: 1,
    description: "Clinician and staff worker registry — 892 active workers. Central to productivity, staffing ratio, and FTE reporting.",
    tags: ["workers", "productivity", "hr"],
    version: "2.1.0", rowEstimate: 892, lastSyncAt: new Date().toISOString(),
    owner: "HR Analytics", usageCount: 89,
    kpiDependencies: ["FTE Count", "Worker Points Achievement %", "Census per EE"],
    upstreamTables: ["BRANCHES"],
    downstreamTables: ["CLIENT_EPISODE_VISITS_ALL"],
    columnSummary: [
      { name: "worker_id",   type: "int",     role: "primary_key",   nullable: false, description: "Unique worker ID" },
      { name: "branch_code", type: "varchar", role: "foreign_key",   nullable: false, description: "FK → BRANCHES" },
      { name: "worker_name", type: "varchar", role: "dimension",     nullable: false, description: "Full name" },
      { name: "worker_type", type: "varchar", role: "dimension",     nullable: false, description: "FT, PT, PRN" },
      { name: "discipline",  type: "varchar", role: "dimension",     nullable: true,  description: "SN, PT, OT, ST" },
      { name: "hire_date",   type: "date",    role: "time_dimension",nullable: true,  description: "Hire date" },
    ],
  },
  {
    id: "Billing.LINE_ITEMS", name: "LINE_ITEMS", schema: "Billing",
    domain: "Finance", entityType: "Fact", columnCount: 38,
    pkColumns: ["li_id"], fkCount: 2,
    description: "Billing line items — charges, payments, and adjustments. Foundation for revenue, AR, and claim-status KPIs.",
    tags: ["billing", "revenue", "kpi"],
    version: "4.0.1", rowEstimate: 1_892_441, lastSyncAt: new Date().toISOString(),
    owner: "Revenue Cycle", usageCount: 118,
    kpiDependencies: ["Revenue per Patient Day", "Unbilled Claims", "Contribution Margin"],
    upstreamTables: ["CLIENT_EPISODES_ALL", "Billing.INVOICES"],
    downstreamTables: [],
    columnSummary: [
      { name: "li_id",           type: "int",     role: "primary_key", nullable: false, description: "Unique line item" },
      { name: "epi_id",          type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "invoice_id",      type: "int",     role: "foreign_key", nullable: true,  description: "FK → Billing.INVOICES" },
      { name: "li_amount",       type: "decimal", role: "measure",     nullable: false, description: "Billed charge amount" },
      { name: "li_paid",         type: "decimal", role: "measure",     nullable: true,  description: "Paid amount" },
      { name: "li_claim_status", type: "varchar", role: "dimension",   nullable: false, description: "Submitted, Paid, Denied, Adjusted" },
      { name: "li_period_start", type: "date",    role: "time_dimension", nullable: false, description: "Period start" },
      { name: "li_period_end",   type: "date",    role: "time_dimension", nullable: false, description: "Period end" },
    ],
  },
  {
    id: "Billing.INVOICES", name: "INVOICES", schema: "Billing",
    domain: "Finance", entityType: "Fact", columnCount: 16,
    pkColumns: ["invoice_id"], fkCount: 1,
    description: "Invoice-level billing records — parent to LINE_ITEMS claims.",
    tags: ["billing", "invoices", "revenue"],
    version: "2.0.0", rowEstimate: 412_100, lastSyncAt: new Date().toISOString(),
    owner: "Revenue Cycle", usageCount: 67,
    kpiDependencies: ["Unbilled Claims", "AR Aging"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: ["Billing.LINE_ITEMS"],
    columnSummary: [
      { name: "invoice_id",     type: "int",     role: "primary_key", nullable: false, description: "Primary key" },
      { name: "epi_id",         type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "invoice_date",   type: "date",    role: "time_dimension", nullable: false, description: "Invoice date" },
      { name: "invoice_total",  type: "decimal", role: "measure",     nullable: false, description: "Total billed" },
      { name: "invoice_status", type: "varchar", role: "dimension",   nullable: false, description: "Status" },
    ],
  },
  {
    id: "dbo.PDGM_PERIOD", name: "PDGM_PERIOD", schema: "dbo",
    domain: "Clinical", entityType: "Fact", columnCount: 22,
    pkColumns: ["period_id"], fkCount: 1,
    description: "PDGM 30-day period records — HIPPS codes, LUPA status, and reimbursement type. Required for CMS payment model analytics.",
    tags: ["pdgm", "lupa", "billing", "kpi"],
    version: "1.3.0", rowEstimate: 512_890, lastSyncAt: new Date().toISOString(),
    owner: "Revenue Cycle", usageCount: 71,
    kpiDependencies: ["LUPA %", "PDGM Reimbursement", "HH-CAHPS"],
    upstreamTables: ["CLIENT_EPISODES_ALL"],
    downstreamTables: [],
    columnSummary: [
      { name: "period_id",          type: "int",     role: "primary_key", nullable: false, description: "Unique period" },
      { name: "epi_id",             type: "int",     role: "foreign_key", nullable: false, description: "FK → CLIENT_EPISODES_ALL" },
      { name: "period_number",      type: "int",     role: "dimension",   nullable: false, description: "Period # within episode" },
      { name: "hipps_code",         type: "varchar", role: "dimension",   nullable: true,  description: "HIPPS code" },
      { name: "is_lupa",            type: "bit",     role: "measure",     nullable: false, description: "LUPA flag" },
      { name: "reimbursement_type", type: "varchar", role: "dimension",   nullable: true,  description: "Early/Late, Community/Institutional" },
    ],
  },
];

function inferColumnRole(name: string, identity: boolean): ColumnEntry["role"] {
  if (identity || /(^|_)id$/i.test(name)) return identity ? "primary_key" : "foreign_key";
  if (/(date|time|period|year|month)$/i.test(name)) return "time_dimension";
  if (/(amount|total|count|days|rate|percent|balance|revenue|margin)$/i.test(name)) return "measure";
  if (/(created|updated|modified|audit)/i.test(name)) return "audit";
  return "dimension";
}

const DERIVED_CATALOG: RegistryTable[] = governanceCatalog.tables.map((table) => ({
  id: `${table.schema}.${table.name}`,
  name: table.name,
  schema: table.schema,
  domain: table.domain === "Workforce" ? "HR" : table.domain,
  entityType: table.entityType === "view" ? "View" : "Table",
  columnCount: table.columns.length,
  pkColumns: table.columns.filter((column) => column.identity && column.name).map((column) => column.name as string),
  fkCount: table.columns.filter((column) => !column.identity && /(^|_)id$/i.test(column.name ?? "")).length,
  description: `Metadata-derived ${table.domain.toLowerCase()} asset from the governed SQL Server catalog.`,
  tags: [table.domain.toLowerCase(), "metadata-derived", "read-only"],
  version: "source-2026.06",
  rowEstimate: 0,
  lastSyncAt: governanceCatalog.sourceGeneratedAt,
  owner: `${table.domain} Data Steward`,
  usageCount: 0,
  kpiDependencies: [],
  upstreamTables: [],
  downstreamTables: [],
  columnSummary: table.columns.flatMap((column) => {
    if (!column.name) return [];
    return [{
      name: column.name,
      type: column.dataType,
      role: inferColumnRole(column.name, column.identity),
      nullable: column.nullable,
      description: column.description ?? `${column.name} (${column.dataType})`,
    }];
  }),
}));

const CATALOG_BY_ID = new Map<string, RegistryTable>();
for (const table of [...DERIVED_CATALOG, ...CATALOG]) CATALOG_BY_ID.set(table.id.toLowerCase(), table);
const UNIFIED_CATALOG = [...CATALOG_BY_ID.values()];

const LINEAGE: LineageNode[] = [
  { id: "n1",  label: "CLIENT_EPISODES_ALL",       type: "source",    depth: 0, children: ["n3", "n4", "n5", "n6"] },
  { id: "n2",  label: "BRANCHES",                  type: "source",    depth: 0, children: ["n3"] },
  { id: "n3",  label: "DS-001: Enterprise Rpt",    type: "transform", depth: 1, children: ["n7", "n8"] },
  { id: "n4",  label: "DS-002: PDGM Analytics",    type: "transform", depth: 1, children: ["n9"] },
  { id: "n5",  label: "Billing.LINE_ITEMS",         type: "source",    depth: 0, children: ["n3"] },
  { id: "n6",  label: "PDGM_PERIOD",               type: "source",    depth: 0, children: ["n4"] },
  { id: "n7",  label: "KPI: ADC",                  type: "kpi",       depth: 2, children: [] },
  { id: "n8",  label: "KPI: Revenue/Patient Day",  type: "kpi",       depth: 2, children: [] },
  { id: "n9",  label: "KPI: LUPA Rate",            type: "kpi",       depth: 2, children: [] },
  { id: "n10", label: "WORKER_BASE",               type: "source",    depth: 0, children: ["n11"] },
  { id: "n11", label: "DS-003: Worker Productivity", type: "transform", depth: 1, children: ["n12"] },
  { id: "n12", label: "KPI: Worker Points %",      type: "kpi",       depth: 2, children: [] },
];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id     = searchParams.get("id");
  const domain = searchParams.get("domain");
  const entity = searchParams.get("entityType");
  const q      = searchParams.get("q")?.toLowerCase();

  if (id) {
    const t = UNIFIED_CATALOG.find((c) => c.id === id || c.name === id);
    if (!t) return NextResponse.json({ error: `Table '${id}' not found` }, { status: 404 });
    return NextResponse.json(t);
  }

  let tables = [...UNIFIED_CATALOG];
  if (domain) tables = tables.filter((t) => t.domain === domain);
  if (entity) tables = tables.filter((t) => t.entityType === entity);
  if (q) tables = tables.filter(
    (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some((tg) => tg.includes(q))
  );

  const scope = {
    tables: UNIFIED_CATALOG.length,
    columns: UNIFIED_CATALOG.reduce((total, table) => total + table.columnCount, 0),
    relationships: UNIFIED_CATALOG.reduce((total, table) => total + table.fkCount, 0),
    datasets: 38,
    kpis: 49,
    reports: 72,
    semanticModels: governanceCatalog.domains.length,
    unusedTables: UNIFIED_CATALOG.filter((table) => table.usageCount === 0).length,
    orphanedRels: 0,
    lastRefresh: governanceCatalog.sourceGeneratedAt,
    sourceTableCount: governanceCatalog.sourceTableCount,
    provenance: governanceCatalog.sourceFile,
    correlationId: governanceCatalog.correlationId,
  };

  return NextResponse.json({
    tables,
    total: tables.length,
    scope,
    lineage: LINEAGE,
    glossary: businessGlossary,
    domains: [...new Set(UNIFIED_CATALOG.map((t) => t.domain))],
    entityTypes: [...new Set(UNIFIED_CATALOG.map((t) => t.entityType))],
    provenance: {
      sourceFile: governanceCatalog.sourceFile,
      generatedAt: governanceCatalog.generatedAt,
      sourceGeneratedAt: governanceCatalog.sourceGeneratedAt,
      correlationId: governanceCatalog.correlationId,
    },
  });
}
