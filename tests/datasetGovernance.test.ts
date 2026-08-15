import { describe, expect, it } from "vitest";
import { buildDatasetExport, compareDatasetDefinitions, computeHealth, normalizeSelectedTables } from "@/lib/datasets/datasetGovernance";
import { canRequestDatasetApproval } from "@/lib/datasets/virtualDatasetRegistry";

const dataset = {
  datasetId: "DS-GOV-1",
  datasetName: "Governed Operations",
  description: "Executive operations reporting",
  owner: "Analytics Team",
  version: "1.0.0",
  status: "Draft",
  tables: ["CLIENTS", "BRANCHES"],
  selectedTables: [
    { name: "CLIENTS", schema: "dbo", columns: [{ name: "CLIENT_ID", type: "int", nullable: false, isPk: true }, { name: "BRANCH_ID", type: "int", nullable: false, isPk: false, isFk: true }] },
    { name: "BRANCHES", schema: "dbo", columns: [{ name: "BRANCH_ID", type: "int", nullable: false, isPk: true }] },
  ],
  relationships: ["rel-1"],
  dimensions: ["Branch"],
  measures: ["Client Count"],
  glossaryMappings: ["Active Client"],
  businessRules: ["Exclude test records"],
};

describe("dataset governance", () => {
  it("normalizes legacy table selections without inventing fields", () => {
    expect(normalizeSelectedTables(["CLIENTS"], [])).toEqual([{ name: "CLIENTS", schema: "dbo", columns: [] }]);
  });

  it("computes deterministic health with component evidence", () => {
    const result = computeHealth(dataset);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.breakdown.relationships).toBe(100);
    expect(Object.keys(result.breakdown)).toEqual(["relationships", "joins", "metadata", "measures", "documentation"]);
  });

  it("allows only healthy drafts to request approval", () => {
    expect(canRequestDatasetApproval({ status: "Draft", health: 70 })).toBe(true);
    expect(canRequestDatasetApproval({ status: "Draft", health: 69 })).toBe(false);
    expect(canRequestDatasetApproval({ status: "Pending Approval", health: 95 })).toBe(false);
  });

  it("returns stable added, removed and modified version differences", () => {
    const diff = compareDatasetDefinitions({ ...dataset, measures: ["Revenue"], tables: ["CLIENTS"] }, dataset);
    expect(diff.added).toContain("Table: BRANCHES");
    expect(diff.added).toContain("Measure: Client Count");
    expect(diff.removed).toContain("Measure: Revenue");
  });

  it("exports metadata, dictionary, lineage and graph artifacts", () => {
    expect(buildDatasetExport(dataset, "json").mime).toBe("application/json");
    expect(buildDatasetExport(dataset, "yaml").content).toContain("name: \"Governed Operations\"");
    expect(buildDatasetExport(dataset, "dictionary").content).toContain("CLIENT_ID");
    expect(buildDatasetExport(dataset, "lineage").content).toContain("dataset_id");
    expect(buildDatasetExport(dataset, "graph").content).toContain("nodes");
  });
});
