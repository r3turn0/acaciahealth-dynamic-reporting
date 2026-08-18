import { describe, expect, it } from "vitest";
import { compatibleGrain, normalizeResultSet, sourceLineage } from "@/lib/services/kpiSourceNormalizer";
import type { AnalysisSource } from "@/lib/services/kpiAnalysisTypes";

describe("KPI source normalization", () => {
  it("preserves each result set with a stable citation", () => {
    const first = normalizeResultSet(
      { columns: ["branch", "admissions"], rows: [{ branch: "North", admissions: 12 }], rowCount: 1 },
      "report-1:1", "Admissions by branch",
    );
    const second = normalizeResultSet(
      { columns: ["week", "conversion"], rows: [{ week: "2026-W31", conversion: 0.42 }], rowCount: 1 },
      "report-1:2", "Conversion by week",
    );

    expect([first.citationId, second.citationId]).toEqual(["report-1:1", "report-1:2"]);
    expect(second.sampleRows[0]).toEqual({ week: "2026-W31", conversion: 0.42 });
    expect(first.numericSummary.admissions.total).toBe(12);
  });

  it("excludes likely identifiers and bounds sampled evidence", () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ patient_id: `p-${index}`, branch: "North", value: index * 2 }));
    const normalized = normalizeResultSet(
      { columns: ["patient_id", "branch", "value"], rows, rowCount: rows.length },
      "upload-1:1", "scorecard.csv",
    );

    expect(normalized.columns).toEqual(["branch", "value"]);
    expect(normalized.sampleRows).toHaveLength(20);
    expect(normalized.rowCount).toBe(300);
    expect(normalized.notes.join(" ")).toMatch(/identifier/i);
  });

  it("reports explicit lineage and compatible analysis grain", () => {
    const source: AnalysisSource = {
      id: "report-1", name: "Admissions report", type: "saved-report", executionMode: "cache",
      validationStatus: "virtual-certified", executedAt: "2026-08-18T11:30:00.000Z", dataAgeMs: 1_800_000,
      dateRange: { startDate: "2026-08-01", endDate: "2026-08-18" }, resultSetCount: 1, resultSets: [],
      fallbackReason: "Live execution timed out", diagnostics: [],
    };
    expect(sourceLineage(source)).toContain("cache, virtual-certified, 1 result set, 30 minutes old");

    const branch = normalizeResultSet({ columns: ["branch", "value"], rows: [{ branch: "North", value: 1 }], rowCount: 1 }, "a:1", "A");
    const location = normalizeResultSet({ columns: ["location", "value"], rows: [{ location: "North", value: 2 }], rowCount: 1 }, "b:1", "B");
    expect(compatibleGrain(branch, location)).toBe(true);
  });
});
