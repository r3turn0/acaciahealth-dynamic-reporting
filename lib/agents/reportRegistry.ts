/**
 * Report Registry Agent
 * Persists saved reports to an in-process store (upgradeable to DB when SQL_CONNECTION_STRING is set).
 * Mirrors the DynamicReports table contract from the spec.
 */

import { createHash } from "crypto";

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
  created_by: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
}

export interface ExecutionHistoryEntry {
  id: string;
  report_id: string;
  ran_at: string;
  row_count: number;
  execution_ms: number;
  cache_hit: boolean;
  demo_mode: boolean;
}

// ── In-memory store (replace with DB queries when SQL is live) ────────────────

const reportStore = new Map<string, SavedReport>();
const executionHistory: ExecutionHistoryEntry[] = [];

// Seed with a few demo reports on first load
function seedDemoReports() {
  if (reportStore.size > 0) return;

  const demos: Omit<SavedReport, "id">[] = [
    {
      name: "Weekly Admissions by Branch",
      description: "Counts SOC admissions per branch per week for any date range",
      prompt: "Show weekly admissions grouped by hospice region",
      sql: `SELECT TOP 10000
    RTRIM(b.branch_name) AS branch_name,
    DATEPART(WEEK, epi.epi_SocDate) AS week_number,
    COUNT(*) AS admissions
FROM CLIENT_EPISODES_ALL epi
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(b.branch_name), DATEPART(WEEK, epi.epi_SocDate)
ORDER BY week_number, branch_name`,
      kpi: "admissions",
      tags: ["admissions", "branch", "weekly"],
      created_by: "system",
      created_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      run_count: 14,
      last_row_count: 42,
    },
    {
      name: "Revenue WTD by Branch",
      description: "Week-to-date billed revenue grouped by branch",
      prompt: "Weekly revenue by branch for home health",
      sql: `SELECT TOP 10000
    RTRIM(b.branch_name) AS branch_name,
    DATEPART(WEEK, li.li_service_date) AS week_number,
    SUM(li.li_amount) AS revenue
FROM Billing.LINE_ITEMS li
JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE li.li_service_date BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(b.branch_name), DATEPART(WEEK, li.li_service_date)
ORDER BY week_number, branch_name`,
      kpi: "revenue",
      tags: ["revenue", "branch", "weekly"],
      created_by: "system",
      created_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      run_count: 8,
      last_row_count: 18,
    },
    {
      name: "Active Census by Care Type",
      description: "Distinct active patient count grouped by care type",
      prompt: "Active patient census by care type",
      sql: `SELECT TOP 10000
    RTRIM(ct.ct_name) AS care_type,
    COUNT(DISTINCT epi.epi_id) AS census
FROM CLIENT_EPISODES_ALL epi
JOIN CARE_TYPES ct ON epi.epi_care_type_id = ct.ct_id
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(ct.ct_name)
ORDER BY census DESC`,
      kpi: "census",
      tags: ["census", "care_type"],
      created_by: "system",
      created_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      run_count: 3,
      last_row_count: 12,
    },
  ];

  for (const d of demos) {
    const id = createHash("sha256")
      .update(d.name + d.created_date)
      .digest("hex")
      .slice(0, 12);
    reportStore.set(id, { id, ...d });
  }
}

// ── CRUD operations ───────────────────────────────────────────────────────────

export function listReports(): SavedReport[] {
  seedDemoReports();
  return Array.from(reportStore.values()).sort(
    (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
  );
}

export function getReport(id: string): SavedReport | null {
  seedDemoReports();
  return reportStore.get(id) ?? null;
}

export function saveReport(
  input: Omit<SavedReport, "id" | "created_date" | "run_count" | "last_row_count" | "last_run_date">
): SavedReport {
  const id = createHash("sha256")
    .update(input.name + new Date().toISOString())
    .digest("hex")
    .slice(0, 12);

  const report: SavedReport = {
    id,
    ...input,
    created_date: new Date().toISOString(),
    last_run_date: null,
    run_count: 0,
    last_row_count: null,
  };

  seedDemoReports();
  reportStore.set(id, report);
  return report;
}

export function updateReport(
  id: string,
  patch: Partial<Omit<SavedReport, "id" | "created_date">>
): SavedReport | null {
  seedDemoReports();
  const existing = reportStore.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  reportStore.set(id, updated);
  return updated;
}

export function deleteReport(id: string): boolean {
  return reportStore.delete(id);
}

export function recordExecution(entry: Omit<ExecutionHistoryEntry, "id">): void {
  const id = createHash("sha256")
    .update(entry.report_id + entry.ran_at)
    .digest("hex")
    .slice(0, 12);
  executionHistory.unshift({ id, ...entry });

  // Update report metadata
  const report = reportStore.get(entry.report_id);
  if (report) {
    reportStore.set(entry.report_id, {
      ...report,
      run_count: report.run_count + 1,
      last_run_date: entry.ran_at,
      last_row_count: entry.row_count,
    });
  }
}

export function getExecutionHistory(reportId?: string): ExecutionHistoryEntry[] {
  const history = reportId
    ? executionHistory.filter((e) => e.report_id === reportId)
    : executionHistory;
  return history.slice(0, 50);
}
