import { describe, expect, it } from "vitest";
import { CANONICAL_REPORTS } from "@/lib/config/canonicalReports";

const IMPORTED_REPORT_NAMES = [
  "Operational (episode based) Current Census By Service Line and Branch — Current Census",
  "Operational (episode based) Current Census By Service Line and Branch + 14 Rolling Days ADC with Patient Days and Current Census vs ADC — 14-Day ADC and Patient Days",
  "Operational (episode based) Daily Census",
  "Operational (episode based) Census and ADC",
  "Operational (episode based) Current Census and ADC Month to Date",
  "Operational Ending Census and ADC",
];

describe("canonical Saved Reports audit", () => {
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
      expect(report.sql, report.name).not.toMatch(/^\s*(?:USE|GO)\b/im);
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
