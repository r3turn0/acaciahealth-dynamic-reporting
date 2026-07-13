import { describe, it, expect } from "vitest";
import { parameterizeDates } from "@/lib/services/dateParams";

describe("parameterizeDates", () => {
  it("rewrites BETWEEN CONVERT(date, ...) ranges to @StartDate/@EndDate", () => {
    const input =
      "WHERE epi.epi_SocDate BETWEEN CONVERT(date, '2017-03-02') AND CONVERT(date, '2017-09-01')";
    const { sql, replaced } = parameterizeDates(input);
    expect(replaced).toBe(true);
    expect(sql).toContain("BETWEEN @StartDate AND @EndDate");
    expect(sql).not.toContain("2017-03-02");
  });

  it("rewrites plain string-literal BETWEEN ranges", () => {
    const { sql, replaced } = parameterizeDates(
      "WHERE d.census_date BETWEEN '2017-03-02' AND '2017-09-01'"
    );
    expect(replaced).toBe(true);
    expect(sql).toContain("BETWEEN @StartDate AND @EndDate");
  });

  it("rewrites >= / < comparison bounds", () => {
    const { sql, replaced } = parameterizeDates(
      "WHERE x >= '2017-03-02' AND x < '2017-09-02'"
    );
    expect(replaced).toBe(true);
    expect(sql).toContain(">= @StartDate");
    expect(sql).toContain("< @EndDate");
  });

  it("handles CAST(... AS date) and CONVERT(datetime, ...)", () => {
    const { sql, replaced } = parameterizeDates(
      "WHERE x >= CAST('2017-03-02' AS date) AND x <= CONVERT(datetime, '2017-09-01 23:59:59')"
    );
    expect(replaced).toBe(true);
    expect(sql).toContain(">= @StartDate");
    expect(sql).toContain("<= @EndDate");
  });

  it("is idempotent on already-parameterized SQL", () => {
    const input = "WHERE epi_SocDate BETWEEN @StartDate AND @EndDate";
    const { sql, replaced } = parameterizeDates(input);
    expect(replaced).toBe(false);
    expect(sql).toBe(input);
  });

  it("never touches numbers or non-date strings", () => {
    const input = "WHERE amount >= 100 AND region = 'West'";
    const { sql, replaced } = parameterizeDates(input);
    expect(replaced).toBe(false);
    expect(sql).toBe(input);
  });

  it("handles empty input safely", () => {
    expect(parameterizeDates("").replaced).toBe(false);
  });
});
