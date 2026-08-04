import { describe, expect, it } from "vitest";
import {
  DASHBOARD_KPI_KEYS,
  DASHBOARD_KPI_QUERIES,
} from "@/lib/services/dashboardSummary";
import { validateQuery } from "@/lib/services/queryGuard";

describe("dashboard KPI summary", () => {
  it("exposes the four governed headline KPIs in display order", () => {
    expect(DASHBOARD_KPI_KEYS).toEqual([
      "admissions",
      "census",
      "recerts",
      "discharges",
    ]);
  });

  it.each(DASHBOARD_KPI_KEYS)("keeps %s read-only and query-guard valid", (key) => {
    const sql = DASHBOARD_KPI_QUERIES[key];
    expect(sql.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    expect(validateQuery(sql).valid).toBe(true);
  });

  it("uses governed weekly admissions predicates", () => {
    const sql = DASHBOARD_KPI_QUERIES.admissions;
    expect(sql).toContain("epi_AdmitType = 'NEW ADMISSION'");
    expect(sql).toContain("epi_NonAdmitDate IS NULL");
    expect(sql).toContain("BETWEEN @StartDate AND @EndDate");
  });

  it("counts distinct active patients for census as of the end date", () => {
    const sql = DASHBOARD_KPI_QUERIES.census;
    expect(sql).toContain("COUNT_BIG(DISTINCT epi_paid)");
    expect(sql).toContain("epi_status = 'CURRENT'");
    expect(sql).toContain("epi_DischargeDate AS date) > @EndDate");
  });

  it("sums governed recert flags in the weekly certification window", () => {
    const sql = DASHBOARD_KPI_QUERIES.recerts;
    expect(sql).toContain("epi_RecertFlag");
    expect(sql).toContain("SUM(");
    expect(sql).toContain("epi_status <> 'RECERTIFIED'");
    expect(sql).toContain("BETWEEN @StartDate AND @EndDate");
  });

  it("counts distinct discharged episodes in the weekly window", () => {
    const sql = DASHBOARD_KPI_QUERIES.discharges;
    expect(sql).toContain("COUNT_BIG(DISTINCT epi_id)");
    expect(sql).toContain("epi_status = 'DISCHARGED'");
    expect(sql).toContain("DATEADD(DAY, 1, @EndDate)");
  });
});
