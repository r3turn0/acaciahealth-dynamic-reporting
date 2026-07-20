"use client";

import { useState, useMemo } from "react";
import {
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Pin,
  PinOff,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import kpiConfig from "@/lib/config/kpiConfig.json";
import { KpiInterpreter } from "./KpiInterpreter";
import { KpiIntelligence } from "./KpiIntelligence";
import {
  useDashboardPins,
  isPinned as isItemPinned,
  pinItem,
  unpinByRef,
} from "@/lib/hooks/useDashboardPins";

// ── Types ─────────────────────────────────────────────────────────────────────

type KpiKey = keyof typeof kpiConfig.kpis;
type Tab = "definitions" | "scorecard" | "interpreter" | "intelligence";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "definitions",  label: "KPI Definitions",   icon: BarChart3  },
  { id: "scorecard",    label: "Scorecard Catalog",  icon: Layers     },
  { id: "intelligence", label: "KPI Intelligence",   icon: Brain      },
  { id: "interpreter",  label: "KPI Interpreter",    icon: Sparkles   },
];

// ── Workbook Scorecard Catalog ────────────────────────────────────────────────

type ScorecardKpi = {
  name: string;
  benchmark?: string;
  sourceReport?: string;
  domain: string;
  unit?: string;
  frequency?: string;
  serviceLine?: string;
};

type ScorecardDef = {
  sheet: string;
  purpose: string;
  badge: string;
  badgeColor: string;
  sourceSystem: string;
  governance: string;
  kpis: ScorecardKpi[];
};

