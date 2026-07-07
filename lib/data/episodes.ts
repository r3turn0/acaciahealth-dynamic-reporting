/**
 * /lib/data/episodes.ts
 *
 * Data access layer for CLIENT_EPISODES_ALL queries.
 * All queries are fully parameterized — no user input is ever interpolated.
 * This module is the single place where episode-related SQL lives.
 */

import { executeQuery, executeQueryWithParams } from "@/lib/services/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EpisodeMetrics {
  branch_name?: string;
  week_number?: number;
  month?: number;
  year?: number;
  care_type?: string;
  service_line?: string;
  admissions?: number;
  discharges?: number;
  census?: number;
}

export interface EpisodeFilters {
  startDate: string;
  endDate: string;
  branchCode?: string;
  careTypeId?: number;
  serviceLineId?: number;
}

// ── Admissions ────────────────────────────────────────────────────────────────

/**
 * Returns admission counts grouped by branch and/or week within the date range.
 */
export async function getAdmissionsByBranch(
  filters: EpisodeFilters
): Promise<EpisodeMetrics[]> {
  const query = `
    SELECT
      b.branch_name,
      DATEPART(WEEK, epi.epi_SocDate) AS week_number,
      COUNT(epi.epi_id) AS admissions
    FROM CLIENT_EPISODES_ALL epi
    JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
    WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY
      b.branch_name,
      DATEPART(WEEK, epi.epi_SocDate)
    ORDER BY
      b.branch_name,
      week_number
  `;

  return executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  }) as Promise<EpisodeMetrics[]>;
}

// ── Discharges ────────────────────────────────────────────────────────────────

export async function getDischargesByBranch(
  filters: EpisodeFilters
): Promise<EpisodeMetrics[]> {
  const query = `
    SELECT
      b.branch_name,
      DATEPART(WEEK, epi.epi_DischargeDate) AS week_number,
      COUNT(epi.epi_id) AS discharges
    FROM CLIENT_EPISODES_ALL epi
    JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
    WHERE epi.epi_DischargeDate BETWEEN @StartDate AND @EndDate
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY
      b.branch_name,
      DATEPART(WEEK, epi.epi_DischargeDate)
    ORDER BY
      b.branch_name,
      week_number
  `;

  return executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  }) as Promise<EpisodeMetrics[]>;
}

// ── Census (active patients) ──────────────────────────────────────────────────

export async function getCensusByBranch(
  filters: EpisodeFilters
): Promise<EpisodeMetrics[]> {
  const query = `
    SELECT
      b.branch_name,
      COUNT(epi.epi_id) AS census
    FROM CLIENT_EPISODES_ALL epi
    JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
    WHERE
      epi.epi_SocDate <= @EndDate
      AND (epi.epi_DischargeDate IS NULL OR epi.epi_DischargeDate >= @StartDate)
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY b.branch_name
    ORDER BY b.branch_name
  `;

  return executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  }) as Promise<EpisodeMetrics[]>;
}

// ── Care-type breakdown ───────────────────────────────────────────────────────

export async function getAdmissionsByCareType(
  filters: EpisodeFilters
): Promise<EpisodeMetrics[]> {
  const query = `
    SELECT
      ct.ct_name AS care_type,
      COUNT(epi.epi_id) AS admissions
    FROM CLIENT_EPISODES_ALL epi
    JOIN CARE_TYPES ct ON epi.epi_care_type_id = ct.ct_id
    WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
      ${filters.branchCode ? "AND RTRIM(epi.epi_branchcode) = @BranchCode" : ""}
    GROUP BY ct.ct_name
    ORDER BY admissions DESC
  `;

  return executeQuery(query, {
    StartDate: filters.startDate,
    EndDate: filters.endDate,
    ...(filters.branchCode ? { BranchCode: filters.branchCode } : {}),
  }) as Promise<EpisodeMetrics[]>;
}

// ── Episode detail by ID (single row) ────────────────────────────────────────

export async function getEpisodeById(
  episodeId: number
): Promise<Record<string, unknown> | null> {
  const rows = await executeQueryWithParams(
    `SELECT TOP 1 * FROM CLIENT_EPISODES_ALL WHERE epi_id = @EpisodeId`,
    [{ name: "EpisodeId", type: "int", value: episodeId }]
  );
  return rows[0] ?? null;
}
