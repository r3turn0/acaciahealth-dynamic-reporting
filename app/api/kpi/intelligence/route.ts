import { NextRequest, NextResponse } from "next/server";
import kpiConfig from "@/lib/config/kpiConfig.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KpiCard {
  kpiName:           string;
  kpiKey:            string;
  value:             string | number;
  unit?:             string;
  trend:             "up" | "down" | "flat";
  changePct:         number;
  invoicePeriod:     string;
  priorValue:        string | number;
  insight:           string;
  confidenceScore:   number;
  dataQualityFlags:  string[];
  category:          string;
  domain:            string;
  suggestedPrompts:  string[];
}

export interface Recommendation {
  title:     string;
  impact:    "High" | "Medium" | "Low";
  reason:    string;
  linkedKpi: string;
}

export interface SchemaField {
  sourceField: string;
  mappedTo:    string;
  category:    string;
}

export interface KpiDefinition {
  kpiName:    string;
  formula:    string;
  dependsOn:  string[];
  category:   string;
  domain:     string;
  source:     string;
}

export interface KpiRelationship {
  kpi:                string;
  drivers:            string[];
  impactedBy:         string[];
  recommendedCharts:  string[];
}

export interface SchemaIntelligence {
  definitions:  KpiDefinition[];
  fieldMappings: SchemaField[];
  relationships: KpiRelationship[];
}

export interface PowerBiSchema {
  factKPI:   { kpi_id: number; kpi_name: string; value: number; trend: string; change_pct: number; date: string; branch: string; invoice_period: string }[];
  dimKPI:    { kpi_id: number; category: string; domain: string; formula: string }[];
  dimDate:   { date: string; month: string; quarter: string; year: number }[];
  dimBranch: { branch: string; region: string; state: string }[];
}

export interface DomainSummary {
  domain:    string;
  kpiCount:  number;
  kpiKeys:   string[];
  status:    "healthy" | "warning" | "critical";
  coverage:  number; // 0-100
}

export interface BranchEntry {
  serviceLine: string;
  epi_slid:    number;
  branchCode:  string;
  branchName:  string;
}

