export type WorkloadClass = "reference" | "aggregate" | "patient" | "clinical" | "metadata" | "unknown";

export interface PerformanceSample {
  ts: number;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  sqlDurationMs?: number;
  cacheStatus?: "HIT" | "MISS" | "COALESCED" | "BYPASS";
  workload: WorkloadClass;
  timeout?: boolean;
  deadlock?: boolean;
  blocked?: boolean;
}

export interface PerformanceSummary {
  sampleCount: number;
  apiP50Ms: number | null;
  apiP95Ms: number | null;
  sqlP50Ms: number | null;
  sqlP95Ms: number | null;
  cacheHitRatio: number | null;
  timeoutCount: number;
  deadlockCount: number;
  blockingRate: number | null;
  targetStatus: {
    apiP95Under500: boolean | null;
    cacheHitRatioOver80: boolean | null;
    deadlocksZero: boolean | null;
    blockingUnder1Percent: boolean | null;
  };
}

const MAX_SAMPLES = 2_000;
const globalForTelemetry = globalThis as unknown as { __acaciaPerformanceSamples?: PerformanceSample[] };
const samples = globalForTelemetry.__acaciaPerformanceSamples ?? [];
globalForTelemetry.__acaciaPerformanceSamples = samples;

export function recordPerformanceSample(sample: Omit<PerformanceSample, "ts"> & { ts?: number }): void {
  samples.push({ ...sample, ts: sample.ts ?? Date.now() });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] * 10) / 10;
}

export function getPerformanceSummary(windowMs = 15 * 60_000): PerformanceSummary {
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter((sample) => sample.ts >= cutoff);
  const sqlDurations = recent.flatMap((sample) => sample.sqlDurationMs == null ? [] : [sample.sqlDurationMs]);
  const cacheLookups = recent.filter((sample) => sample.cacheStatus && sample.cacheStatus !== "BYPASS");
  const cacheHits = cacheLookups.filter((sample) => sample.cacheStatus === "HIT" || sample.cacheStatus === "COALESCED").length;
  const blockingCount = recent.filter((sample) => sample.blocked).length;
  const cacheHitRatio = cacheLookups.length ? cacheHits / cacheLookups.length : null;
  const blockingRate = recent.length ? blockingCount / recent.length : null;
  const apiP95Ms = percentile(recent.map((sample) => sample.durationMs), 95);
  const deadlockCount = recent.filter((sample) => sample.deadlock).length;

  return {
    sampleCount: recent.length,
    apiP50Ms: percentile(recent.map((sample) => sample.durationMs), 50),
    apiP95Ms,
    sqlP50Ms: percentile(sqlDurations, 50),
    sqlP95Ms: percentile(sqlDurations, 95),
    cacheHitRatio,
    timeoutCount: recent.filter((sample) => sample.timeout).length,
    deadlockCount,
    blockingRate,
    targetStatus: {
      apiP95Under500: apiP95Ms == null ? null : apiP95Ms < 500,
      cacheHitRatioOver80: cacheHitRatio == null ? null : cacheHitRatio > 0.8,
      deadlocksZero: recent.length === 0 ? null : deadlockCount === 0,
      blockingUnder1Percent: blockingRate == null ? null : blockingRate < 0.01,
    },
  };
}

export function getPerformanceSamples(limit = 100): PerformanceSample[] {
  return samples.slice(-Math.max(1, limit)).reverse();
}

export function clearPerformanceSamples(): void {
  samples.splice(0, samples.length);
}
