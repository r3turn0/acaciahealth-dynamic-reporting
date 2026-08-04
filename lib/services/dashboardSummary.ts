import { buildCacheKey, withCache } from "@/lib/services/cache";
import { executeQueryWithParams, type NamedParam } from "@/lib/services/db";
import { validateQuery } from "@/lib/services/queryGuard";

export type DashboardKpiKey = "admissions" | "census" | "recerts" | "discharges";

export interface DashboardKpiResult {
  value: number | null;
  status: "ok" | "unavailable";
}

export interface DashboardSummary {
  kpis: Record<DashboardKpiKey, DashboardKpiResult>;
  generatedAt: string;
}

export const DASHBOARD_KPI_KEYS: readonly DashboardKpiKey[] = [
  "admissions",
  "census",
  "recerts",
  "discharges",
];

export const DASHBOARD_KPI_QUERIES: Readonly<Record<DashboardKpiKey, string>> = {
  admissions: `SELECT COUNT_BIG(1) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status = 'CURRENT'
      AND epi_NonAdmitDate IS NULL
      AND epi_AdmitType = 'NEW ADMISSION'
      AND CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate`,
  census: `SELECT COUNT_BIG(DISTINCT epi_paid) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status = 'CURRENT'
      AND epi_NonAdmitDate IS NULL
      AND CAST(epi_SocDate AS date) <= @EndDate
      AND @StartDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR CAST(epi_DischargeDate AS date) > @EndDate)`,
  recerts: `SELECT COALESCE(SUM(
      CASE WHEN UPPER(LTRIM(RTRIM(epi_RecertFlag))) IN ('Y', '1', 'R', 'RECERT', 'TRUE')
        THEN 1 ELSE 0 END
    ), 0) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status <> 'RECERTIFIED'
      AND epi_NonAdmitDate IS NULL
      AND CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate`,
  discharges: `SELECT COUNT_BIG(DISTINCT epi_id) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status = 'DISCHARGED'
      AND epi_DischargeDate >= @StartDate
      AND epi_DischargeDate < DATEADD(DAY, 1, @EndDate)`,
};

const QUERY_TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 60_000;

function weekToDate(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

async function loadSummary(): Promise<DashboardSummary> {
  const { start, end } = weekToDate();
  const params: NamedParam[] = [
    { name: "StartDate", value: start, type: "date" },
    { name: "EndDate", value: end, type: "date" },
  ];

  const settled = await Promise.allSettled(DASHBOARD_KPI_KEYS.map(async (key) => {
    const query = DASHBOARD_KPI_QUERIES[key];
    const validation = validateQuery(query);
    if (!validation.valid) throw new Error(validation.errors.join("; "));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Dashboard query timed out")), QUERY_TIMEOUT_MS);
    try {
      const rows = await executeQueryWithParams(query, params, controller.signal);
      const value = Number(rows[0]?.value);
      return [key, Number.isFinite(value) ? value : null] as const;
    } finally {
      clearTimeout(timer);
    }
  }));

  const kpis = Object.fromEntries(
    DASHBOARD_KPI_KEYS.map((key) => [key, { value: null, status: "unavailable" as const }]),
  ) as DashboardSummary["kpis"];
  settled.forEach((result, index) => {
    const key = DASHBOARD_KPI_KEYS[index];
    if (result.status === "fulfilled") {
      kpis[key] = { value: result.value[1], status: "ok" };
    }
  });

  return { kpis, generatedAt: new Date().toISOString() };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const key = buildCacheKey("dashboard-summary", {});
  return (await withCache(key, loadSummary, {
    ttlMs: CACHE_TTL_MS,
    namespace: "dashboard",
    tags: ["dashboard-summary"],
  })).value;
}
