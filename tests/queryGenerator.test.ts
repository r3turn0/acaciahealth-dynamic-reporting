import { describe, it, expect } from "vitest";
import { generateSQL, detectKpi } from "@/lib/services/queryGenerator";
import { validateQuery } from "@/lib/services/queryGuard";

const RANGE = { date_range: { start_date: "2024-01-01", end_date: "2024-01-31" } };

describe("detectKpi", () => {
  it.each([
    ["how many admissions last month", "admissions"],
    ["show me discharges by branch", "discharges"],
    ["total revenue this quarter", "revenue"],
    ["daily census by location", "census"],
  ])("detects KPI for %s", (prompt, expected) => {
    expect(detectKpi(prompt)).toBe(expected);
  });

  it("defaults to admissions when no keyword matches", () => {
    expect(detectKpi("give me the numbers")).toBe("admissions");
  });
});

describe("generateSQL", () => {
  it("produces a parameterized query that passes the guard", () => {
    const { sql } = generateSQL("admissions by branch", RANGE);
    expect(sql).toContain("@StartDate");
    expect(sql).toContain("@EndDate");
    expect(validateQuery(sql).valid).toBe(true);
  });

  it("binds the date range into params", () => {
    const { params } = generateSQL("revenue by month", RANGE);
    expect(params.StartDate).toBe("2024-01-01");
    expect(params.EndDate).toBe("2024-01-31");
  });

  it("honors explicit group_by from the visual builder", () => {
    // service_line is a valid grouping for revenue (per kpiConfig).
    const { sql } = generateSQL("revenue", {
      ...RANGE,
      group_by: ["service_line"],
    });
    expect(sql).toContain("sl.sl_name");
  });

  it("drops group_by options that are invalid for the detected KPI", () => {
    // service_line is NOT a valid grouping for admissions, so it is ignored
    // rather than producing an invalid query.
    const { sql } = generateSQL("admissions", {
      ...RANGE,
      group_by: ["service_line"],
    });
    expect(sql).not.toContain("sl.sl_name");
    expect(validateQuery(sql).valid).toBe(true);
  });

  it("applies a LIMIT via OFFSET/FETCH when provided", () => {
    const { sql } = generateSQL("admissions by branch", { ...RANGE, limit: 10 });
    expect(sql).toMatch(/FETCH NEXT 10 ROWS ONLY/);
  });

  it("adds a branch filter parameter when branch_code is set", () => {
    const { sql, params } = generateSQL("admissions", {
      ...RANGE,
      branch_code: "H01",
    });
    expect(sql).toContain("@BranchCode");
    expect(params.BranchCode).toBe("H01");
  });

  it("reports the tables used", () => {
    const { tables_used } = generateSQL("admissions by branch", RANGE);
    expect(tables_used).toContain("CLIENT_EPISODES_ALL");
  });
});
