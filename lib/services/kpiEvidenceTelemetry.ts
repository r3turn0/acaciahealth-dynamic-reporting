export interface KpiEvidenceTelemetrySample {
  ts: number;
  kpiKey: string;
  durationMs: number;
  coverage: number;
  reportSuccessRate: number;
  confidence: number;
  mode: "live" | "cached" | "partial" | "metadata-fallback";
  liveReports: number;
  cachedReports: number;
  failedReports: number;
  failureCategories: Partial<Record<"unsafe-sql" | "timeout" | "execution" | "empty-result", number>>;
  comparisonAvailable: boolean;
}

export interface KpiEvidenceTelemetrySummary {
  sampleCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  averageCoverage: number | null;
  averageReportSuccessRate: number | null;
  averageConfidence: number | null;
  fallbackRate: number | null;
  comparisonRate: number | null;
  sourceMix: { live: number; cached: number; failed: number };
  failureCategories: KpiEvidenceTelemetrySample["failureCategories"];
  coverageGaps: Array<{ kpiKey: string; attempts: number; averageCoverage: number; fallbackRate: number }>;
}

const MAX_SAMPLES = 2_000;
const globalForTelemetry = globalThis as unknown as { __acaciaKpiEvidenceSamples?: KpiEvidenceTelemetrySample[] };
const samples = globalForTelemetry.__acaciaKpiEvidenceSamples ?? [];
globalForTelemetry.__acaciaKpiEvidenceSamples = samples;

export function recordKpiEvidenceSample(sample: Omit<KpiEvidenceTelemetrySample, "ts"> & { ts?: number }): void {
  samples.push({ ...sample, ts: sample.ts ?? Date.now() });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function getKpiEvidenceTelemetrySummary(windowMs = 15 * 60_000): KpiEvidenceTelemetrySummary {
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter((sample) => sample.ts >= cutoff);
  const failures: KpiEvidenceTelemetrySample["failureCategories"] = {};
  const sourceMix = { live: 0, cached: 0, failed: 0 };
  const grouped = new Map<string, KpiEvidenceTelemetrySample[]>();
  for (const sample of recent) {
    sourceMix.live += sample.liveReports;
    sourceMix.cached += sample.cachedReports;
    sourceMix.failed += sample.failedReports;
    grouped.set(sample.kpiKey, [...(grouped.get(sample.kpiKey) ?? []), sample]);
    for (const [category, count] of Object.entries(sample.failureCategories)) {
      failures[category as keyof typeof failures] = (failures[category as keyof typeof failures] ?? 0) + (count ?? 0);
    }
  }
  const coverageGaps = [...grouped.entries()].map(([kpiKey, entries]) => ({
    kpiKey,
    attempts: entries.length,
    averageCoverage: average(entries.map((entry) => entry.coverage)) ?? 0,
    fallbackRate: entries.filter((entry) => entry.mode === "metadata-fallback").length / entries.length,
  })).filter((entry) => entry.averageCoverage < 1 || entry.fallbackRate > 0).sort((a, b) => a.averageCoverage - b.averageCoverage || b.attempts - a.attempts).slice(0, 8);
  return {
    sampleCount: recent.length,
    latencyP50Ms: percentile(recent.map((sample) => sample.durationMs), 50),
    latencyP95Ms: percentile(recent.map((sample) => sample.durationMs), 95),
    averageCoverage: average(recent.map((sample) => sample.coverage)),
    averageReportSuccessRate: average(recent.map((sample) => sample.reportSuccessRate)),
    averageConfidence: average(recent.map((sample) => sample.confidence)),
    fallbackRate: recent.length ? recent.filter((sample) => sample.mode === "metadata-fallback").length / recent.length : null,
    comparisonRate: recent.length ? recent.filter((sample) => sample.comparisonAvailable).length / recent.length : null,
    sourceMix,
    failureCategories: failures,
    coverageGaps,
  };
}

export function getKpiEvidenceTelemetrySamples(limit = 50): KpiEvidenceTelemetrySample[] {
  return samples.slice(-Math.max(1, limit)).reverse();
}

export function clearKpiEvidenceTelemetry(): void {
  samples.splice(0, samples.length);
}
