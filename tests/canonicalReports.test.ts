import { describe, expect, it } from "vitest";
import { CANONICAL_REPORTS } from "@/lib/config/canonicalReports";

const IMPORTED_REPORT_NAMES = [
  "Operational (episode based) Current Census By Service Line and Branch — Current Census",
  "Operational (episode based) Current Census By Service Line and Branch + 14 Rolling Days ADC with Patient Days and Current Census vs ADC — 14-Day ADC and Patient Days",
  "Operational (episode based) Daily Census",
  "Operational (episode based) Census and ADC",
  "Operational (episode based) Current Census and ADC Month to Date",
  "Operational Ending Census and ADC",
  "Enterprise Census by Patient Days and ADC",
  "Expired Licenses",
  "Active Census (Billable Visit Filter)",
  "WAAR Census Daily Variance",
  "WAAR Daily Census",
];

describe("canonical Saved Reports audit", () => {
  it("replaces legacy admissions reports with the filename-named sources", () => {
    const expectedAdmissions = [
      "All Admissions by Branch",
      "Avg Admissions By Referrals",
      "All Admissions by Service Line",
      "Home Health Admissions By Care Type",
      "Current Admissions",
    ];

    for (const name of expectedAdmissions) {
      const matches = CANONICAL_REPORTS.filter((report) => report.name === name);
      expect(matches, name).toHaveLength(1);
      expect(matches[0].sourceFile).toBe(`${name}.sql`);
      expect(matches[0].resultSetCount).toBe(1);
      expect(matches[0].description).not.toMatch(/^Canonical report imported/);
      expect(matches[0].sql).toMatch(/\bdbo\.SERVICE_LINES\b/i);
    }

    const names = CANONICAL_REPORTS.map((report) => report.name);
    expect(names).not.toContain("Avg Admittance Referals");
    expect(names).not.toContain("Admissions — Result 1");
    expect(names).not.toContain("Admissions — Result 2");
  });

  it("uses authoritative service-line and branch dimensions for admissions", () => {
    const replacementNames = new Set([
      "All Admissions by Branch",
      "Avg Admissions By Referrals",
      "All Admissions by Service Line",
      "Home Health Admissions By Care Type",
      "Current Admissions",
    ]);
    const admissions = CANONICAL_REPORTS.filter((report) => replacementNames.has(report.name));

    for (const report of admissions) {
      expect(report.sql, report.name).not.toMatch(/\b(?:dim_branch|bucket_map)\b/i);
      expect(report.sql, report.name).not.toMatch(/\bVALUES\s*\(/i);
      expect(report.sql, report.name).toMatch(/\bdbo\.SERVICE_LINES\b/i);
    }

    for (const report of admissions.filter((item) => item.name !== "All Admissions by Service Line")) {
      expect(report.sql, report.name).toMatch(/\bdbo\.BRANCHES\b/i);
      expect(report.sql, report.name).toMatch(/\bbranch_code\b/i);
      expect(report.sql, report.name).toMatch(/\bbranch_name\b/i);
    }
  });

  it("imports each requested census result set as an independent report", () => {
    for (const name of IMPORTED_REPORT_NAMES) {
      const matches = CANONICAL_REPORTS.filter((report) => report.name === name);
      expect(matches, name).toHaveLength(1);
      expect(matches[0].resultSetCount).toBe(1);
    }
  });

  it("omits date declarations and SQL Server batch directives", () => {
    for (const report of CANONICAL_REPORTS) {
      expect(report.sql, report.name).not.toMatch(/\bDECLARE\s+@(StartDate|EndDate|EndOfDate|AsOfDate)\b/i);
      expect(report.sql, report.name).not.toMatch(/^\s*(?:USE\s+[\[\]A-Za-z0-9_.]+\s*;?|GO\s*;?)\s*$/im);
    }
  });

  it("uses explicit projections instead of SELECT wildcards", () => {
    for (const report of CANONICAL_REPORTS) {
      expect(report.sql, report.name).not.toMatch(/\bSELECT[ \t]+(?:[A-Za-z_][A-Za-z0-9_]*\.)?\*/i);
    }
  });

  it("adds deterministic semantic tags to every canonical report", () => {
    for (const report of CANONICAL_REPORTS) {
      expect(report.tags).toContain("read-only");
      expect(report.tags.length).toBeGreaterThanOrEqual(5);
    }
    const report = CANONICAL_REPORTS.find((item) => item.name === "Operational Ending Census and ADC");
    expect(report?.sourceFile).toBe("Operational Ending Census and ADC.sql");
    expect(report?.tags).toEqual(expect.arrayContaining(["census", "average-daily-census", "episode-based", "service-line", "branch", "region"]));
  });
});
