import { beforeEach, describe, expect, it } from "vitest";
import { clearKpiEvidenceTelemetry, getKpiEvidenceTelemetrySummary, recordKpiEvidenceSample } from "@/lib/services/kpiEvidenceTelemetry";

describe("KPI evidence telemetry", () => {
  beforeEach(() => clearKpiEvidenceTelemetry());

  it("summarizes aggregate evidence quality without row data", () => {
    recordKpiEvidenceSample({
      ts: Date.now(), kpiKey: "admissions", durationMs: 120, coverage: 0.5, reportSuccessRate: 0.5,
      confidence: 62, mode: "partial", liveReports: 1, cachedReports: 0, failedReports: 1,
      failureCategories: { timeout: 1 }, comparisonAvailable: false,
    });
    recordKpiEvidenceSample({
      ts: Date.now(), kpiKey: "admissions", durationMs: 200, coverage: 1, reportSuccessRate: 1,
      confidence: 90, mode: "live", liveReports: 2, cachedReports: 0, failedReports: 0,
      failureCategories: {}, comparisonAvailable: true,
    });
    const summary = getKpiEvidenceTelemetrySummary();
    expect(summary).toMatchObject({ sampleCount: 2, latencyP95Ms: 200, averageCoverage: 0.75, fallbackRate: 0, comparisonRate: 0.5 });
    expect(summary.sourceMix).toEqual({ live: 3, cached: 0, failed: 1 });
    expect(summary.failureCategories.timeout).toBe(1);
    expect(summary.coverageGaps[0].kpiKey).toBe("admissions");
  });
});
