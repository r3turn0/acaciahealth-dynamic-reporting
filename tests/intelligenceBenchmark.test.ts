import { describe, expect, it } from "vitest";
import { summarizeIntelligenceBenchmark, type IntelligenceBenchmarkSample } from "@/lib/services/intelligenceBenchmark";

function sample(overrides: Partial<IntelligenceBenchmarkSample> = {}): IntelligenceBenchmarkSample {
  return {
    baselineValid: true,
    hybridValid: true,
    semanticMatch: true,
    reused: true,
    retryAttempted: false,
    retryRecovered: false,
    baselineLatencyMs: 100,
    hybridLatencyMs: 70,
    baselineExecutionMs: 80,
    hybridExecutionMs: 60,
    ...overrides,
  };
}

describe("summarizeIntelligenceBenchmark", () => {
  it("requires a meaningful paired sample", () => {
    expect(summarizeIntelligenceBenchmark([sample()]).recommendation).toBe("insufficient_data");
  });

  it("recommends hybrid when quality and efficiency gates pass", () => {
    const summary = summarizeIntelligenceBenchmark(Array.from({ length: 10 }, () => sample()));
    expect(summary.recommendation).toBe("hybrid");
    expect(summary.reportReuseRate).toBe(1);
  });

  it("retains baseline when hybrid quality regresses", () => {
    const samples = Array.from({ length: 10 }, (_, index) => sample({
      hybridValid: index < 6,
      semanticMatch: index < 6,
    }));
    expect(summarizeIntelligenceBenchmark(samples).recommendation).toBe("baseline");
  });

  it("reports retry recovery only across attempted retries", () => {
    const summary = summarizeIntelligenceBenchmark([
      sample({ retryAttempted: true, retryRecovered: true }),
      sample({ retryAttempted: true, retryRecovered: false }),
      sample(),
    ]);
    expect(summary.retryRecoveryRate).toBe(0.5);
  });
});
