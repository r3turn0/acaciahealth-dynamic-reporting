"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  Layers,
  Link2,
  ListChecks,
  Settings2,
  ShieldCheck,
  Table2,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import schemaConfig from "@/lib/config/schemaConfig.json";
import kpiConfig from "@/lib/config/kpiConfig.json";
import bucketMap from "@/lib/config/bucketMap.json";

type SchemaEntry = {
  alias: string;
  keys: string[];
  joins: Record<string, string>;
};

// ── Static governance catalog derived from workbook ───────────────────────────

const WORKBOOK_SHEETS = [
  {
    name: "Company Scorecard",
    purpose: "Executive KPI Dashboard",
    governance: "Executive Scorecard — aggregate rollup across all service lines",
    kpis: [
      "Revenue per Period (Monthly)",
      "Current ADC",
      "Hospice Census Equivalent (HCE)",
      "Weekly Admissions",
      "Recert %",
      "Total Discharges",
      "Live Discharge %",
      "Total Patient Days",
      "Revenue per Patient Day",
      "Medicare Discharge Total LOS",
      "LUPA %",
      "Worker Points Achievement %",
      "Unbilled Claims",
      "FTE / Total Employee Count",
      "Census per EE",
      "Contribution Margin",
    ],
    badge: "Executive",
    badgeColor: "bg-primary/15 text-primary border-primary/30",
  },
  {
    name: "Financial",
    purpose: "Revenue Cycle, AR, DSO, Margin, Adjustments",
    governance: "Financial Scorecard — sourced from Month End Close & AR Aging Reports",
    kpis: [
      "Total HCHB Aging (Over 120 Days)",
      "Accounts Receivable Aging",
      "Average Revenue per Day (Trailing 3 Months)",
      "DSO by Service Line",
      "AP Aging",
      "Total AP Aging",
      "Contribution Margin per FTE",
      "Billing System Adjustment %",
      "Billing Manual Adjustment %",
      "Month End Close Adjustment Detail (CMS HIPPS)",
    ],
    badge: "Financial",
    badgeColor: "bg-destructive/15 text-destructive border-destructive/30",
  },
  {
    name: "HR",
    purpose: "Recruiting, Compliance, Workforce KPIs",
    governance: "HR Scorecard — sourced from Paychex, recruiting system, incident reports",
    kpis: [
      "Open Jobs",
      "Time to Hire",
      "Cost per Hire",
      "Retention Rate (Benchmark: 90%)",
      "HR Files Complete (Benchmark: 100%)",
      "Employee Satisfaction (Benchmark: 90%)",
      "Falls",
      "Complaints Resolved (Benchmark: 100%)",
      "Live Discharge % (Benchmark: 90%)",
      "Revocations & Transfers",
      "Terminations",
      "ADRs (Benchmark: 90%)",
      "Active Lawsuits",
      "Incident Reports",
      "Worker Injuries",
    ],
    badge: "HR",
    badgeColor: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  },
  {
    name: "Avg Salary by Position",
    purpose: "Compensation Analytics",
    governance: "HR Scorecard — compensation band analysis sourced from Paychex Payroll FTE Extract",
    kpis: ["Average Salary by Position", "FTE Count by Position", "Compensation Band Range"],
    badge: "HR",
    badgeColor: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  },
  {
    name: "Hospice Administrator Scorecard",
    purpose: "Hospice Operations KPI Scorecard",
    governance: "Hospice Scorecard — inherits KPI definitions from central catalog; no duplicate calculations",
    kpis: [
      "Current Census (Target: +15% QoQ)",
      "Weekly Admissions (Target: +5% MoM)",
      "NTUC Rate (Target: <20%)",
      "Average Length of Stay (Target: ≤100 days)",
      "BP1 Compliance (Target: 80%)",
      "DME PPD by Region",
      "Pharmacy PPD by Region",
      "Supplies PPD (All Branches: $5.50)",
      "All Live Discharges (Target: ≤7%/month)",
      "Patient-Initiated Live DCs (Target: ≤3%/month)",
      "Hospice-Initiated Live DCs (Target: ≤4%/month)",
      "QA Compliance: NOE/F2F/Cert/Recert (Target: 100%)",
      "Billing Holds — Cleared by Day 3",
      "Workers Under 30 Points %",
      "Overtime (Target: <3% of Payroll)",
      "Gross Margin %",
      "Avg Days Referral to Admission (Target: <2 days)",
      "Recert %",
    ],
    badge: "Hospice",
    badgeColor: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  },
  {
    name: "HH Admin Scorecard",
    purpose: "Home Health & Palliative Operations Scorecard",
    governance: "HH & Palliative Scorecard (Draft) — inherits KPI definitions from central catalog",
    kpis: [
      "Current Census",
      "Weekly Admissions",
      "NTUC Rate",
      "LUPA % (PDGM)",
      "BP1 Compliance",
      "Revenue",
      "Revenue per Patient Day",
      "Worker Points Achievement",
      "Billing Holds",
      "Recert %",
      "Avg Days Referral to Admission",
    ],
    badge: "HH & Pal",
    badgeColor: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  },
  {
    name: "Central Support HH&P",
    purpose: "Intake, Billing, Operations Support",
    governance: "Central Support Scorecard — Intake and billing operations sourced from HCHB",
    kpis: [
      "Intake Volume",
      "Referral Conversion Rate",
      "Billing Holds by Type",
      "NOA/NOE Timely Submission",
      "OASIS Timely Submission",
      "Unbilled Claims by Location",
    ],
    badge: "Central",
    badgeColor: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  },
  {
    name: "Data",
    purpose: "KPI Dictionary / Metadata / Source Map",
    governance: "Authoritative KPI Metadata Repository (Finding 1) — becomes the single source of truth for all KPI definitions",
    kpis: [
      "Current Census by Location & Service Line",
      "Hospice Census Equivalent (HCE)",
      "Weekly Admissions by Location & Service Line",
      "Revenue per Period (Monthly)",
      "Total Patient Days (HH & HOS)",
      "AVG Total LOS by HCHB Location (HOS)",
      "Recert % (HH & HOS)",
      "# of Live Discharges by Location (HOS)",
      "Conversion Ratio by Location AVG MTD",
      "LUPA % (HH)",
      "% Workers Under 30 Points (FT Employees)",
      "$ Unbilled Claims by Location & Service Line",
      "Census per Employee",
      "Outstanding AR Over 90 Days",
    ],
    badge: "Metadata",
    badgeColor: "bg-muted text-muted-foreground border-border",
  },
];

