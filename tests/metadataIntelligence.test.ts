import { describe, expect, it } from "vitest";
import { analyzeSql, classifyColumn } from "@/lib/services/metadataIntelligence";
import { buildStaticCatalog } from "@/lib/services/metadataRegistry";

const column = (name: string, type = "varchar") => ({ name, type, isPk: false, isFk: false, nullable: true });

describe("metadata intelligence", () => {
  it("classifies healthcare identifiers without sampling values", () => {
    const finding = classifyColumn("dbo.CLIENTS", column("patient_mrn"));
    expect(finding.classification).toBe("PHI");
    expect(finding.rationale).toContain("no values were sampled");
  });

  it("returns advisory-only SQL lineage and bounded scores", () => {
    const result = analyzeSql(
      "SELECT e.epi_id, COUNT(v.visit_id) FROM dbo.CLIENT_EPISODES_ALL e JOIN dbo.CLIENT_EPISODE_VISITS_ALL v ON e.epi_id = v.epi_id WHERE e.epi_SocDate BETWEEN @StartDate AND @EndDate GROUP BY e.epi_id",
      buildStaticCatalog(),
    );
    expect(result.tablesUsed).toHaveLength(2);
    expect(result.joinConfidenceScore).toBeGreaterThanOrEqual(80);
    expect(result.executionReadinessScore).toBeGreaterThan(0);
    expect(result.advisory).toBe(true);
    expect(result.persisted).toBe(false);
  });

  it("recognizes the governed hospice view without treating later commas as Cartesian sources", () => {
    const sql = `;WITH DailyCensus AS (
      SELECT ServiceDate AS CensusDate, [Client Brnch] AS branch_name, COUNT(DISTINCT epi_paid) AS current_census
      FROM dbo.V_AL_HOSPICEDAILYCENSUSINFO
      WHERE ServiceDate BETWEEN @StartDate AND @EndDate
      GROUP BY ServiceDate, [Client Brnch]
    )
    SELECT CensusDate, branch_name, current_census,
      LAG(current_census) OVER (PARTITION BY branch_name ORDER BY CensusDate) AS prior_census
    FROM DailyCensus
    ORDER BY branch_name, CensusDate`;
    const result = analyzeSql(sql, buildStaticCatalog());

    expect(result.tablesUsed).toContain("dbo.V_AL_HOSPICEDAILYCENSUSINFO");
    expect(result.errors.join(" ")).not.toContain("Cartesian");
    expect(result.warnings).toEqual([]);
    expect(result.validationStatus).toBe("ready");
    expect(result.executionReadinessScore).toBe(100);
  });

  it("blocks Cartesian-risk SQL and never recommends executable DDL", () => {
    const result = analyzeSql("SELECT a.epi_id FROM dbo.CLIENT_EPISODES_ALL a, dbo.BRANCHES b");
    expect(result.validationStatus).toBe("blocked");
    expect(result.errors.join(" ")).toContain("Cartesian");
    expect(JSON.stringify(result.optimizationRecommendations)).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
  });
});
