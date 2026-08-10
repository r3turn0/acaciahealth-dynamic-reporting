import { describe, expect, it } from "vitest";
import { buildAnalyticsEvidence, summarizeAnalyticsEvidence } from "@/lib/analytics/evidenceEngine";

describe("analytics evidence engine", () => {
  it("profiles quality, trends, forecasts, and trace deterministically", () => {
    const evidence = buildAnalyticsEvidence({
      columns: ["date", "census"],
      rows: [
        ["2026-08-01", 10],
        ["2026-08-02", 11],
        ["2026-08-03", 12],
        ["2026-08-04", 13],
        ["2026-08-05", 14],
        ["2026-08-06", 15],
      ],
    });

    expect(evidence.quality.completeness).toBe(1);
    expect(evidence.findings.some((finding) => finding.type === "TREND")).toBe(true);
    expect(evidence.forecast).toMatchObject({ direction: "up", projectedValue: 16 });
    expect(evidence.trace.map((step) => step.stage)).toEqual(["PROFILE", "ANALYZE", "VALIDATE", "SYNTHESIZE"]);
  });

  it("flags missing values and duplicate rows", () => {
    const evidence = buildAnalyticsEvidence({
      columns: ["branch", "value"],
      rows: [["A", 10], ["A", 10], ["B", null]],
    });

    expect(evidence.quality.duplicateRows).toBe(1);
    expect(evidence.quality.warnings).toHaveLength(2);
    expect(evidence.confidence.score).toBeLessThan(0.8);
  });

  it("summarizes evidence without including raw dataset rows", () => {
    const evidence = buildAnalyticsEvidence({ columns: ["secret", "value"], rows: [["PATIENT-123", 42]] });
    const summary = summarizeAnalyticsEvidence(evidence);

    expect(summary).not.toContain("PATIENT-123");
    expect(summary).toContain("confidence");
  });
});