const REPORT_CATALOG: {
  category: string;
  color: string;
  icon: React.ElementType;
  reports: string[];
}[] = [
  {
    category: "Home Health Operational",
    color: "bg-chart-4/15 text-chart-4 border-chart-4/30",
    icon: FileText,
    reports: [
      "Home Health WAAR Report",
      "KPI Alerts - HH Medicare",
      "PDGM LUPA Analysis Report",
      "Field Productivity - Worker Points",
      "AR Aging by Patient Report",
      "Month End Close Revenue Report",
      "OASIS Timely Submission Report",
      "NOA Timely Submission Report",
      "Order Tracking Report",
    ],
  },
  {
    category: "Hospice Operational",
    color: "bg-chart-3/15 text-chart-3 border-chart-3/30",
    icon: FileText,
    reports: [
      "Hospice WAAR Report",
      "Hospice Key Metrics Report",
      "Hospice NOE Status Report",
      "HIS Timely Submission Tracing Report",
      "Hospice Length of Stay Report",
      "Hospice Population Report Card",
      "Hospice Admission Report",
      "Live Discharge Report",
    ],
  },
  {
    category: "Financial",
    color: "bg-destructive/15 text-destructive border-destructive/30",
    icon: BarChart3,
    reports: [
      "Month End Close Revenue Report",
      "Financial Statements",
      "Accounts Receivable Aging Report",
      "AR Aging Report",
      "AP Aging Report",
      "Billing Adjustment Report",
      "Adjustment Detail Report",
      "Contribution Margin Report",
    ],
  },
  {
    category: "HR & Workforce",
    color: "bg-chart-2/15 text-chart-2 border-chart-2/30",
    icon: Building2,
    reports: [
      "Payroll FTE Extract",
      "Paychex Employee Count",
      "Recruiting Open Requisition Report",
      "Retention Report",
      "Employee Satisfaction Survey",
      "Compliance Incident Reports",
    ],
  },
];

