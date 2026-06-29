import schemaConfig from "../config/schemaConfig.json";
import kpiConfig from "../config/kpiConfig.json";

type KpiKey = keyof typeof kpiConfig;

interface Filters {
  date_range: {
    start_date: string;
    end_date: string;
  };
  branch_code?: string;
  group_by?: string[];
  having?: string;
  order_by?: string;
  order_dir?: "ASC" | "DESC";
  limit?: number;
}

interface GeneratedQuery {
  sql: string;
  params: {
    StartDate: string;
    EndDate: string;
  };
  kpi: KpiKey;
  tables_used: string[];
  filters_applied: string[];
}

// ── KPI detection ─────────────────────────────────────────────────────────────

const KPI_KEYWORD_MAP: Record<string, KpiKey> = {
  admission: "admissions",
  admissions: "admissions",
  "start of care": "admissions",
  "start-of-care": "admissions",
  soc: "admissions",
  discharge: "discharges",
  discharges: "discharges",
  discharged: "discharges",
  revenue: "revenue",
  billing: "revenue",
  billed: "revenue",
  payment: "revenue",
  income: "revenue",
  amount: "revenue",
  census: "census",
  "active patients": "census",
  "active census": "census",
  patients: "census",
};

export function detectKpi(prompt: string): KpiKey {
  const lower = prompt.toLowerCase();
  for (const [keyword, kpi] of Object.entries(KPI_KEYWORD_MAP)) {
    if (lower.includes(keyword)) return kpi;
  }
  return "admissions";
}

// ── Group-by detection ────────────────────────────────────────────────────────

// Maps user-friendly keywords to { alias, selectExpr, groupExpr }
interface GroupDef {
  selectAs: string;
  selectExpr: string;
  groupExpr: string;
}

function buildGroupDefs(kpiKey: KpiKey): Record<string, GroupDef> {
  const kpi = kpiConfig[kpiKey];
  const dateCol = `${kpi.alias}.${kpi.date_column}`;
  return {
    branch: {
      selectAs: "branch_name",
      selectExpr: "b.branch_name",
      groupExpr: "b.branch_name",
    },
    week: {
      selectAs: "week_number",
      selectExpr: `DATEPART(WEEK, ${dateCol})`,
      groupExpr: `DATEPART(WEEK, ${dateCol})`,
    },
    month: {
      selectAs: "month",
      selectExpr: `DATEPART(MONTH, ${dateCol})`,
      groupExpr: `DATEPART(MONTH, ${dateCol})`,
    },
    year: {
      selectAs: "year",
      selectExpr: `DATEPART(YEAR, ${dateCol})`,
      groupExpr: `DATEPART(YEAR, ${dateCol})`,
    },
    care_type: {
      selectAs: "care_type",
      selectExpr: "ct.ct_name",
      groupExpr: "ct.ct_name",
    },
    service_line: {
      selectAs: "service_line",
      selectExpr: "sl.sl_name",
      groupExpr: "sl.sl_name",
    },
  };
}

const KEYWORD_TO_GROUP: Record<string, string> = {
  week: "week",
  weekly: "week",
  "by week": "week",
  month: "month",
  monthly: "month",
  "by month": "month",
  yearly: "year",
  annual: "year",
  "by year": "year",
  branch: "branch",
  "by branch": "branch",
  region: "branch",
  "by region": "branch",
  hospice: "branch",
  "care type": "care_type",
  care_type: "care_type",
  "by care type": "care_type",
  "service line": "service_line",
  service_line: "service_line",
  "by service line": "service_line",
};

function detectGroupBys(prompt: string, kpiKey: KpiKey): string[] {
  const lower = prompt.toLowerCase();
  const kpi = kpiConfig[kpiKey];
  const allowed = new Set(kpi.grouping_options);
  const detected = new Set<string>();

  for (const [keyword, group] of Object.entries(KEYWORD_TO_GROUP)) {
    if (lower.includes(keyword) && allowed.has(group)) {
      detected.add(group);
    }
  }

  // Default: group by branch when nothing detected
  if (detected.size === 0) {
    detected.add("branch");
  }

  return Array.from(detected);
}

// ── JOIN builder ──────────────────────────────────────────────────────────────

type SchemaEntry = {
  alias: string;
  keys: string[];
  joins: Record<string, string>;
};
const schema = schemaConfig as Record<string, SchemaEntry>;

