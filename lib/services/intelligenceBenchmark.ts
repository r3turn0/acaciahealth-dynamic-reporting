export interface IntelligenceBenchmarkSample {
  baselineValid: boolean;
  hybridValid: boolean;
  semanticMatch: boolean;
  reused: boolean;
  retryAttempted: boolean;
  retryRecovered: boolean;
  baselineLatencyMs: number;
  hybridLatencyMs: number;
  baselineExecutionMs: number;
  hybridExecutionMs: number;
}

export interface IntelligenceBenchmarkSummary {
  sampleCount: number;
  validationSuccessRate: { baseline: number; hybrid: number };
  semanticMatchAccuracy: number;
  reportReuseRate: number;
  retryRecoveryRate: number;
  averageLatencyMs: { baseline: number; hybrid: number };
  averageExecutionMs: { baseline: number; hybrid: number };
  recommendation: "hybrid" | "baseline" | "insufficient_data";
  rationale: string[];
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function average(values: number[]): number {
  return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

/** Pure, PHI-free comparison helper for the same read-only benchmark workload. */
export function summarizeIntelligenceBenchmark(samples: IntelligenceBenchmarkSample[]): IntelligenceBenchmarkSummary {
  const sampleCount = samples.length;
  const retrySamples = samples.filter((sample) => sample.retryAttempted);
  const baselineValidation = rate(samples.filter((sample) => sample.baselineValid).length, sampleCount);
  const hybridValidation = rate(samples.filter((sample) => sample.hybridValid).length, sampleCount);
  const baselineLatency = average(samples.map((sample) => sample.baselineLatencyMs));
  const hybridLatency = average(samples.map((sample) => sample.hybridLatencyMs));
  const baselineExecution = average(samples.map((sample) => sample.baselineExecutionMs));
  const hybridExecution = average(samples.map((sample) => sample.hybridExecutionMs));
  const rationale: string[] = [];

  let recommendation: IntelligenceBenchmarkSummary["recommendation"] = "insufficient_data";
  if (sampleCount >= 10) {
    const hybridQualityWins = hybridValidation >= baselineValidation && rate(samples.filter((sample) => sample.semanticMatch).length, sampleCount) >= 0.8;
    const hybridEfficiencyWins = hybridLatency <= baselineLatency * 1.1 && hybridExecution <= baselineExecution * 1.1;
    recommendation = hybridQualityWins && hybridEfficiencyWins ? "hybrid" : "baseline";
    rationale.push(hybridQualityWins ? "Hybrid met the validation and semantic-quality gate" : "Baseline retained the stronger quality gate");
    rationale.push(hybridEfficiencyWins ? "Hybrid stayed within the latency and execution-efficiency budget" : "Hybrid exceeded the latency or execution-efficiency budget");
  } else {
    rationale.push("At least 10 paired non-PHI samples are required for a recommendation");
  }

  return {
    sampleCount,
    validationSuccessRate: { baseline: baselineValidation, hybrid: hybridValidation },
    semanticMatchAccuracy: rate(samples.filter((sample) => sample.semanticMatch).length, sampleCount),
    reportReuseRate: rate(samples.filter((sample) => sample.reused).length, sampleCount),
    retryRecoveryRate: rate(retrySamples.filter((sample) => sample.retryRecovered).length, retrySamples.length),
    averageLatencyMs: { baseline: baselineLatency, hybrid: hybridLatency },
    averageExecutionMs: { baseline: baselineExecution, hybrid: hybridExecution },
    recommendation,
    rationale,
  };
}