const GOVERNANCE_FINDINGS = [
  {
    number: 1,
    title: "Data worksheet becomes authoritative KPI metadata source",
    entity: "kpi_definitions",
    role: "Authoritative KPI Metadata Repository",
    status: "Applied",
    impact: "All KPI definitions must reference kpi_definitions. No scorecard may define its own formula.",
  },
  {
    number: 2,
    title: "Company Scorecard becomes executive aggregate dashboard",
    entity: "Executive Scorecard",
    role: "Enterprise-level KPI rollup across all service lines and branches",
    status: "Applied",
    impact: "Create a dedicated Executive Scorecard dashboard module fed by the central KPI catalog.",
  },
  {
    number: 3,
    title: "Hospice and HH Administrator scorecards inherit from central catalog",
    entity: "Shared KPI Engine",
    role: "Eliminates duplicate KPI calculations across scorecard tabs",
    status: "Applied",
    impact: "60–70% duplicate reduction target. All scorecards reference a shared calculation engine.",
  },
  {
    number: 4,
    title: "Coloring and alert rules become configurable metadata",
    entity: "Alert Rule Engine",
    role: "No KPI-specific colors hardcoded in UI",
    status: "Applied",
    impact: "Alert rules stored in metadata: benchmark comparison, weekly variance, 20% recert threshold.",
  },
  {
    number: 5,
    title: "Normalize duplicate KPI definitions",
    entity: "kpi_definitions",
    role: "Deduplication target: 60–70% reduction",
    status: "Applied",
    impact: "Single definition source. Scorecards reference by kpiId, never redeclare formulas.",
  },
];

