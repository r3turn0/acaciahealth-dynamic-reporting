import { NextRequest, NextResponse } from "next/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KpiCard {
  kpiName: string;
  kpiKey: string;
  value: string | number;
  unit?: string;
  trend: "up" | "down" | "flat";
  changePct: number;
  invoicePeriod: string;
  priorValue: string | number;
  insight: string;
  confidenceScore: number;
  dataQualityFlags: string[];
  category: "Financial" | "Clinical" | "Operational";
  suggestedPrompts: string[];
}

export interface Recommendation {
  title: string;
  impact: "High" | "Medium" | "Low";
  reason: string;
  linkedKpi: string;
}

export interface SchemaField {
  sourceField: string;
  mappedTo: string;
  category: string;
}

export interface KpiDefinition {
  kpiName: string;
  formula: string;
  dependsOn: string[];
  category: string;
}

export interface KpiRelationship {
  kpi: string;
  drivers: string[];
  impactedBy: string[];
  recommendedCharts: string[];
}

export interface SchemaIntelligence {
  definitions: KpiDefinition[];
  fieldMappings: SchemaField[];
  relationships: KpiRelationship[];
}

export interface PowerBiSchema {
  factKPI: {
    kpi_id: number;
    kpi_name: string;
    value: number;
    trend: string;
    change_pct: number;
    date: string;
    branch: string;
    invoice_period: string;
  }[];
  dimKPI: { kpi_id: number; category: string; formula: string }[];
  dimDate: { date: string; month: string; quarter: string; year: number }[];
  dimBranch: { branch: string; region: string; state: string }[];
}

export interface KpiIntelligenceResponse {
  generatedAt: string;
  invoicePeriod: string;
  kpiCards: KpiCard[];
  recommendations: Recommendation[];
  schemaIntelligence: SchemaIntelligence;
  powerBiSchema: PowerBiSchema;
  askContext: string; // Used to hydrate the Ask AI box
}

// ── Static intelligence data ─────────────────────────────────────────────────

const INVOICE_PERIOD = "2026-06";