function buildJoins(kpiKey: KpiKey, requiredGroups: string[]): string[] {
  const kpi = kpiConfig[kpiKey];
  const factTable = kpi.fact_table;
  const factEntry = schema[factTable];
  const joins: string[] = [];

  // Branch join
  if (requiredGroups.includes("branch")) {
    if (factTable === "CLIENT_EPISODES_ALL" && factEntry?.joins?.["BRANCHES"]) {
      joins.push(`JOIN BRANCHES b ON ${factEntry.joins["BRANCHES"]}`);
    } else if (factTable === "Billing.LINE_ITEMS") {
      // Revenue fact table needs to go via episodes
      joins.push(`JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id`);
      joins.push(`JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`);
    }
  }

  // Care type join — only from CLIENT_EPISODES_ALL
  if (requiredGroups.includes("care_type") && factTable === "CLIENT_EPISODES_ALL") {
    if (factEntry?.joins?.["CARE_TYPES"]) {
      joins.push(`JOIN CARE_TYPES ct ON ${factEntry.joins["CARE_TYPES"]}`);
    }
  }

  // Service line join
  if (requiredGroups.includes("service_line")) {
    if (factTable === "CLIENT_EPISODES_ALL" && factEntry?.joins?.["SERVICE_LINES"]) {
      joins.push(`JOIN SERVICE_LINES sl ON ${factEntry.joins["SERVICE_LINES"]}`);
    } else if (factTable === "Billing.LINE_ITEMS") {
      // Only join via episodes if not already joined
      if (!joins.some((j) => j.includes("CLIENT_EPISODES_ALL"))) {
        joins.push(`JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id`);
      }
      joins.push(`JOIN SERVICE_LINES sl ON epi.epi_sl_id = sl.sl_id`);
    }
  }

  return joins;
}

// ── Main SQL generator ────────────────────────────────────────────────────────

export function generateSQL(prompt: string, filters: Filters): GeneratedQuery {
  const kpiKey = detectKpi(prompt);
  const kpi = kpiConfig[kpiKey];
  const groupKeys = filters.group_by?.length
    ? filters.group_by.filter((g) => (kpi.grouping_options as string[]).includes(g))
    : detectGroupBys(prompt, kpiKey);

  const groupDefs = buildGroupDefs(kpiKey);
  const joins = buildJoins(kpiKey, groupKeys);

  // Build SELECT fields: dimension columns first, then the metric
  const selectFields: string[] = [];
  const groupByExprs: string[] = [];

  for (const key of groupKeys) {
    const def = groupDefs[key];
    if (!def) continue;
    selectFields.push(`${def.selectExpr} AS ${def.selectAs}`);
    groupByExprs.push(def.groupExpr);
  }
  selectFields.push(`${kpi.aggregation} AS ${kpiKey}`);

  // WHERE clause
  const whereParts: string[] = [
    `${kpi.alias}.${kpi.date_column} BETWEEN @StartDate AND @EndDate`,
  ];
  if (filters.branch_code) {
    whereParts.push(
      `RTRIM(${kpi.fact_table === "Billing.LINE_ITEMS" ? "epi" : kpi.alias}.epi_branchcode) = '${filters.branch_code}'`
    );
  }

  // ORDER BY
  const orderBy = filters.order_by
    ? filters.order_by
    : groupByExprs[0] ?? `${kpiKey}`;
  const orderDir = filters.order_dir ?? "ASC";

  // HAVING
  const havingClause = filters.having ? `\nHAVING ${filters.having}` : "";

  const sql = [
    `SELECT`,
    `    ${selectFields.join(",\n    ")}`,
    `FROM ${kpi.fact_table} ${kpi.alias}`,
    ...joins.map((j) => `${j}`),
    `WHERE`,
    `    ${whereParts.join("\n    AND ")}`,
    groupByExprs.length > 0
      ? `GROUP BY\n    ${groupByExprs.join(",\n    ")}`
      : "",
    havingClause,
    `ORDER BY ${orderBy} ${orderDir}`,
    filters.limit ? `OFFSET 0 ROWS FETCH NEXT ${filters.limit} ROWS ONLY` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const tablesUsed = [kpi.fact_table, ...joins.map((j) => j.split(" ")[1])];
  const filtersApplied = [
    `Date range: ${filters.date_range.start_date} → ${filters.date_range.end_date}`,
    ...groupKeys.map((g) => `Group by: ${g}`),
    ...(filters.branch_code ? [`Branch: ${filters.branch_code}`] : []),
  ];

  return {
    sql,
    params: {
      StartDate: filters.date_range.start_date,
      EndDate: filters.date_range.end_date,
    },
    kpi: kpiKey,
    tables_used: [...new Set(tablesUsed)],
    filters_applied: filtersApplied,
  };
}
