import { buildCacheKey, withCache } from "@/lib/services/cache";
import { executeQueryWithParams, type NamedParam } from "@/lib/services/db";
import { validateQuery } from "@/lib/services/queryGuard";

export type DashboardKpiKey = "admissions" | "census" | "revenue" | "discharges";

export interface DashboardKpiResult {
  value: number | null;
  status: "ok" | "unavailable";
}

export interface DashboardSummary {
  kpis: Record<DashboardKpiKey, DashboardKpiResult>;
  generatedAt: string;
}

const KPI_QUERIES: Record<DashboardKpiKey, string> = {
  admissions: `SELECT COUNT_BIG(1) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status = 'CURRENT'
      AND epi_NonAdmitDate IS NULL
      AND epi_AdmitType = 'NEW ADMISSION'
      AND CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate`,
  census: `SELECT COUNT_BIG(1) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_status = 'CURRENT'
      AND epi_NonAdmitDate IS NULL
      AND CAST(epi_SocDate AS date) <= @EndDate
      AND (epi_DischargeDate IS NULL OR CAST(epi_DischargeDate AS date) >= @StartDate)`,
  revenue: `SELECT CAST(COALESCE(SUM(li_calculatedamount), 0) AS decimal(18,2)) AS value
    FROM Billing.LINE_ITEMS
    WHERE li_deleted = 0
      AND li_void = 0
      AND li_includeonclaim = 1
      AND CAST(li_servicedate AS date) BETWEEN @StartDate AND @EndDate`,
  discharges: `SELECT COUNT_BIG(1) AS value
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_DischargeDate >= @StartDate
      AND epi_DischargeDate < DATEADD(DAY, 1, @EndDate)`,
};

const KPI_KEYS = Object.keys(KPI_QUERIES) as DashboardKpiKey[];
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

  const settled = await Promise.allSettled(KPI_KEYS.map(async (key) => {
    const query = KPI_QUERIES[key];
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

  const kpis = Object.fromEntries(KPI_KEYS.map((key) => [key, { value: null, status: "unavailable" as const }])) as DashboardSummary["kpis"];
  settled.forEach((result, index) => {
    const key = KPI_KEYS[index];
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