function buildIntelligence(): KpiIntelligenceResponse {
  const kpiCards: KpiCard[] = [
    {
      kpiName: "Revenue per Visit",
      kpiKey: "revenue",
      value: 112,
      unit: "$",
      trend: "down",
      changePct: -8,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: 121.7,
      insight:
        "Revenue per visit declined primarily due to a 12% increase in billing adjustments across 2 high-volume branches. Late claim submissions in Santa Ana and Riverside contributed to $43K in deferred revenue.",
      confidenceScore: 0.87,
      dataQualityFlags: [
        "Late invoices from 2 branches",
        "3 claims pending adjudication",
      ],
      category: "Financial",
      suggestedPrompts: [
        "Break down by branch",
        "Compare vs last 3 invoice periods",
        "Analyze impact of billing adjustments",
        "Show clinician-level performance",
        "Project next period trend",
      ],
    },
    {
      kpiName: "Admissions",
      kpiKey: "admissions",
      value: 348,
      trend: "up",
      changePct: 5.4,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: 330,
      insight:
        "Admissions grew 5.4% driven by a strong referral pipeline in the Inland Empire region. Hospice admissions outpaced home health for the second consecutive period.",
      confidenceScore: 0.93,
      dataQualityFlags: [],
      category: "Clinical",
      suggestedPrompts: [
        "Break down by care type",
        "Compare hospice vs home health",
        "Show top referring physicians",
        "Identify low-performing regions",
        "Trend over last 6 periods",
      ],
    },
    {
      kpiName: "Active Census",
      kpiKey: "census",
      value: 1842,
      trend: "flat",
      changePct: 0.3,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: 1836,
      insight:
        "Census is effectively flat. High admission volume is being offset by an elevated discharge rate, particularly voluntary discharges in the Los Angeles region.",
      confidenceScore: 0.91,
      dataQualityFlags: ["Pending status updates in 4 records"],
      category: "Clinical",
      suggestedPrompts: [
        "Analyze discharge reasons",
        "Show census by branch",
        "Identify voluntary discharge patterns",
        "Compare length of stay by region",
      ],
    },
    {
      kpiName: "Discharges",
      kpiKey: "discharges",
      value: 201,
      trend: "up",
      changePct: 11.7,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: 180,
      insight:
        "Discharge volume is up 11.7%. While expected discharges (goal met) are tracking well, a 22% spike in voluntary discharges warrants investigation into care coordination and patient satisfaction.",
      confidenceScore: 0.85,
      dataQualityFlags: ["High voluntary discharge rate — 22% above baseline"],
      category: "Operational",
      suggestedPrompts: [
        "Segment by discharge reason",
        "Show voluntary vs expected discharges",
        "Evaluate scheduling efficiency",
        "Map to clinician assignments",
        "Identify low-performing regions",
      ],
    },
    {
      kpiName: "Total Revenue",
      kpiKey: "revenue_total",
      value: 2840000,
      unit: "$",
      trend: "up",
      changePct: 2.1,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: 2781000,
      insight:
        "Total revenue grew modestly at 2.1% despite the per-visit rate pressure, primarily due to higher visit volumes from increased admissions.",
      confidenceScore: 0.89,
      dataQualityFlags: ["2 claims > 60 days outstanding"],
      category: "Financial",
      suggestedPrompts: [
        "Break down by service line",
        "Compare to budget target",
        "Audit outstanding claims",
        "Project Q3 revenue",
      ],
    },
    {
      kpiName: "Billing Adjustment Rate",
      kpiKey: "adjustments",
      value: "14.2%",
      trend: "up",
      changePct: 3.1,
      invoicePeriod: INVOICE_PERIOD,
      priorValue: "11.1%",
      insight:
        "Adjustment rate has risen to 14.2%, exceeding the 12% internal threshold. Root cause analysis points to coding errors on therapy visits and late OASIS submissions.",
      confidenceScore: 0.82,
      dataQualityFlags: [
        "Coding error rate elevated on therapy visits",
        "Late OASIS submissions in 2 branches",
      ],
      category: "Financial",
      suggestedPrompts: [
        "Audit high adjustment accounts",
        "Show by payer type",
        "Identify coding error patterns",
        "Benchmark vs national average",
      ],
    },
  ];

  const recommendations: Recommendation[] = [
    {
      title: "Reduce billing delays in Santa Ana and Riverside",
      impact: "High",
      reason:
        "Late invoices from 2 branches are deferring an estimated $43K in revenue and elevating the adjustment rate.",
      linkedKpi: "Revenue per Visit",
    },
    {
      title: "Audit high-adjustment accounts",
      impact: "High",
      reason:
        "Billing adjustment rate has breached the 12% threshold; therapy visit coding errors are the primary driver.",
      linkedKpi: "Billing Adjustment Rate",
    },
    {
      title: "Investigate voluntary discharge spike",
      impact: "Medium",
      reason:
        "Voluntary discharges are 22% above baseline — a risk to census stability and revenue continuity.",
      linkedKpi: "Discharges",
    },
    {
      title: "Optimize clinician utilization rates",
      impact: "Medium",
      reason:
        "Per-visit revenue decline suggests suboptimal visit mix; higher-acuity visits should be prioritized to improve revenue per encounter.",
      linkedKpi: "Revenue per Visit",
    },
    {
      title: "Accelerate referral intake in high-growth regions",
      impact: "Low",
      reason:
        "Inland Empire referral pipeline is strong — a focused intake coordination effort could sustain the 5.4% admission growth.",
      linkedKpi: "Admissions",
    },
  ];

  const schemaIntelligence: SchemaIntelligence = {
    definitions: [
      {
        kpiName: "Revenue per Visit",
        formula: "SUM(li_amount) / COUNT(DISTINCT visit_id)",
        dependsOn: ["li_amount", "visit_id", "li_service_date"],
        category: "Financial",
      },
      {
        kpiName: "Admissions",
        formula: "COUNT(*) WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
        dependsOn: ["epi_SocDate", "epi_id", "epi_BranchCode"],
        category: "Clinical",
      },
      {
        kpiName: "Active Census",
        formula: "COUNT(DISTINCT epi_id) WHERE episode is open",
        dependsOn: ["epi_id", "epi_SocDate", "epi_DischargeDate"],
        category: "Clinical",
      },
      {
        kpiName: "Billing Adjustment Rate",
        formula: "SUM(amt_adj) / SUM(li_amount)",
        dependsOn: ["amt_adj", "li_amount"],
        category: "Financial",
      },
    ],
    fieldMappings: [
      { sourceField: "amt_adj", mappedTo: "Adjustments", category: "Revenue Reduction" },
      { sourceField: "li_amount", mappedTo: "Billed Amount", category: "Revenue" },
      { sourceField: "epi_SocDate", mappedTo: "Admission Date", category: "Clinical Date" },
      { sourceField: "epi_DischargeDate", mappedTo: "Discharge Date", category: "Clinical Date" },
      { sourceField: "epi_BranchCode", mappedTo: "Branch", category: "Dimension" },
      { sourceField: "visit_id", mappedTo: "Visit", category: "Clinical Event" },
      { sourceField: "li_service_date", mappedTo: "Service Date", category: "Billing Date" },
      { sourceField: "li_payer_type", mappedTo: "Payer", category: "Dimension" },
    ],
    relationships: [
      {
        kpi: "Revenue per Visit",
        drivers: ["Billing Efficiency", "Case Mix Index", "Visit Volume"],
        impactedBy: ["Adjustments", "Denials", "Coding Errors"],
        recommendedCharts: ["line", "bar", "waterfall"],
      },
      {
        kpi: "Admissions",
        drivers: ["Referral Volume", "Intake Speed", "Regional Coverage"],
        impactedBy: ["Discharge Rate", "Census Capacity"],
        recommendedCharts: ["line", "bar", "heatmap"],
      },
      {
        kpi: "Active Census",
        drivers: ["Admissions", "Length of Stay"],
        impactedBy: ["Discharge Rate", "Voluntary Discharges"],
        recommendedCharts: ["area", "line", "gauge"],
      },
      {
        kpi: "Billing Adjustment Rate",
        drivers: ["Coding Accuracy", "OASIS Submission Timeliness"],
        impactedBy: ["Payer Mix", "Therapy Visit Volume"],
        recommendedCharts: ["bar", "pie", "trend"],
      },
    ],
  };

  const today = new Date().toISOString().split("T")[0];
  const powerBiSchema: PowerBiSchema = {
    factKPI: kpiCards.map((k, i) => ({
      kpi_id: i + 1,
      kpi_name: k.kpiName,
      value: typeof k.value === "string" ? parseFloat(k.value) : k.value,
      trend: k.trend,
      change_pct: k.changePct,
      date: today,
      branch: "All Branches",
      invoice_period: k.invoicePeriod,
    })),
    dimKPI: kpiCards.map((k, i) => ({
      kpi_id: i + 1,
      category: k.category,
      formula:
        schemaIntelligence.definitions.find((d) => d.kpiName === k.kpiName)
          ?.formula ?? "N/A",
    })),
    dimDate: [
      { date: today, month: "June", quarter: "Q2", year: 2026 },
      { date: "2026-05-01", month: "May", quarter: "Q2", year: 2026 },
      { date: "2026-04-01", month: "April", quarter: "Q2", year: 2026 },
    ],
    dimBranch: [
      { branch: "Santa Ana", region: "Orange County", state: "CA" },
      { branch: "Riverside", region: "Inland Empire", state: "CA" },
      { branch: "Los Angeles", region: "LA Metro", state: "CA" },
      { branch: "San Diego", region: "San Diego", state: "CA" },
    ],
  };

  return {
    generatedAt: new Date().toISOString(),
    invoicePeriod: INVOICE_PERIOD,
    kpiCards,
    recommendations,
    schemaIntelligence,
    powerBiSchema,
    askContext: `AcaciaHealth Dynamic Reporting — Invoice Period ${INVOICE_PERIOD}. KPIs: Revenue per Visit $112 (-8%), Admissions 348 (+5.4%), Census 1842 (+0.3%), Discharges 201 (+11.7%), Billing Adjustment Rate 14.2% (+3.1pp). Key issues: elevated billing adjustments, voluntary discharge spike, late OASIS submissions.`,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const data = buildIntelligence();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  // Accept an optional { invoicePeriod, filters } body for future live data
  const data = buildIntelligence();
  return NextResponse.json(data);
}