const KPI_DOMAINS = [
  { name: "Growth", icon: "↗", color: "bg-chart-1/15 text-chart-1 border-chart-1/30" },
  { name: "Census", icon: "⊕", color: "bg-primary/15 text-primary border-primary/30" },
  { name: "Admissions", icon: "✚", color: "bg-chart-4/15 text-chart-4 border-chart-4/30" },
  { name: "Clinical Quality", icon: "✓", color: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
  { name: "Revenue", icon: "$", color: "bg-destructive/15 text-destructive border-destructive/30" },
  { name: "Revenue Cycle", icon: "↻", color: "bg-chart-5/15 text-chart-5 border-chart-5/30" },
  { name: "Productivity", icon: "⚡", color: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
  { name: "Compliance", icon: "⚖", color: "bg-chart-1/10 text-chart-1 border-chart-1/20" },
  { name: "Workforce", icon: "◉", color: "bg-muted text-muted-foreground border-border" },
  { name: "Financial Performance", icon: "◈", color: "bg-chart-5/10 text-chart-5 border-chart-5/20" },
];

const BENCHMARKS = [
  { kpi: "Current ADC — HH", benchmark: 170, unit: "patients", scope: "Service Line" },
  { kpi: "Current ADC — Palliative", benchmark: 155, unit: "patients", scope: "Service Line" },
  { kpi: "Current ADC — Hospice", benchmark: 265, unit: "patients", scope: "Service Line" },
  { kpi: "Retention Rate", benchmark: "90%", unit: "Percent", scope: "Enterprise" },
  { kpi: "NOE Timely Submission", benchmark: "100%", unit: "Percent", scope: "Enterprise" },
  { kpi: "NTUC Rate", benchmark: "<20%", unit: "Percent", scope: "Enterprise" },
  { kpi: "Average LOS", benchmark: "≤100 days", unit: "Days", scope: "Enterprise" },
  { kpi: "BP1 Compliance", benchmark: "80%", unit: "Percent", scope: "Enterprise" },
  { kpi: "All Live Discharges", benchmark: "≤7%/month", unit: "Percent", scope: "Enterprise" },
  { kpi: "Patient-Initiated Live DCs", benchmark: "≤3%/month", unit: "Percent", scope: "Branch" },
  { kpi: "Hospice-Initiated Live DCs", benchmark: "≤4%/month", unit: "Percent", scope: "Branch" },
  { kpi: "Worker Points Achievement", benchmark: "8.0 pts", unit: "Points", scope: "Enterprise" },
  { kpi: "Billing Holds SLA", benchmark: "Day 3 of new month", unit: "Days", scope: "Enterprise" },
  { kpi: "Avg Days Referral to Admission", benchmark: "<2 days", unit: "Days", scope: "Enterprise" },
  { kpi: "HR Files Complete", benchmark: "100%", unit: "Percent", scope: "Enterprise" },
];

type SchemaTab = "workbook" | "catalog" | "governance" | "benchmarks" | "domains" | "database" | "schema";

const SCHEMA_TABS: { id: SchemaTab; label: string; icon: React.ElementType }[] = [
  { id: "workbook",    label: "Workbook Structure",  icon: Table2      },
  { id: "catalog",     label: "Report Catalog",       icon: FileText    },
  { id: "governance",  label: "Governance Findings",  icon: ShieldCheck },
  { id: "benchmarks",  label: "Benchmark Engine",     icon: Target      },
  { id: "domains",     label: "KPI Domains",          icon: Layers      },
  { id: "database",    label: "Database Model",       icon: Database    },
  { id: "schema",      label: "Schema Registry",      icon: GitBranch   },
];

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({
  title,
  badge,
  badgeColor,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {badge && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>
      </button>
      {open && <div className="p-4 bg-card">{children}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SchemaViewer() {
  const [activeTab, setActiveTab] = useState<SchemaTab>("workbook");
  const schema = schemaConfig as Record<string, SchemaEntry>;

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Schema Intelligence</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enterprise KPI Performance Management Platform &mdash; Schema v{kpiConfig._meta.schemaVersion}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-primary/70 bg-primary/8 border border-primary/20 rounded px-2 py-0.5">
              {kpiConfig._meta.enterpriseKpiCount} KPIs
            </span>
            <span className="text-[10px] font-mono text-chart-1/80 bg-chart-1/8 border border-chart-1/20 rounded px-2 py-0.5">
              {kpiConfig._meta.branchCount} Branches
            </span>
            <span className="text-[10px] font-mono text-chart-3/80 bg-chart-3/8 border border-chart-3/20 rounded px-2 py-0.5">
              READ-ONLY SOURCE
            </span>
          </div>
        </div>

        {/* Schema version metadata row */}
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Primary Dimension", value: kpiConfig._meta.primaryDimensionKey },
            { label: "Service Line Key",  value: kpiConfig._meta.serviceLineKey },
            { label: "Reporting Grain",   value: kpiConfig._meta.reportingGrain },
            { label: "Dimension Model",   value: kpiConfig._meta.dimensionCatalog },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className="text-[11px] font-mono text-foreground mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 bg-muted/30 border border-border rounded-lg p-1">
        {SCHEMA_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === id
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Workbook Structure ───────────────────────────────────────────── */}
      {activeTab === "workbook" && (
        <div className="flex flex-col gap-3">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Table2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Worksheets Detected</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              KPI Scorecard workbook — 8 worksheets mapped to governance roles. The Data sheet is the authoritative KPI metadata source (Governance Finding 1).
            </p>
            <div className="grid grid-cols-1 gap-3">
              {WORKBOOK_SHEETS.map((sheet) => (
                <div key={sheet.name} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-start justify-between gap-3 px-4 py-3 bg-muted/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sheet.badgeColor}`}>
                        {sheet.badge}
                      </span>
                      <span className="text-xs font-semibold text-foreground truncate">{sheet.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">{sheet.kpis.length} KPIs</span>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[11px] text-muted-foreground mb-2">{sheet.purpose}</p>
                    <p className="text-[10px] text-muted-foreground/70 italic mb-3">{sheet.governance}</p>
                    <div className="flex flex-wrap gap-1">
                      {sheet.kpis.map((kpi) => (
                        <span key={kpi} className="text-[10px] bg-muted/60 border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                          {kpi}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Report Catalog ───────────────────────────────────────────────── */}
      {activeTab === "catalog" && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Report Catalog</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Centralized registry of all operational source reports. Each report is a registered data source for one or more KPIs in the catalog.
            </p>
          </div>
          {REPORT_CATALOG.map((group) => (
            <div key={group.category} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <group.icon className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-foreground">{group.category}</h4>
                <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${group.color}`}>
                  {group.reports.length} reports
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.reports.map((report, i) => (
                  <div key={report} className="flex items-center gap-2 text-[11px] py-1.5 px-3 bg-muted/30 border border-border rounded-md">
                    <span className="text-[10px] font-mono text-muted-foreground/60 w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-foreground">{report}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* KPI Metadata Standard */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-3.5 h-3.5 text-primary" />
              <h4 className="text-xs font-semibold text-foreground">KPI Metadata Standard</h4>
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/25">
                Schema v{kpiConfig._meta.schemaVersion}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">All KPIs must conform to the following normalized metadata schema.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { field: "kpiId",           type: "string",                          note: "Unique identifier" },
                { field: "kpiName",         type: "string",                          note: "Display name" },
                { field: "category",        type: "Operations|Financial|Clinical…",  note: "Domain bucket" },
                { field: "serviceLine",     type: "HH|Palliative|Hospice|Corporate", note: "Service line scope" },
                { field: "location",        type: "OC|IE|SGV|Desert|All",            note: "Geographic scope" },
                { field: "benchmark",       type: "number|string",                   note: "Target value" },
                { field: "frequency",       type: "Weekly|Monthly|Quarterly",        note: "Reporting cadence" },
                { field: "sourceReport",    type: "string",                          note: "Registered source" },
                { field: "formula",         type: "string",                          note: "SQL-level formula" },
                { field: "unit",            type: "Count|Percent|Dollars|Days|Hrs",  note: "Measurement unit" },
                { field: "alertThreshold",  type: "{ green, yellow, red }",          note: "RAG thresholds" },
                { field: "definition",      type: "string",                          note: "Business definition" },
              ].map(({ field, type, note }) => (
                <div key={field} className="bg-muted/30 border border-border rounded p-2.5">
                  <code className="text-[11px] font-mono text-primary">{field}</code>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{type}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Governance Findings ──────────────────────────────────────────── */}
      {activeTab === "governance" && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Workbook Governance Findings</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Five architecture decisions derived from workbook analysis. All findings have been applied to the platform model.
            </p>
          </div>
          {GOVERNANCE_FINDINGS.map((f) => (
            <div key={f.number} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 border border-primary/25 shrink-0">
                  <span className="text-[11px] font-bold text-primary">{f.number}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-semibold text-foreground">{f.title}</p>
                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-chart-1/10 text-chart-1 border-chart-1/25">
                      <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />
                      {f.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-muted-foreground">Entity:</span>
                    <code className="text-[10px] font-mono text-primary">{f.entity}</code>
                    <span className="text-[10px] text-muted-foreground/60">&mdash; {f.role}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.impact}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Alert Rule Engine */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-chart-2" />
              <h4 className="text-xs font-semibold text-foreground">Alert Rule Engine</h4>
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-chart-2/15 text-chart-2 border-chart-2/30">
                Finding 4
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Workbook coloring logic converted to configurable metadata. No KPI-specific colors hardcoded in UI.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { rule: "Default Rule", desc: "Current value vs. benchmark" },
                { rule: "Weekly Rule", desc: "Current week vs. prior week" },
                { rule: "Recert Rule", desc: "20% variance threshold" },
                { rule: "General KPIs", desc: "Any increase or decrease triggers RAG status color" },
              ].map(({ rule, desc }) => (
                <div key={rule} className="flex items-start gap-2 bg-muted/30 border border-border rounded p-2.5">
                  <AlertTriangle className="w-3 h-3 text-chart-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-foreground">{rule}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Benchmark Engine ─────────────────────────────────────────────── */}
      {activeTab === "benchmarks" && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Benchmark Engine</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Configurable benchmarking framework supporting Enterprise, Service Line, Region, Branch, and Role-Based tiers.
            </p>
          </div>

          {/* Benchmark tiers */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">Benchmark Scope Tiers</h4>
            <div className="flex flex-wrap gap-2">
              {["Enterprise", "Service Line", "Region", "Branch", "Role-Based"].map((tier) => (
                <span key={tier} className="text-[11px] font-medium px-3 py-1.5 rounded-full border bg-muted/40 border-border text-foreground">
                  {tier}
                </span>
              ))}
            </div>
          </div>

          {/* Benchmark table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20">
              <h4 className="text-xs font-semibold text-foreground">Enterprise Benchmark Catalog</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["KPI", "Benchmark", "Unit", "Scope"].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BENCHMARKS.map((b) => (
                    <tr key={b.kpi} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-foreground">{b.kpi}</td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-primary">{b.benchmark}</td>
                      <td className="px-4 py-2.5 text-[11px] text-muted-foreground">{b.unit}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                          b.scope === "Enterprise"
                            ? "bg-primary/10 text-primary border-primary/25"
                            : b.scope === "Service Line"
                            ? "bg-chart-4/15 text-chart-4 border-chart-4/30"
                            : "bg-chart-3/15 text-chart-3 border-chart-3/30"
                        )}>
                          {b.scope}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Domains ──────────────────────────────────────────────────── */}
      {activeTab === "domains" && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Master KPI Catalog — Domain Alignment</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Required KPI domains per governance specification. All {kpiConfig._meta.enterpriseKpiCount} enterprise KPIs are validated against these 10 domains.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {KPI_DOMAINS.map((d) => {
              const domainKpis = Object.entries(kpiConfig.categories as Record<string, string[]>).find(
                ([cat]) => cat.toLowerCase().includes(d.name.toLowerCase().split(" ")[0].toLowerCase())
              );
              const kpiCount = domainKpis ? domainKpis[1].length : "—";
              const catKey = domainKpis?.[0];
              return (
                <div key={d.name} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${d.color}`}>{d.icon}</span>
                      <span className="text-xs font-semibold text-foreground">{d.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{kpiCount} KPIs</span>
                  </div>
                  {catKey && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {((kpiConfig.categories as Record<string, string[]>)[catKey] ?? []).map((k) => (
                        <span key={k} className="text-[9px] font-mono bg-muted/50 border border-border rounded px-1 py-0.5 text-muted-foreground">
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Database Model ───────────────────────────────────────────────── */}
      {activeTab === "database" && (
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Database Model</h3>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-mono text-destructive/80 bg-destructive/10 border border-destructive/20 rounded px-2 py-0.5">
                READ-ONLY SOURCE SYSTEMS
              </span>
              <span className="text-[10px] font-mono text-chart-1/80 bg-chart-1/10 border border-chart-1/20 rounded px-2 py-0.5">
                METADATA-DRIVEN ETL
              </span>
            </div>
          </div>

          {/* Core tables */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">Enterprise Tables</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { table: "kpi_definitions",   role: "Authoritative KPI Metadata Repository",  finding: "Finding 1" },
                { table: "kpi_measurements",  role: "Actual KPI values by period and branch",  finding: null        },
                { table: "service_lines",     role: "HH, Palliative, Hospice, Corporate",      finding: null        },
                { table: "locations",         role: "Branch and region hierarchy",             finding: null        },
                { table: "report_sources",    role: "Registered source report lineage",        finding: null        },
                { table: "benchmarks",        role: "Configurable benchmark values by tier",   finding: null        },
                { table: "scorecards",        role: "Metadata-driven scorecard definitions",   finding: "Finding 2" },
                { table: "alerts",            role: "Alert rule configurations per KPI",       finding: "Finding 4" },
                { table: "users",             role: "User accounts and roles",                 finding: null        },
                { table: "comments",          role: "KPI and scorecard comment threads",       finding: null        },
                { table: "data_refresh_logs", role: "ETL load tracking and quality logs",      finding: null        },
              ].map(({ table, role, finding }) => (
                <div key={table} className="bg-muted/30 border border-border rounded p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <code className="text-[11px] font-mono text-primary">{table}</code>
                    {finding && (
                      <span className="text-[9px] bg-chart-3/10 text-chart-3 border border-chart-3/25 rounded px-1 py-0.5">{finding}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{role}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ETL Sources */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">ETL Source Systems</h4>
            <div className="flex flex-wrap gap-2">
              {["HCHB", "Paychex", "Financial Statements", "AR Aging Reports", "WAAR Reports", "Hospice Key Metrics", "Field Productivity"].map((src) => (
                <span key={src} className="text-[11px] font-medium px-2.5 py-1 rounded-md border bg-muted/40 border-border text-foreground">
                  {src}
                </span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Weekly Loads",       value: "Yes" },
                { label: "Monthly Loads",      value: "Yes" },
                { label: "Refresh Logging",    value: "Yes" },
                { label: "Data Quality Checks", value: "Yes" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-chart-1/5 border border-chart-1/20 rounded p-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-[11px] font-semibold text-chart-1">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Scorecard framework */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-3.5 h-3.5 text-chart-4" />
              <h4 className="text-xs font-semibold text-foreground">Scorecard Framework</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {[
                "Company Scorecard",
                "Hospice Administrator Scorecard",
                "HH Administrator Scorecard",
                "Financial Scorecard",
                "Compliance Scorecard",
                "HR Scorecard",
              ].map((sc) => (
                <div key={sc} className="flex items-center gap-2 text-[11px] py-1.5 px-3 bg-muted/30 border border-border rounded-md">
                  <BookOpen className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-foreground">{sc}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {["Single KPI Definition Source", "Shared Calculation Engine", "Dashboard-Specific Presentation"].map((attr) => (
                <span key={attr} className="text-[10px] bg-chart-1/8 border border-chart-1/20 rounded px-2 py-0.5 text-chart-1">
                  <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />
                  {attr}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Schema Registry ──────────────────────────────────────────────── */}
      {activeTab === "schema" && (
        <div className="flex flex-col gap-4">

          {/* Tables */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">AcaciaHealth Schema (Read-Only)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(schema).map(([table, def]) => (
                <div key={table} className="border border-border rounded-md p-3 bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono font-semibold text-primary">{table}</span>
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      alias: {def.alias}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Keys: {def.keys.join(", ")}
                  </p>
                  {Object.keys(def.joins).length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Joins</p>
                      {Object.entries(def.joins).map(([target, condition]) => (
                        <div key={target} className="flex items-start gap-1.5 mb-1">
                          <Link2 className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                          <div>
                            <span className="text-[11px] text-foreground font-medium">{target}</span>
                            <br />
                            <code className="text-[10px] font-mono text-muted-foreground">{condition}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Bucket map */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Bucket / Branch Map</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">SL ID</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Branch Code</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Bucket Name</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketMap.map((row) => (
                    <tr key={row.sl_id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{row.sl_id}</td>
                      <td className="px-3 py-2 font-mono text-xs text-primary">{row.branch_code}</td>
                      <td className="px-3 py-2 text-xs text-foreground">{row.bucket_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
