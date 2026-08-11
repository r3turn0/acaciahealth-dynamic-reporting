import { describe, expect, it } from "vitest";
import { CANONICAL_REPORTS } from "@/lib/config/canonicalReports";

const IMPORTED_REPORT_NAMES = [
  "Operational (episode based) Current Census By Service Line and Branch — Current Census",
  "Operational (episode based) Current Census By Service Line and Branch + 14 Rolling Days ADC with Patient Days and Current Census vs ADC — 14-Day ADC and Patient Days",
  "Operational (episode based) Daily Census",
  "Operational (episode based) Census and ADC",
  "Operational (episode based) Current Census and ADC Month to Date",
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
});
