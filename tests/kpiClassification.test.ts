import { describe, expect, it } from "vitest";
import { analyzeSqlGovernance, classifySqlKpis, splitReadOnlyStatements } from "@/lib/services/kpiClassification";

describe("KPI classification and lineage", () => {
  const censusSql = `
    SELECT branch_code, COUNT(*) AS Census
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE epi_SocDate <= @AsOfDate AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
    GROUP BY branch_code;
    SELECT branch_code, AVG(patient_days) AS ADC
    FROM dbo.CLIENT_EPISODES_ALL
    WHERE census_date BETWEEN @StartDate AND @EndDate
    GROUP BY branch_code;
  `;

  it("splits top-level result statements without splitting nested expressions", () => {
    expect(splitReadOnlyStatements(censusSql)).toHaveLength(2);
    expect(splitReadOnlyStatements("SELECT CASE WHEN 1=1 THEN ';' END AS marker; SELECT 2")).toHaveLength(2);
  });

  it("classifies census and ADC from governed signals", () => {
    const classifications = classifySqlKpis(censusSql);
    expect(classifications.some((item) => item.ruleId === "census")).toBe(true);
    expect(classifications.some((item) => item.ruleId === "adc")).toBe(true);
    expect(classifications[0].confidence).toBeGreaterThan(50);
  });

  it("returns statement-level lineage and conservative validation confidence", () => {
    const analysis = analyzeSqlGovernance(censusSql);
    expect(analysis.statements).toHaveLength(2);
    expect(analysis.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "dbo.CLIENT_EPISODES_ALL" }),
    ]));
    expect(analysis.validation.confidence).toBeGreaterThan(0);
    expect(analysis.validation.confidence).toBeLessThanOrEqual(100);
  });
});