export interface KpiIntelligenceResponse {
  generatedAt:        string;
  invoicePeriod:      string;
  schemaVersion:      string;
  totalKpis:          number;
  domainSummaries:    DomainSummary[];
  kpiCards:           KpiCard[];
  recommendations:    Recommendation[];
  schemaIntelligence: SchemaIntelligence;
  powerBiSchema:      PowerBiSchema;
  branchDirectory:    BranchEntry[];
  askContext:         string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INVOICE_PERIOD = "2026-06";

// ── Domain summaries built from kpiConfig ────────────────────────────────────

function buildDomainSummaries(): DomainSummary[] {
  const categories = kpiConfig.categories as Record<string, string[]>;
  return Object.entries(categories).map(([domain, keys]) => ({
    domain,
    kpiCount: keys.length,
    kpiKeys:  keys,
    status:   "healthy" as const,
    coverage: 100,
  }));
}

// ── Schema-derived KPI definitions ───────────────────────────────────────────

function buildKpiDefinitions(): KpiDefinition[] {
  const kpis = kpiConfig.kpis as Record<string, {
    label: string;
    formula?: string;
    source?: string;
    category: string;
    dimensions?: string[];
  }>;
  const categories = kpiConfig.categories as Record<string, string[]>;

  // Build a reverse map: kpiKey -> domain
  const kpiToDomain: Record<string, string> = {};
  for (const [domain, keys] of Object.entries(categories)) {
    for (const k of keys) kpiToDomain[k] = domain;
  }

  return Object.entries(kpis).map(([key, def]) => ({
    kpiName:   def.label,
    formula:   def.formula ?? "See kpiConfig.json",
    dependsOn: def.dimensions ?? [],
    category:  def.category,
    domain:    kpiToDomain[key] ?? def.category,
    source:    def.source ?? "CLIENT_EPISODES_ALL",
  }));
}

// ── Authoritative Branch Directory (extracted from SQL files) ────────────────

const BRANCH_DIRECTORY: BranchEntry[] = (kpiConfig._meta as unknown as { branchMap: BranchEntry[] }).branchMap ?? [];

// ── Field mappings (authoritative from enterprise dimensions + SQL analysis) ──

const FIELD_MAPPINGS: SchemaField[] = [
  // Episode / Patient Keys
  { sourceField: "epi_id",                 mappedTo: "Episode ID",              category: "Key" },
  { sourceField: "epi_PatientID",          mappedTo: "Patient ID",              category: "Key" },
  // Branch Dimensions
  { sourceField: "epi_branchcode",         mappedTo: "Branch Code",             category: "Dimension" },
  { sourceField: "branch_name",            mappedTo: "Branch Name",             category: "Dimension" },
  { sourceField: "b_region",               mappedTo: "Region",                  category: "Dimension" },
  { sourceField: "b_state",                mappedTo: "State",                   category: "Dimension" },
  // Service Line
  { sourceField: "epi_slid",               mappedTo: "Service Line ID",         category: "Dimension" },
  { sourceField: "service_line",           mappedTo: "Service Line Name",       category: "Dimension" },
  // Clinical Dates
  { sourceField: "epi_SocDate",            mappedTo: "Admission / SOC Date",    category: "Clinical Date" },
  { sourceField: "epi_DischargeDate",      mappedTo: "Discharge Date",          category: "Clinical Date" },
  { sourceField: "epi_ReferralDate",       mappedTo: "Referral Date",           category: "Clinical Date" },
  { sourceField: "epi_RecertDate",         mappedTo: "Recertification Date",    category: "Clinical Date" },
  // Discharge
  { sourceField: "epi_DcCode",             mappedTo: "Discharge Code",          category: "Discharge" },
  { sourceField: "epi_status",             mappedTo: "Episode Status",          category: "Discharge" },
  { sourceField: "dc_class",               mappedTo: "Discharge Class Group",   category: "Discharge" },
  // Census / ADC
  { sourceField: "CensusDate",             mappedTo: "Census Date",             category: "Census" },
  { sourceField: "DailyCensus",            mappedTo: "Daily Census Count",      category: "Census" },
  { sourceField: "patient_days",           mappedTo: "Patient Days",            category: "Census" },
  // Revenue / Billing
  { sourceField: "li_calculatedamount",    mappedTo: "Calculated Amount",       category: "Revenue" },
  { sourceField: "li_servicedate",         mappedTo: "Service Date",            category: "Revenue" },
  { sourceField: "li_deleted",             mappedTo: "Line Item Deleted Flag",  category: "Revenue" },
  { sourceField: "li_void",               mappedTo: "Line Item Void Flag",     category: "Revenue" },
  { sourceField: "li_includeonclaim",      mappedTo: "Include on Claim Flag",   category: "Revenue" },
  { sourceField: "li_epiid",              mappedTo: "Episode ID (Billing FK)",  category: "Revenue" },
  { sourceField: "li_slid",              mappedTo: "Service Line ID (Billing)", category: "Revenue" },
  { sourceField: "li_hold_flag",           mappedTo: "Billing Hold Flag",       category: "Revenue Cycle" },
  { sourceField: "li_hold_days",           mappedTo: "Hold Days",               category: "Revenue Cycle" },
  { sourceField: "li_claim_status",        mappedTo: "Claim Status",            category: "Revenue Cycle" },
  { sourceField: "revenue_per_patient_day",mappedTo: "Revenue Per Patient Day", category: "Revenue Cycle" },
  // PDGM / LUPA
  { sourceField: "lupa_indicator",         mappedTo: "LUPA Indicator",          category: "Financial" },
  { sourceField: "pdgm_expected_payment",  mappedTo: "Expected Payment",        category: "Financial" },
  { sourceField: "period_start_date",      mappedTo: "PDGM Period Start Date",  category: "Financial" },
  // Clinical Notes
  { sourceField: "vn_id",                  mappedTo: "Visit Note ID",           category: "Clinical" },
  { sourceField: "vn_visit_date",          mappedTo: "Visit Date",              category: "Clinical" },
  { sourceField: "vn_completed_flag",      mappedTo: "Note Completed Flag",     category: "Clinical" },
  { sourceField: "vn_signed_datetime",     mappedTo: "Note Signed Datetime",    category: "Clinical" },
  { sourceField: "vn_episode_id",          mappedTo: "Episode ID (Notes FK)",   category: "Clinical" },
  // Workforce
  { sourceField: "worker_id",              mappedTo: "Worker ID",               category: "Workforce" },
  { sourceField: "earned_points",          mappedTo: "Earned Productivity Points", category: "Workforce" },
  { sourceField: "expected_points",        mappedTo: "Expected Points",         category: "Workforce" },
  { sourceField: "target_points",          mappedTo: "Target Points",           category: "Workforce" },
  // Referral
  { sourceField: "epi_NonAdmitDate",       mappedTo: "Non-Admit Date",          category: "Referral" },
  { sourceField: "ntuc_count",             mappedTo: "NTUC Count",              category: "Referral" },
  // QA
  { sourceField: "qa_status",              mappedTo: "QA Status",               category: "Quality" },
  { sourceField: "qa_review_id",           mappedTo: "QA Review ID",            category: "Quality" },
];

// ── KPI relationship graph ────────────────────────────────────────────────────

const KPI_RELATIONSHIPS: KpiRelationship[] = [
  {
    kpi:       "Revenue",
    drivers:   ["Admissions", "Average Daily Census", "Billing Efficiency"],
    impactedBy: ["Billing Holds", "LUPA Rate", "Unbilled Revenue"],
    recommendedCharts: ["bar", "line", "waterfall"],
  },
  {
    kpi:       "Current Census",
    drivers:   ["Admissions", "Patient Days"],
    impactedBy: ["Total Discharges", "Live Discharge Rate"],
    recommendedCharts: ["area", "line", "gauge"],
  },
  {
    kpi:       "Admissions",
    drivers:   ["Referrals Received", "Referral Conversion Rate"],
    impactedBy: ["Average Days Referral to Admission", "Admissions Within 2 Days"],
    recommendedCharts: ["bar", "line", "heatmap"],
  },
  {
    kpi:       "LUPA Rate",
    drivers:   ["Visit Frequency", "Therapy Visit Mix"],
    impactedBy: ["Calculated LUPA Exposure", "Revenue per Patient Day"],
    recommendedCharts: ["bar", "pie", "trend"],
  },
  {
    kpi:       "Hospice Census Equivalent by Branch",
    drivers:   ["Average Daily Census", "HCE Factor (0.40)"],
    impactedBy: ["Length of Stay", "Live Discharge Rate"],
    recommendedCharts: ["line", "stacked_bar", "gauge"],
  },
  {
    kpi:       "Worker Productivity Achievement",
    drivers:   ["Earned Points", "Expected Points", "Visit Volume"],
    impactedBy: ["Census", "Clinician Assignment Mix"],
    recommendedCharts: ["gauge", "bar", "scatter"],
  },
  {
    kpi:       "BP1 Compliance Within 48 Hours",
    drivers:   ["Intake Speed", "Clinician Scheduling"],
    impactedBy: ["LUPA Rate", "Revenue per Patient Day"],
    recommendedCharts: ["gauge", "trend", "bar"],
  },
  {
    kpi:       "Billing Holds",
    drivers:   ["Claim Submission Timeliness", "Coding Accuracy"],
    impactedBy: ["AR Over 90 Days", "Unbilled Revenue", "Revenue"],
    recommendedCharts: ["bar", "pie", "trend"],
  },
];

// ── KPI cards (representative cards across all 11 domains) ───────────────────

function buildKpiCards(): KpiCard[] {
  return [
    // Operations
    {
      kpiName: "Active Census",          kpiKey: "current_census",
      value: 1842, trend: "flat",        changePct: 0.3,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 1836,
      domain: "Operations",              category: "Operations",
      insight: "Census is effectively flat. High admissions are being offset by elevated voluntary discharges, particularly in the Los Angeles region.",
      confidenceScore: 0.91,
      dataQualityFlags: ["Pending status updates in 4 records"],
      suggestedPrompts: ["Show census by branch", "Compare admission vs discharge rate", "Identify voluntary discharge patterns"],
    },
    {
      kpiName: "Admissions",             kpiKey: "admissions",
      value: 348, trend: "up",           changePct: 5.4,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 330,
      domain: "Operations",              category: "Operations",
      insight: "Admissions grew 5.4% driven by a strong referral pipeline in the Inland Empire region. Hospice admissions outpaced home health for the second consecutive period.",
      confidenceScore: 0.93,
      dataQualityFlags: [],
      suggestedPrompts: ["Break down by care type", "Compare hospice vs home health", "Show top referring physicians"],
    },
    {
      kpiName: "Average Daily Census",   kpiKey: "average_daily_census",
      value: 1810, trend: "up",          changePct: 1.8,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 1778,
      domain: "Operations",              category: "Operations",
      insight: "ADC continued its modest upward trend supported by extended hospice stays. Home health ADC remains stable.",
      confidenceScore: 0.90,
      dataQualityFlags: [],
      suggestedPrompts: ["Show ADC by service line", "Trend ADC over 6 periods", "Compare vs target"],
    },
    {
      kpiName: "Patient Days",           kpiKey: "patient_days",
      value: 25340, trend: "up",         changePct: 2.1,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 24818,
      domain: "Operations",              category: "Operations",
      insight: "Patient days grew in line with ADC. Hospice represents 68% of total patient days.",
      confidenceScore: 0.92,
      dataQualityFlags: [],
      suggestedPrompts: ["Split patient days by service line", "Show by branch"],
    },
    // Executive
    {
      kpiName: "Enterprise Total HCE",   kpiKey: "enterprise_total_hce",
      value: 1523, trend: "up",          changePct: 1.9,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 1494,
      domain: "Executive",               category: "Executive",
      insight: "Enterprise HCE is on target. Hospice patient days at 1.00 weight continue to anchor performance; HH contribution at 0.40 is growing steadily.",
      confidenceScore: 0.94,
      dataQualityFlags: [],
      suggestedPrompts: ["Break down HCE by branch", "Compare Hospice vs HH contribution", "Show HCE trend over 6 periods"],
    },
    {
      kpiName: "Implied ADC",            kpiKey: "implied_average_daily_census",
      value: 1809, unit: "patients/day", trend: "flat",  changePct: 0.5,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 1800,
      domain: "Executive",               category: "Executive",
      insight: "Implied ADC from patient days is consistent with point-in-time census, validating data integrity across reporting sources.",
      confidenceScore: 0.96,
      dataQualityFlags: [],
      suggestedPrompts: ["Compare implied vs reported ADC", "Validate by branch"],
    },
    // Financial Performance
    {
      kpiName: "Revenue",                kpiKey: "revenue",
      value: 2840000, unit: "$",         trend: "up",    changePct: 2.1,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 2781000,
      domain: "Financial Performance",   category: "Financial Performance",
      insight: "Total revenue grew modestly at 2.1% despite per-visit rate pressure, driven by higher visit volumes from increased admissions.",
      confidenceScore: 0.89,
      dataQualityFlags: ["2 claims > 60 days outstanding"],
      suggestedPrompts: ["Break down by service line", "Compare to budget target", "Audit outstanding claims"],
    },
    {
      kpiName: "LUPA Rate",              kpiKey: "lupa_rate",
      value: "8.4%", trend: "up",        changePct: 1.2,
      invoicePeriod: INVOICE_PERIOD,     priorValue: "7.2%",
      domain: "Financial Performance",   category: "Financial Performance",
      insight: "LUPA rate increased 1.2pp above the prior period — 3 branches are driving 60% of LUPA periods. Therapy visit frequency appears to be the primary cause.",
      confidenceScore: 0.88,
      dataQualityFlags: ["LUPA rate rising — threshold alert"],
      suggestedPrompts: ["Show LUPA by branch", "Identify high-LUPA clinicians", "Calculate LUPA exposure"],
    },
    {
      kpiName: "Calculated LUPA Exposure", kpiKey: "calculated_lupa_exposure",
      value: 34200, unit: "$",           trend: "up",    changePct: 18.4,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 28882,
      domain: "Financial Performance",   category: "Financial Performance",
      insight: "$34.2K in LUPA revenue exposure this period — up 18.4%. Three branches account for the majority. Intervention on visit frequency could recover ~$22K.",
      confidenceScore: 0.85,
      dataQualityFlags: ["High LUPA exposure — 3 branches above threshold"],
      suggestedPrompts: ["Map LUPA exposure by branch", "Compare to period target", "Project Q3 exposure"],
    },
    // Revenue Cycle
    {
      kpiName: "Billing Holds",          kpiKey: "billing_holds",
      value: 147, trend: "up",           changePct: 12.3,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 131,
      domain: "Revenue Cycle",           category: "Revenue Cycle",
      insight: "Billing hold count increased 12.3%. The majority are concentrated in 2 high-volume branches. Coding errors on therapy visits are the primary driver.",
      confidenceScore: 0.87,
      dataQualityFlags: ["Hold count above baseline", "Therapy coding errors elevated"],
      suggestedPrompts: ["Show holds by branch", "Segment by hold reason", "Audit top 20 held claims"],
    },
    {
      kpiName: "AR Over 90 Days",        kpiKey: "ar_over_90_days",
      value: 213400, unit: "$",          trend: "up",    changePct: 8.7,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 196300,
      domain: "Revenue Cycle",           category: "Revenue Cycle",
      insight: "AR over 90 days grew 8.7%, exceeding the internal alert threshold. Medicare and Managed Care claims represent 74% of the aged balance.",
      confidenceScore: 0.86,
      dataQualityFlags: ["AR > 90 threshold breached"],
      suggestedPrompts: ["Show AR aging by payer", "Identify top 10 aged accounts", "Compare vs collection target"],
    },
    // Hospice Performance
    {
      kpiName: "Average Length of Stay", kpiKey: "avg_length_of_stay",
      value: 84, unit: "days",           trend: "flat",  changePct: -0.6,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 85,
      domain: "Hospice Performance",     category: "Hospice Performance",
      insight: "ALOS is stable near the 84-day mark, below the 100-day benchmark. Shorter stays in the San Diego region are pulling the overall average down.",
      confidenceScore: 0.91,
      dataQualityFlags: [],
      suggestedPrompts: ["Compare ALOS by branch", "Identify short-stay patterns", "Benchmark vs national average"],
    },
    {
      kpiName: "Live Discharge Rate",    kpiKey: "live_discharge_rate",
      value: "18.2%", trend: "up",       changePct: 2.1,
      invoicePeriod: INVOICE_PERIOD,     priorValue: "16.1%",
      domain: "Hospice Performance",     category: "Hospice Performance",
      insight: "Live discharge rate rose to 18.2%, above the 15% internal target. Patient-initiated discharges account for 68% of live discharges.",
      confidenceScore: 0.89,
      dataQualityFlags: ["Live DC rate above target"],
      suggestedPrompts: ["Segment by discharge class", "Identify patient-initiated patterns", "Compare by region"],
    },
    // Clinical Operations
    {
      kpiName: "Visit Notes Activity",   kpiKey: "visit_notes_activity",
      value: 4812, trend: "up",          changePct: 3.4,
      invoicePeriod: INVOICE_PERIOD,     priorValue: 4654,
      domain: "Clinical Operations",     category: "Clinical Operations",
      insight: "Visit note volume is up 3.4% in line with visit count growth. Completion rate is tracking at 94.1%, within acceptable range.",
      confidenceScore: 0.93,
      dataQualityFlags: [],
      suggestedPrompts: ["Show notes by discipline", "Filter unsigned notes", "Compare to visit volume"],
    },
    // Clinical Quality
    {
      kpiName: "BP1 Compliance",         kpiKey: "bp1_compliance_within_48hrs",
      value: "82.3%", trend: "up",       changePct: 2.8,
      invoicePeriod: INVOICE_PERIOD,     priorValue: "79.5%",
      domain: "Clinical Quality",        category: "Clinical Quality",
      insight: "BP1 compliance crossed the 80% target this period at 82.3%. Two branches remain below threshold and require scheduling intervention.",
      confidenceScore: 0.90,
      dataQualityFlags: ["2 branches below BP1 target"],
      suggestedPrompts: ["Show BP1 compliance by branch", "Identify below-threshold branches", "Trend compliance over 6 periods"],
    },
    // Referral Management
    {
      kpiName: "Admissions Within 2 Days", kpiKey: "admissions_within_2_days",
      value: "71.4%", trend: "down",      changePct: -3.2,
      invoicePeriod: INVOICE_PERIOD,      priorValue: "74.6%",
      domain: "Referral Management",      category: "Referral Management",
      insight: "2-day admission rate declined 3.2pp. Intake bottlenecks at 3 branches are delaying SOC. Same-day referrals are completing at 89% but next-day referrals dropped to 61%.",
      confidenceScore: 0.88,
      dataQualityFlags: ["Intake delay alert — 3 branches"],
      suggestedPrompts: ["Show by branch", "Analyze referral-to-SOC distribution", "Identify delayed intake patterns"],
    },
    // Workforce Performance
    {
      kpiName: "Worker Productivity Achievement", kpiKey: "worker_productivity_achievement",
      value: "94.7%", trend: "flat",      changePct: 0.4,
      invoicePeriod: INVOICE_PERIOD,      priorValue: "94.3%",
      domain: "Workforce Performance",    category: "Workforce Performance",
      insight: "Workforce productivity achievement is stable at 94.7%, just below the 100% target. Part-time worker variance is the primary drag on enterprise achievement.",
      confidenceScore: 0.88,
      dataQualityFlags: [],
      suggestedPrompts: ["Show by worker", "Compare full-time vs part-time", "Identify underperforming staff"],
    },
  ];
}

// ── Recommendations ───────────────────────────────────────────────────────────

function buildRecommendations(): Recommendation[] {
  return [
    {
      title: "Reduce LUPA exposure in 3 high-risk branches",
      impact: "High",
      reason: "$34.2K in LUPA revenue exposure — targeted visit frequency intervention in Santa Ana, Riverside, and Fontana could recover ~$22K.",
      linkedKpi: "Calculated LUPA Exposure",
    },
    {
      title: "Resolve billing hold backlog in top 2 branches",
      impact: "High",
      reason: "147 billing holds, up 12.3%. Therapy coding errors are the primary driver — a targeted coding audit would accelerate hold clearance.",
      linkedKpi: "Billing Holds",
    },
    {
      title: "Address AR over 90 days — Medicare and Managed Care",
      impact: "High",
      reason: "AR > 90 days breached the internal alert threshold at $213K. Medicare and Managed Care represent 74% of the aged balance.",
      linkedKpi: "AR Over 90 Days",
    },
    {
      title: "Investigate voluntary discharge spike in Los Angeles",
      impact: "Medium",
      reason: "Live discharge rate rose to 18.2%, above the 15% target. Patient-initiated discharges are 68% of live DCs — care coordination review is indicated.",
      linkedKpi: "Live Discharge Rate",
    },
    {
      title: "Accelerate intake speed in 3 delayed branches",
      impact: "Medium",
      reason: "2-day admission rate dropped 3.2pp to 71.4%. Next-day referral completion fell to 61% at 3 branches — intake process review required.",
      linkedKpi: "Admissions Within 2 Days",
    },
    {
      title: "Lift BP1 compliance in 2 below-threshold branches",
      impact: "Medium",
      reason: "BP1 compliance crossed enterprise target at 82.3% but 2 branches remain below 80%. Scheduling adjustments can close the gap.",
      linkedKpi: "BP1 Compliance Within 48 Hours",
    },
    {
      title: "Accelerate referral intake in high-growth Inland Empire",
      impact: "Low",
      reason: "Inland Empire referral pipeline is strong. Focused intake coordination could sustain the 5.4% admission growth.",
      linkedKpi: "Admissions",
    },
  ];
}

// ── PowerBI schema ────────────────────────────────────────────────────────────

function buildPowerBiSchema(cards: KpiCard[]): PowerBiSchema {
  const today = new Date().toISOString().split("T")[0];
  const definitions = buildKpiDefinitions();

  return {
    factKPI: cards.map((k, i) => ({
      kpi_id:        i + 1,
      kpi_name:      k.kpiName,
      value:         typeof k.value === "string" ? parseFloat(k.value) : k.value,
      trend:         k.trend,
      change_pct:    k.changePct,
      date:          today,
      branch:        "All Branches",
      invoice_period: k.invoicePeriod,
    })),
    dimKPI: cards.map((k, i) => ({
      kpi_id:   i + 1,
      category: k.category,
      domain:   k.domain,
      formula:  definitions.find((d) => d.kpiName === k.kpiName)?.formula ?? "N/A",
    })),
    dimDate: [
      { date: today,          month: "July",  quarter: "Q3", year: 2026 },
      { date: "2026-06-01",   month: "June",  quarter: "Q2", year: 2026 },
      { date: "2026-05-01",   month: "May",   quarter: "Q2", year: 2026 },
    ],
    dimBranch: BRANCH_DIRECTORY.map((b) => ({
      branch:  b.branchName,
      region:  b.serviceLine === "HOME HEALTH" ? "Home Health" : "Hospice",
      state:   "CA",
    })),
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

function buildIntelligence(): KpiIntelligenceResponse {
  const kpiCards        = buildKpiCards();
  const recommendations = buildRecommendations();
  const kpiDefinitions  = buildKpiDefinitions();

  const schemaIntelligence: SchemaIntelligence = {
    definitions:   kpiDefinitions,
    fieldMappings: FIELD_MAPPINGS,
    relationships: KPI_RELATIONSHIPS,
  };

  const totalKpis = Object.keys(kpiConfig.kpis).length;

  const askContext =
    `AcaciaHealth Dynamic Reporting — Schema v${kpiConfig._meta.schemaVersion} — Invoice Period ${INVOICE_PERIOD}. ` +
    `${totalKpis} KPIs across ${Object.keys(kpiConfig.categories).length} domains. ` +
    `Key signals: LUPA Rate 8.4% (+1.2pp), Billing Holds 147 (+12.3%), AR>90 $213K (+8.7%), ` +
    `Census 1842 (flat), Admissions 348 (+5.4%), Revenue $2.84M (+2.1%), BP1 82.3% (+2.8pp), ` +
    `Live DC Rate 18.2% (+2.1pp), ALOS 84 days, Worker Productivity 94.7%. ` +
    `Priority actions: LUPA exposure intervention, billing hold audit, AR recovery, ` +
    `voluntary discharge investigation, intake speed improvement.`;

  return {
    generatedAt:        new Date().toISOString(),
    invoicePeriod:      INVOICE_PERIOD,
    schemaVersion:      kpiConfig._meta.schemaVersion,
    totalKpis,
    domainSummaries:    buildDomainSummaries(),
    kpiCards,
    recommendations,
    schemaIntelligence,
    powerBiSchema:      buildPowerBiSchema(kpiCards),
    branchDirectory:    BRANCH_DIRECTORY,
    askContext,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  return NextResponse.json(buildIntelligence());
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(buildIntelligence());
}
