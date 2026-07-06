/**
 * /lib/data/billing.ts
 *
 * Data access layer for Billing.LINE_ITEMS queries.
 * All parameters are bound via mssql typed inputs — never interpolated.
 */

import { executeQuery } from "@/lib/services/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RevenueRow {
  branch_name?: string;
  week_number?: number;
  month?: number;
  service_line?: string;
  revenue: number;
}

export interface BillingFilters {
  startDate: string;
  endDate: string;
  branchCode?: string;
}

// ── Revenue by branch ─────────────────────────────────────────────────────────

export async function getRevenueByBranch(
  filters: BillingFilters
): Promise<RevenueRow[]> {
  const query = `
    SELECT
      b.branch_name,
      DATEPART(WEEK, li.li_service_date) AS week_number,
      SUM(li.li_amount) AS revenue
    FROM Billing.LINE_ITEMS li
    JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id
    JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
    WHERE li.li_service_date BETWEEN @StartDate AND @EndDate
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY
      b.branch_name,
      DATEPART(WEEK, li.li_service_date)
    ORDER BY
      b.branch_name,
      week_number
  `;

  const rows = await executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  });
  return rows as unknown as RevenueRow[];
}

// ── Revenue by service line ───────────────────────────────────────────────────

export async function getRevenueByServiceLine(
  filters: BillingFilters
): Promise<RevenueRow[]> {
  const query = `
    SELECT
      sl.sl_name AS service_line,
      SUM(li.li_amount) AS revenue
    FROM Billing.LINE_ITEMS li
    JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id
    JOIN SERVICE_LINES sl ON epi.epi_sl_id = sl.sl_id
    WHERE li.li_service_date BETWEEN @StartDate AND @EndDate
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY sl.sl_name
    ORDER BY revenue DESC
  `;

  const rows = await executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  });
  return rows as unknown as RevenueRow[];
}

// ── Monthly revenue trend ─────────────────────────────────────────────────────

export async function getRevenueTrend(
  filters: BillingFilters
): Promise<{ month: number; year: number; revenue: number }[]> {
  const query = `
    SELECT
      DATEPART(YEAR,  li.li_service_date) AS year,
      DATEPART(MONTH, li.li_service_date) AS month,
      SUM(li.li_amount) AS revenue
    FROM Billing.LINE_ITEMS li
    WHERE li.li_service_date BETWEEN @StartDate AND @EndDate
      ${filters.branchCode
        ? `AND li.li_epi_id IN (
             SELECT epi_id FROM CLIENT_EPISODES_ALL
             WHERE RTRIM(epi_branchcode) = @BranchCode
           )`
        : ""}
    GROUP BY
      DATEPART(YEAR,  li.li_service_date),
      DATEPART(MONTH, li.li_service_date)
    ORDER BY year, month
  `;

  return executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  }) as Promise<{ month: number; year: number; revenue: number }[]>;
}
