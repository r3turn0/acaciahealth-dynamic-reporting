import schemaConfig from "../config/schemaConfig.json";
import kpiConfig from "../config/kpiConfig.json";

type KpiKey = keyof typeof kpiConfig;
type SchemaKey = keyof typeof schemaConfig;

interface Filters {
  date_range: {
    start_date: string;
    end_date: string;
  };
  branch_code?: string;
  group_by?: string;
}

interface GeneratedQuery {
  sql: string;
  params: {
    StartDate: string;
    EndDate: string;
  };
  kpi: string;
}

const KPI_KEYWORD_MAP: Record<string, KpiKey> = {
  admission: "admissions",
  admissions: "admissions",
  "start of care": "admissions",
  soc: "admissions",
  discharge: "discharges",
  discharges: "discharges",
  revenue: "revenue",
  billing: "revenue",
  billed: "revenue",
  payment: "revenue",
  census: "census",
  "active patients": "census",
  patients: "census",
};

const GROUP_BY_MAP: Record<string, string> = {
  branch: "b.branch_name",
  week: "DATEPART(WEEK, epi.epi_SocDate)",
  region: "b.branch_name",
  care_type: "ct.ct_name",
  service_line: "sl.sl_name",
};

function detectKpi(prompt: string): KpiKey {
  const lower = prompt.toLowerCase();
  for (const [keyword, kpi] of Object.entries(KPI_KEYWORD_MAP)) {
    if (lower.includes(keyword)) return kpi;
  }
  return "admissions"; // default
}

function detectGroupBy(prompt: string, kpiKey: KpiKey): string[] {
  const lower = prompt.toLowerCase();
  const kpi = kpiConfig[kpiKey];
  const groups: string[] = [];

  if (lower.includes("week") || lower.includes("weekly")) {
    groups.push("DATEPART(WEEK, epi." + kpi.date_column + ") AS week_number");
  }
  if (lower.includes("branch") || lower.includes("region") || lower.includes("hospice")) {
    groups.push("b.branch_name");
  }
  if (lower.includes("care type") || lower.includes("care_type")) {
    groups.push("ct.ct_name");
  }
  if (groups.length === 0) {
    groups.push("b.branch_name");
  }
  return groups;
}

function buildJoins(kpiKey: KpiKey, prompt: string): string {
  const lower = prompt.toLowerCase();
  const joins: string[] = [];
  const schema = schemaConfig as Record<string, { alias: string; keys: string[]; joins: Record<string, string> }>;

  // Always join BRANCHES for branch grouping
  if (lower.includes("branch") || lower.includes("region") || lower.includes("hospice") || true) {
    const epiJoins = schema["CLIENT_EPISODES_ALL"]?.joins;
    if (epiJoins?.["BRANCHES"]) {
      joins.push(`JOIN BRANCHES b ON ${epiJoins["BRANCHES"]}`);
    }
  }

  if (lower.includes("care type") || lower.includes("care_type")) {
    const epiJoins = schema["CLIENT_EPISODES_ALL"]?.joins;
    if (epiJoins?.["CARE_TYPES"]) {
      joins.push(`JOIN CARE_TYPES ct ON ${epiJoins["CARE_TYPES"]}`);
    }
  }

  if (lower.includes("service line") || lower.includes("service_line")) {
    const epiJoins = schema["CLIENT_EPISODES_ALL"]?.joins;
    if (epiJoins?.["SERVICE_LINES"]) {
      joins.push(`JOIN SERVICE_LINES sl ON ${epiJoins["SERVICE_LINES"]}`);
    }
  }

  return joins.join("\n        ");
}

export function generateSQL(prompt: string, filters: Filters): GeneratedQuery {
  const kpiKey = detectKpi(prompt);
  const kpi = kpiConfig[kpiKey];
  const groupByFields = detectGroupBy(prompt, kpiKey);
  const joins = buildJoins(kpiKey, prompt);

  const selectFields = [...groupByFields, `${kpi.aggregation} AS ${kpiKey}`];
  const groupByRaw = groupByFields.map((f) => f.replace(/ AS \w+$/, "").replace(/ AS week_number$/, ""));

  let whereClause = `epi.${kpi.date_column} BETWEEN @StartDate AND @EndDate`;
  if (filters.branch_code) {
    whereClause += `\n            AND RTRIM(epi.epi_branchcode) = RTRIM('${filters.branch_code}')`;
  }

  const sql = `
        SELECT 
            ${selectFields.join(",\n            ")}
        FROM ${kpi.fact_table} epi
        ${joins}
        WHERE ${whereClause}
        GROUP BY 
            ${groupByRaw.join(",\n            ")}
        ORDER BY ${groupByRaw[0]}
    `.trim();

  return {
    sql,
    params: {
      StartDate: filters.date_range.start_date,
      EndDate: filters.date_range.end_date,
    },
    kpi: kpiKey,
  };
}
