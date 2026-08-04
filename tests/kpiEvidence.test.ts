import { describe, expect, it } from "vitest";
import { resolveKpiDependencyGraph } from "@/lib/config/kpiDependencyGraph";
import { compactResultSet, rankSupportingReports, selectTopGovernedReports, type KpiEvidenceBundle } from "@/lib/services/kpiEvidenceService";
import { compareKpiEvidence } from "@/lib/services/kpiComparativeAnalytics";
import { scoreEvidenceConfidence } from "@/lib/services/kpiEvidenceAnalyzer";
import type { SavedReport } from "@/lib/services/reportService";

function report(overrides: Partial<SavedReport> = {}): SavedReport {
  return {
    id: "report-1", name: "Admissions", description: "Governed admissions", prompt: "Run admissions",
    sql: "SELECT COUNT(*) AS admissions FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
    kpi: "admissions", tags: ["canonical"], visibility: "team", status: "published", created_by: "system",
    created_date: "2026-01-01T00:00:00.000Z", last_run_date: null, run_count: 0, last_row_count: null,
    version: 1, version_history: [], ...overrides,
  };
}

function bundle(window: "current" | "prior", value: number): KpiEvidenceBundle {
  const graph = resolveKpiDependencyGraph("admissions")!;
  return {
    graph,
    evidence: [{
      reportId: "report-1", reportName: "Admissions", reportVersion: 1, nodeKey: "admissions", source: "live", status: "success",
      matchReasons: ["exact"], executionMs: 10, dateRange: window === "current" ? { startDate: "2026-07-01", endDate: "2026-07-31" } : { startDate: "2026-06-01", endDate: "2026-06-30" }, window,
      resultSets: [compactResultSet({ columns: ["admissions"], rows: [{ admissions: value }], rowCount: 1 }, `${window}:report-1:1`)],
    }],
    uncoveredNodes: [], failedNodes: [], coverage: 1, reportSuccessRate: 1, mode: "live", generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("KPI evidence pipeline", () => {
  it("resolves formula dependencies for ratio KPIs", () => {
    const graph = resolveKpiDependencyGraph("referral_conversion_rate");
    expect(graph?.requiredKeys).toEqual(expect.arrayContaining(["admissions", "referrals_received"]));
  });

  it("ranks exact canonical reports ahead of aliases", () => {
    const graph = resolveKpiDependencyGraph("admissions")!;
    const ranked = rankSupportingReports(graph, [
      report({ id: "alias", kpi: "discharges", name: "Admission overview", created_by: "user", tags: [] }),
      report({ id: "exact" }),
    ]);
    expect(ranked[0].report.id).toBe("exact");
  });

  it("suppresses duplicate SQL and duplicate dependency selection", () => {
    const selected = selectTopGovernedReports([
      { report: report({ id: "one" }), nodeKey: "admissions", score: 200, reasons: [] },
      { report: report({ id: "two" }), nodeKey: "admissions", score: 190, reasons: [] },
    ]);
    expect(selected).toHaveLength(1);
  });

  it("redacts identifier columns and bounds compact evidence", () => {
    const compact = compactResultSet({ columns: ["patient_id", "admissions"], rows: [{ patient_id: 42, admissions: 3 }], rowCount: 1 }, "citation");
    expect(compact.columns).toEqual(["admissions"]);
    expect(compact.sampleRows[0]).toEqual({ admissions: 3 });
  });

  it("calculates citation-backed current versus prior comparisons", () => {
    const current = bundle("current", 120);
    const prior = bundle("prior", 100);
    const analytics = compareKpiEvidence({ current, prior, windows: { current: current.evidence[0].dateRange, prior: prior.evidence[0].dateRange } });
    expect(analytics.comparisons[0]).toMatchObject({ currentValue: 120, priorValue: 100, percentageVariance: 20, direction: "up" });
    expect(analytics.drivers[0].citationIds).toEqual(["current:report-1:1", "prior:report-1:1"]);
  });

  it("scores complete comparative evidence as high confidence", () => {
    expect(scoreEvidenceConfidence(bundle("current", 120), true)).toMatchObject({ score: 100, band: "high" });
  });
});