const SCORECARD_CATALOG: ScorecardDef[] = [
  {
    sheet: "Company Scorecard",
    purpose: "Executive KPI Dashboard",
    badge: "Executive",
    badgeColor: "bg-primary/15 text-primary border-primary/30",
    sourceSystem: "HCHB + Paychex + Financial Statements",
    governance: "Executive Scorecard aggregate — all service lines (Finding 2)",
    kpis: [
      { name: "Revenue per Period (Monthly)",       benchmark: "—",           sourceReport: "Month End Close Revenue Report",    domain: "Revenue",           unit: "Dollars",  frequency: "Monthly",  serviceLine: "All"       },
      { name: "Current ADC",                        benchmark: "HH:170 / PAL:155 / HOS:265", sourceReport: "Home Health WAAR Report", domain: "Census",  unit: "Count",    frequency: "Weekly",   serviceLine: "All"       },
      { name: "Hospice Census Equivalent (HCE)",    benchmark: "—",           sourceReport: "Hospice Key Metrics Report",        domain: "Census",            unit: "Count",    frequency: "Weekly",   serviceLine: "Hospice"   },
      { name: "Weekly Admissions",                  benchmark: "+5% MoM",     sourceReport: "Home Health WAAR Report",          domain: "Admissions",        unit: "Count",    frequency: "Weekly",   serviceLine: "All"       },
      { name: "Recert %",                           benchmark: "—",           sourceReport: "WAAR Reports",                     domain: "Clinical Quality",  unit: "Percent",  frequency: "Weekly",   serviceLine: "All"       },
      { name: "Total Discharges",                   benchmark: "—",           sourceReport: "Live Discharge Report",            domain: "Census",            unit: "Count",    frequency: "Monthly",  serviceLine: "Hospice"   },
      { name: "Live Discharge %",                   benchmark: "≤7%/month",   sourceReport: "Live Discharge Report",            domain: "Census",            unit: "Percent",  frequency: "Monthly",  serviceLine: "Hospice"   },
      { name: "Total Patient Days",                 benchmark: "—",           sourceReport: "Hospice Length of Stay Report",    domain: "Census",            unit: "Count",    frequency: "Monthly",  serviceLine: "All"       },
      { name: "Revenue per Patient Day",            benchmark: "—",           sourceReport: "Month End Close Revenue Report",   domain: "Revenue",           unit: "Dollars",  frequency: "Monthly",  serviceLine: "All"       },
      { name: "Medicare Discharge Total LOS",       benchmark: "≤100 days",   sourceReport: "Hospice Length of Stay Report",    domain: "Clinical Quality",  unit: "Days",     frequency: "Monthly",  serviceLine: "Hospice"   },
      { name: "LUPA %",                             benchmark: "—",           sourceReport: "PDGM LUPA Analysis Report",        domain: "Financial Performance", unit: "Percent", frequency: "Weekly", serviceLine: "HH"      },
      { name: "Worker Points Achievement %",        benchmark: "8.0 pts",     sourceReport: "Field Productivity - Worker Points", domain: "Productivity",   unit: "Percent",  frequency: "Weekly",   serviceLine: "All"       },
      { name: "Unbilled Claims",                    benchmark: "—",           sourceReport: "AR Aging by Patient Report",       domain: "Revenue Cycle",     unit: "Dollars",  frequency: "Weekly",   serviceLine: "All"       },
      { name: "FTE / Total Employee Count",         benchmark: "—",           sourceReport: "Payroll FTE Extract",              domain: "Workforce",         unit: "Count",    frequency: "Monthly",  serviceLine: "All"       },
      { name: "Census per EE",                      benchmark: "—",           sourceReport: "Payroll FTE Extract",              domain: "Productivity",      unit: "Ratio",    frequency: "Monthly",  serviceLine: "All"       },
      { name: "Contribution Margin",                benchmark: "—",           sourceReport: "Contribution Margin Report",       domain: "Financial Performance", unit: "Dollars", frequency: "Monthly", serviceLine: "All"    },
    ],
  },
  {
    sheet: "Financial",
    purpose: "Revenue Cycle, AR, DSO, Margin, Adjustments",
    badge: "Financial",
    badgeColor: "bg-destructive/15 text-destructive border-destructive/30",
    sourceSystem: "HCHB + Financial Statements",
    governance: "Financial Scorecard — sourced from AR Aging and Month End Close Reports",
    kpis: [
      { name: "Total HCHB Aging (Over 120 Days)",         benchmark: "—",    sourceReport: "AR Aging Report",                   domain: "Revenue Cycle",         unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Accounts Receivable Aging",                benchmark: "—",    sourceReport: "Accounts Receivable Aging Report",  domain: "Revenue Cycle",         unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Average Revenue per Day (Trailing 3 Mo)",  benchmark: "—",    sourceReport: "Month End Close Revenue Report",    domain: "Revenue",               unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "DSO by Service Line",                      benchmark: "—",    sourceReport: "AR Aging Report",                   domain: "Revenue Cycle",         unit: "Days",     frequency: "Monthly", serviceLine: "All"  },
      { name: "AP Aging",                                 benchmark: "—",    sourceReport: "AP Aging Report",                   domain: "Financial Performance", unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Total AP Aging",                           benchmark: "—",    sourceReport: "AP Aging Report",                   domain: "Financial Performance", unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Contribution Margin per FTE",              benchmark: "—",    sourceReport: "Contribution Margin Report",        domain: "Financial Performance", unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Billing System Adjustment %",              benchmark: "—",    sourceReport: "Billing Adjustment Report",         domain: "Revenue Cycle",         unit: "Percent",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Billing Manual Adjustment %",              benchmark: "—",    sourceReport: "Adjustment Detail Report",          domain: "Revenue Cycle",         unit: "Percent",  frequency: "Monthly", serviceLine: "All"  },
      { name: "Month End Close Adjustment (CMS HIPPS)",   benchmark: "—",    sourceReport: "Adjustment Detail Report",          domain: "Revenue Cycle",         unit: "Dollars",  frequency: "Monthly", serviceLine: "All"  },
    ],
  },
  {
    sheet: "HR",
    purpose: "Recruiting, Compliance, Workforce KPIs",
    badge: "HR",
    badgeColor: "bg-chart-2/15 text-chart-2 border-chart-2/30",
    sourceSystem: "Paychex + Recruiting System + Incident Reports",
    governance: "HR Scorecard — workforce and compliance metrics",
    kpis: [
      { name: "Open Jobs",              benchmark: "—",      sourceReport: "Recruiting Open Requisition Report", domain: "Workforce",   unit: "Count",   frequency: "Weekly",  serviceLine: "All" },
      { name: "Time to Hire",           benchmark: "—",      sourceReport: "Recruiting Open Requisition Report", domain: "Workforce",   unit: "Days",    frequency: "Monthly", serviceLine: "All" },
      { name: "Cost per Hire",          benchmark: "—",      sourceReport: "Recruiting Open Requisition Report", domain: "Workforce",   unit: "Dollars", frequency: "Monthly", serviceLine: "All" },
      { name: "Retention Rate",         benchmark: "90%",    sourceReport: "Retention Report",                   domain: "Workforce",   unit: "Percent", frequency: "Monthly", serviceLine: "All" },
      { name: "HR Files Complete",      benchmark: "100%",   sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Percent", frequency: "Monthly", serviceLine: "All" },
      { name: "Employee Satisfaction",  benchmark: "90%",    sourceReport: "Employee Satisfaction Survey",       domain: "Workforce",   unit: "Percent", frequency: "Quarterly", serviceLine: "All" },
      { name: "Falls",                  benchmark: "—",      sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Count",   frequency: "Monthly", serviceLine: "All" },
      { name: "Complaints Resolved",    benchmark: "100%",   sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Percent", frequency: "Monthly", serviceLine: "All" },
      { name: "Live DCs (HR View)",     benchmark: "≤90%",   sourceReport: "Live Discharge Report",              domain: "Compliance",  unit: "Percent", frequency: "Monthly", serviceLine: "All" },
      { name: "Terminations",           benchmark: "100%",   sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Count",   frequency: "Monthly", serviceLine: "All" },
      { name: "ADRs",                   benchmark: "≥90%",   sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Count",   frequency: "Monthly", serviceLine: "All" },
      { name: "Incident Reports",       benchmark: "—",      sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Count",   frequency: "Monthly", serviceLine: "All" },
      { name: "Worker Injuries",        benchmark: "—",      sourceReport: "Compliance Incident Reports",        domain: "Compliance",  unit: "Count",   frequency: "Monthly", serviceLine: "All" },
    ],
  },
  {
    sheet: "Avg Salary by Position",
    purpose: "Compensation Analytics",
    badge: "HR",
    badgeColor: "bg-chart-2/15 text-chart-2 border-chart-2/30",
    sourceSystem: "Paychex Payroll FTE Extract",
    governance: "HR Scorecard — compensation band analysis by position",
    kpis: [
      { name: "Average Salary by Position", benchmark: "—", sourceReport: "Payroll FTE Extract",     domain: "Workforce", unit: "Dollars", frequency: "Monthly", serviceLine: "All" },
      { name: "FTE Count by Position",      benchmark: "—", sourceReport: "Paychex Employee Count",  domain: "Workforce", unit: "Count",   frequency: "Monthly", serviceLine: "All" },
      { name: "Compensation Band Range",    benchmark: "—", sourceReport: "Payroll FTE Extract",     domain: "Workforce", unit: "Dollars", frequency: "Quarterly", serviceLine: "All" },
    ],
  },
  {
    sheet: "Hospice Administrator Scorecard",
    purpose: "Hospice Operations KPI Scorecard",
    badge: "Hospice",
    badgeColor: "bg-chart-3/15 text-chart-3 border-chart-3/30",
    sourceSystem: "HCHB + Financial Statements",
    governance: "Inherits KPI definitions from central catalog (Finding 3). No duplicate calculations.",
    kpis: [
      { name: "Current Census",                     benchmark: "+15% QoQ",     sourceReport: "Hospice WAAR Report",       domain: "Census",            unit: "Count",   frequency: "Weekly",  serviceLine: "Hospice" },
      { name: "Weekly Admissions",                   benchmark: "+5% MoM",      sourceReport: "Hospice Admission Report",  domain: "Admissions",        unit: "Count",   frequency: "Weekly",  serviceLine: "Hospice" },
      { name: "NTUC Rate",                           benchmark: "<20%",          sourceReport: "Hospice WAAR Report",       domain: "Admissions",        unit: "Percent", frequency: "Weekly",  serviceLine: "Hospice" },
      { name: "Average Length of Stay",              benchmark: "≤100 days",    sourceReport: "Hospice Length of Stay Report", domain: "Clinical Quality", unit: "Days",  frequency: "Monthly", serviceLine: "Hospice" },
      { name: "BP1 Compliance",                      benchmark: "80%",           sourceReport: "NOA Timely Submission Report", domain: "Clinical Quality", unit: "Percent", frequency: "Weekly", serviceLine: "Hospice" },
      { name: "DME PPD by Region",                   benchmark: "$7–$7.25",     sourceReport: "Month End Close Revenue Report", domain: "Financial Performance", unit: "Dollars", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Pharmacy PPD by Region",              benchmark: "$6–$7.50",     sourceReport: "Month End Close Revenue Report", domain: "Financial Performance", unit: "Dollars", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Supplies PPD",                        benchmark: "$5.50",        sourceReport: "Month End Close Revenue Report", domain: "Financial Performance", unit: "Dollars", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "All Live Discharges",                 benchmark: "≤7%/month",    sourceReport: "Live Discharge Report",     domain: "Census",            unit: "Percent", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Patient-Initiated Live DCs",          benchmark: "≤3%/month",    sourceReport: "Live Discharge Report",     domain: "Census",            unit: "Percent", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Hospice-Initiated Live DCs",          benchmark: "≤4%/month",    sourceReport: "Live Discharge Report",     domain: "Census",            unit: "Percent", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "QA Compliance: NOE/F2F/Cert/Recert",  benchmark: "100%",         sourceReport: "HIS Timely Submission Tracing Report", domain: "Compliance", unit: "Percent", frequency: "Weekly", serviceLine: "Hospice" },
      { name: "Billing Holds — Cleared by Day 3",    benchmark: "Day 3",        sourceReport: "Hospice Key Metrics Report", domain: "Revenue Cycle",    unit: "Count",   frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Workers Under 30 Points %",           benchmark: "—",            sourceReport: "Field Productivity - Worker Points", domain: "Productivity", unit: "Percent", frequency: "Weekly", serviceLine: "Hospice" },
      { name: "Overtime (% of Payroll)",             benchmark: "<3%",          sourceReport: "Payroll FTE Extract",       domain: "Workforce",         unit: "Percent", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Gross Margin %",                      benchmark: "—",            sourceReport: "Financial Statements",      domain: "Financial Performance", unit: "Percent", frequency: "Monthly", serviceLine: "Hospice" },
      { name: "Avg Days Referral to Admission",      benchmark: "<2 days",      sourceReport: "Hospice Admission Report",  domain: "Admissions",        unit: "Days",    frequency: "Weekly",  serviceLine: "Hospice" },
      { name: "Recert %",                            benchmark: "—",            sourceReport: "Hospice Key Metrics Report", domain: "Clinical Quality", unit: "Percent", frequency: "Weekly",  serviceLine: "Hospice" },
    ],
  },
  {
    sheet: "HH Admin Scorecard",
    purpose: "Home Health & Palliative Operations Scorecard",
    badge: "HH & Pal",
    badgeColor: "bg-chart-4/15 text-chart-4 border-chart-4/30",
    sourceSystem: "HCHB",
    governance: "HH & Palliative Scorecard (Draft) — inherits definitions from central catalog (Finding 3)",
    kpis: [
      { name: "Current Census",                benchmark: "—",       sourceReport: "Home Health WAAR Report",          domain: "Census",            unit: "Count",   frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Weekly Admissions",              benchmark: "+5% MoM", sourceReport: "Home Health WAAR Report",          domain: "Admissions",        unit: "Count",   frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "NTUC Rate",                      benchmark: "<20%",    sourceReport: "KPI Alerts - HH Medicare",         domain: "Admissions",        unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "LUPA % (PDGM)",                  benchmark: "—",       sourceReport: "PDGM LUPA Analysis Report",        domain: "Financial Performance", unit: "Percent", frequency: "Weekly", serviceLine: "HH"    },
      { name: "BP1 Compliance",                 benchmark: "80%",     sourceReport: "NOA Timely Submission Report",      domain: "Clinical Quality",  unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Revenue",                        benchmark: "—",       sourceReport: "Month End Close Revenue Report",   domain: "Revenue",           unit: "Dollars", frequency: "Monthly", serviceLine: "HH/Pal" },
      { name: "Revenue per Patient Day",        benchmark: "—",       sourceReport: "Month End Close Revenue Report",   domain: "Revenue",           unit: "Dollars", frequency: "Monthly", serviceLine: "HH/Pal" },
      { name: "Worker Points Achievement",      benchmark: "8.0 pts", sourceReport: "Field Productivity - Worker Points", domain: "Productivity",   unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Billing Holds",                  benchmark: "Day 3",   sourceReport: "Order Tracking Report",            domain: "Revenue Cycle",     unit: "Count",   frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Recert %",                       benchmark: "—",       sourceReport: "Home Health WAAR Report",          domain: "Clinical Quality",  unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Avg Days Referral to Admission", benchmark: "<2 days", sourceReport: "Home Health WAAR Report",          domain: "Admissions",        unit: "Days",    frequency: "Weekly",  serviceLine: "HH/Pal" },
    ],
  },
  {
    sheet: "Central Support HH&P",
    purpose: "Intake, Billing, Operations Support",
    badge: "Central",
    badgeColor: "bg-chart-5/15 text-chart-5 border-chart-5/30",
    sourceSystem: "HCHB",
    governance: "Central Support Scorecard — intake and billing operations",
    kpis: [
      { name: "Intake Volume",                benchmark: "—",     sourceReport: "Home Health WAAR Report",        domain: "Admissions",   unit: "Count",   frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Referral Conversion Rate",      benchmark: ">80%",  sourceReport: "KPI Alerts - HH Medicare",       domain: "Admissions",   unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Billing Holds by Type",         benchmark: "Day 3", sourceReport: "Order Tracking Report",          domain: "Revenue Cycle", unit: "Count",  frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "NOA/NOE Timely Submission",     benchmark: "100%",  sourceReport: "NOA Timely Submission Report",   domain: "Compliance",   unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "OASIS Timely Submission",       benchmark: "100%",  sourceReport: "OASIS Timely Submission Report", domain: "Compliance",   unit: "Percent", frequency: "Weekly",  serviceLine: "HH/Pal" },
      { name: "Unbilled Claims by Location",   benchmark: "—",     sourceReport: "AR Aging by Patient Report",     domain: "Revenue Cycle", unit: "Dollars", frequency: "Weekly", serviceLine: "HH/Pal" },
    ],
  },
  {
    sheet: "Data",
    purpose: "KPI Dictionary / Metadata / Source Map",
    badge: "Metadata",
    badgeColor: "bg-muted text-muted-foreground border-border",
    sourceSystem: "HCHB + All Sources",
    governance: "Authoritative KPI Metadata Repository (Finding 1) — single definition source for all scorecards",
    kpis: [
      { name: "Current Census by Location & Service Line",          benchmark: "+15% QoQ", sourceReport: "WAAR Reports",                        domain: "Census",            unit: "Count",   frequency: "Weekly",  serviceLine: "All"   },
      { name: "Hospice Census Equivalent (HCE)",                    benchmark: "—",        sourceReport: "Hospice Key Metrics Report",           domain: "Census",            unit: "Count",   frequency: "Weekly",  serviceLine: "Hospice" },
      { name: "Weekly Admissions by Location & Service Line",       benchmark: "+5% MoM",  sourceReport: "WAAR Reports",                        domain: "Admissions",        unit: "Count",   frequency: "Weekly",  serviceLine: "All"   },
      { name: "Revenue per Period",                                  benchmark: "—",        sourceReport: "Month End Close Revenue Report",      domain: "Revenue",           unit: "Dollars", frequency: "Monthly", serviceLine: "All"   },
      { name: "Total Patient Days (HH & HOS)",                      benchmark: "—",        sourceReport: "Hospice Length of Stay Report",       domain: "Census",            unit: "Count",   frequency: "Monthly", serviceLine: "All"   },
      { name: "AVG Total LOS by HCHB Location (HOS)",               benchmark: "≤100 days",sourceReport: "Hospice Length of Stay Report",       domain: "Clinical Quality",  unit: "Days",    frequency: "Monthly", serviceLine: "Hospice"},
      { name: "Recert % (HH & HOS)",                                benchmark: "—",        sourceReport: "WAAR Reports",                        domain: "Clinical Quality",  unit: "Percent", frequency: "Weekly",  serviceLine: "All"   },
      { name: "# of Live Discharges by Location (HOS)",             benchmark: "≤7%",      sourceReport: "Live Discharge Report",               domain: "Census",            unit: "Count",   frequency: "Monthly", serviceLine: "Hospice"},
      { name: "Conversion Ratio by Location AVG MTD",               benchmark: ">80%",     sourceReport: "WAAR Reports",                        domain: "Admissions",        unit: "Percent", frequency: "Monthly", serviceLine: "All"   },
      { name: "LUPA % (HH)",                                        benchmark: "—",        sourceReport: "PDGM LUPA Analysis Report",           domain: "Financial Performance", unit: "Percent", frequency: "Weekly", serviceLine: "HH" },
      { name: "% Workers Under 30 Points (FT Employees)",           benchmark: "—",        sourceReport: "Field Productivity - Worker Points",  domain: "Productivity",      unit: "Percent", frequency: "Weekly",  serviceLine: "All"   },
      { name: "$ Unbilled Claims by Location & Service Line",       benchmark: "—",        sourceReport: "AR Aging by Patient Report",          domain: "Revenue Cycle",     unit: "Dollars", frequency: "Weekly",  serviceLine: "All"   },
      { name: "Census per Employee",                                 benchmark: "—",        sourceReport: "Payroll FTE Extract",                 domain: "Productivity",      unit: "Ratio",   frequency: "Monthly", serviceLine: "All"   },
      { name: "Outstanding AR Over 90 Days",                        benchmark: "—",        sourceReport: "AR Aging Report",                     domain: "Revenue Cycle",     unit: "Dollars", frequency: "Monthly", serviceLine: "All"   },
    ],
  },
];

const DOMAIN_COLORS: Record<string, string> = {
  "Census":                "bg-primary/15 text-primary border-primary/30",
  "Admissions":            "bg-chart-4/15 text-chart-4 border-chart-4/30",
  "Clinical Quality":      "bg-chart-3/15 text-chart-3 border-chart-3/30",
  "Revenue":               "bg-destructive/15 text-destructive border-destructive/30",
  "Revenue Cycle":         "bg-chart-5/10 text-chart-5 border-chart-5/20",
  "Financial Performance": "bg-destructive/10 text-destructive border-destructive/20",
  "Productivity":          "bg-chart-2/15 text-chart-2 border-chart-2/30",
  "Compliance":            "bg-chart-1/15 text-chart-1 border-chart-1/30",
  "Workforce":             "bg-muted text-muted-foreground border-border",
};

// Colour map for domain badges
const CATEGORY_COLORS: Record<string, string> = {
  "Operations":            "bg-chart-4/15 text-chart-4 border-chart-4/30",
  "Executive":             "bg-primary/15 text-primary border-primary/30",
  "Clinical Operations":   "bg-chart-3/15 text-chart-3 border-chart-3/30",
  "Clinical Quality":      "bg-chart-1/15 text-chart-1 border-chart-1/30",
  "Clinical Compliance":   "bg-chart-1/10 text-chart-1 border-chart-1/20",
  "Quality Assurance":     "bg-chart-2/15 text-chart-2 border-chart-2/30",
  "Referral Management":   "bg-chart-5/15 text-chart-5 border-chart-5/30",
  "Financial Performance": "bg-destructive/15 text-destructive border-destructive/30",
  "Revenue Cycle":         "bg-chart-5/10 text-chart-5 border-chart-5/20",
  "Hospice Performance":   "bg-chart-3/10 text-chart-3 border-chart-3/20",
  "Workforce Performance": "bg-muted text-muted-foreground border-border",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function KpiExplorer() {
  const [tab, setTab] = useState<Tab>("definitions");

  // Definitions tab state
  const [selected, setSelected]   = useState<KpiKey | null>(null);
  const [data, setData]           = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");

  // Subscribe so pin/unpin re-renders
  useDashboardPins();

  // ── Derived data ─────────────────────────────────────────────────────────

  const kpis = kpiConfig.kpis as Record<string, {
    label: string;
    description: string;
    category: string;
    aggregation: string;
    version: string;
    status: string;
    source: string;
    dimensions?: string[];
    formula?: string;
  }>;

  const categories = useMemo(
    () => ["all", ...Object.keys(kpiConfig.categories)],
    []
  );

  const filteredKpis = useMemo(() => {
    const q = search.toLowerCase();
    return (Object.entries(kpis) as [KpiKey, typeof kpis[string]][]).filter(([key, def]) => {
      const matchesSearch =
        !q ||
        key.includes(q) ||
        def.label.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q);
      const matchesCat = filterCat === "all" || def.category === filterCat;
      return matchesSearch && matchesCat;
    });
  }, [kpis, search, filterCat]);

  // Group filtered KPIs by category for the grouped view
  const grouped = useMemo(() => {
    const map: Record<string, [KpiKey, typeof kpis[string]][]> = {};
    for (const [key, def] of filteredKpis) {
      if (!map[def.category]) map[def.category] = [];
      map[def.category].push([key, def]);
    }
    return map;
  }, [filteredKpis]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function fetchKpi(kpi: KpiKey) {
    setSelected(kpi);
    setLoading(true);
    try {
      const res = await fetch(`/api/kpi/${kpi}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  async function toggleKpiPin(kpi: KpiKey) {
    const def = kpis[kpi];
    if (isItemPinned("kpi", kpi)) {
      await unpinByRef("kpi", kpi);
    } else {
      await pinItem({
        type: "kpi",
        refId: kpi,
        title: def.label,
        subtitle: def.description,
        kpi,
        meta: {
          aggregation: def.aggregation,
          source: def.source,
          category: def.category,
          dimensions: def.dimensions,
        },
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              tab === id
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Definitions tab ─────────────────────────────────────────────── */}
      {tab === "definitions" && (
        <div className="flex flex-col gap-5">

          {/* Header + filters */}
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">KPI Catalog</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Schema v{kpiConfig._meta.schemaVersion} &middot; {Object.keys(kpis).length} KPIs across {Object.keys(kpiConfig.categories).length} domains
                </p>
              </div>
              <span className="text-[10px] font-mono text-primary/70 bg-primary/8 border border-primary/20 rounded px-2 py-0.5">
                BRANCH GRAIN &middot; epi_branchcode
              </span>
            </div>

            {/* Search + category filter */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search KPIs by name, description, or category..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg pl-8 pr-7 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <select
                  value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "All Domains" : c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Result count */}
            <p className="text-[11px] text-muted-foreground">
              Showing {filteredKpis.length} of {Object.keys(kpis).length} KPIs
              {filterCat !== "all" && ` in ${filterCat}`}
              {search && ` matching "${search}"`}
            </p>
          </div>

          {/* KPI cards grouped by domain */}
          {Object.keys(grouped).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No KPIs match your filters.
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-foreground">{category}</h3>
                  <span className="text-[10px] text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5">
                    {items.length}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(([kpi, def]) => {
                    const pinned = isItemPinned("kpi", kpi);
                    const catColor = CATEGORY_COLORS[def.category] ?? "bg-muted text-muted-foreground border-border";
                    return (
                      <div
                        key={kpi}
                        className={cn(
                          "relative border rounded-lg transition-all",
                          selected === kpi
                            ? "border-primary bg-primary/8 shadow-sm shadow-primary/10"
                            : "border-border bg-card hover:border-primary/50 hover:bg-accent/10"
                        )}
                      >
                        {/* Pin button */}
                        <button
                          onClick={() => toggleKpiPin(kpi)}
                          className={cn(
                            "absolute top-2.5 right-2.5 p-1 rounded border transition-colors z-10",
                            pinned
                              ? "border-chart-3/40 bg-chart-3/15 text-chart-3"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                          )}
                          title={pinned ? "Unpin from dashboard" : "Pin to dashboard"}
                          aria-pressed={pinned}
                        >
                          {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </button>

                        {/* Card body */}
                        <button
                          onClick={() => fetchKpi(kpi)}
                          className="text-left w-full p-3.5 pr-9"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold text-foreground leading-tight">{def.label}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mb-2.5">
                            {def.description}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${catColor}`}>
                              {def.category}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">
                              {def.aggregation}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 border border-border rounded px-1.5 py-0.5">
                              v{def.version}
                            </span>
                            <span className={cn(
                              "text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 border",
                              def.status === "Published"
                                ? "bg-chart-1/10 text-chart-1 border-chart-1/25"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              {def.status}
                            </span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading KPI definition...
            </div>
          )}

          {/* Definition detail panel */}
          {data && !loading && (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <ExternalLink className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground capitalize">
                  {selected} — API Definition
                </h3>
              </div>
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-4 overflow-x-auto max-h-[480px]">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Scorecard Catalog tab ──────────────────────────────────────── */}
      {tab === "scorecard" && (
        <div className="flex flex-col gap-5">

          {/* Header */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Scorecard Catalog</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All 8 workbook sheets registered as KPI sources. Every KPI linked to its source report and enterprise domain.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-chart-3/80 bg-chart-3/8 border border-chart-3/20 rounded px-2 py-0.5">
                  {SCORECARD_CATALOG.reduce((n, s) => n + s.kpis.length, 0)} KPI entries
                </span>
                <span className="text-[10px] font-mono text-primary/70 bg-primary/8 border border-primary/20 rounded px-2 py-0.5">
                  8 Scorecards
                </span>
              </div>
            </div>
          </div>

          {/* Scorecard cards */}
          {SCORECARD_CATALOG.map((sc) => (
            <div key={sc.sheet} className="bg-card border border-border rounded-lg overflow-hidden">
              {/* Card header */}
              <div className="flex items-start justify-between gap-3 px-5 py-3.5 bg-muted/20 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sc.badgeColor}`}>
                    {sc.badge}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{sc.sheet}</span>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">{sc.kpis.length} KPIs</span>
              </div>

              {/* Meta row */}
              <div className="px-5 pt-3 pb-2 flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{sc.purpose}</p>
                <div className="flex items-start gap-1.5 text-[11px]">
                  <FileText className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">Source system: <span className="text-foreground font-medium">{sc.sourceSystem}</span></span>
                </div>
                <div className="flex items-start gap-1.5 text-[11px]">
                  <CheckCircle2 className="w-3 h-3 text-chart-1 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground italic">{sc.governance}</span>
                </div>
              </div>

              {/* KPI table */}
              <div className="overflow-x-auto pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/10">
                      <th className="text-left px-5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">KPI Name</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Domain</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Benchmark</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Frequency</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">Source Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sc.kpis.map((kpi) => (
                      <tr key={kpi.name} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-2 text-[11px] text-foreground font-medium">{kpi.name}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap",
                            DOMAIN_COLORS[kpi.domain] ?? "bg-muted text-muted-foreground border-border"
                          )}>
                            {kpi.domain}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] font-semibold text-primary whitespace-nowrap">
                          {kpi.benchmark ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{kpi.unit}</td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{kpi.frequency}</td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground hidden lg:table-cell">
                          <div className="flex items-center gap-1">
                            <Building2 className="w-2.5 h-2.5 shrink-0" />
                            {kpi.sourceReport}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Intelligence tab */}
      {tab === "intelligence" && <KpiIntelligence />}

      {/* Interpreter tab */}
      {tab === "interpreter" && <KpiInterpreter />}
    </div>
  );
}
