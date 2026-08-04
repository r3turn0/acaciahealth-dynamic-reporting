import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/services/cache";
import { getPerformanceSamples, getPerformanceSummary } from "@/lib/services/performanceTelemetry";
import { getRecentQueryHistory } from "@/lib/services/queryHistoryStore";
import { summarizeIntelligenceBenchmark } from "@/lib/services/intelligenceBenchmark";
import { getKpiEvidenceTelemetrySummary } from "@/lib/services/kpiEvidenceTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const history = await getRecentQueryHistory(500);
  const grouped = new Map<string, typeof history>();
  for (const entry of history) grouped.set(entry.user_request, [...(grouped.get(entry.user_request) ?? []), entry]);
  const intelligence = summarizeIntelligenceBenchmark([...grouped.values()].map((entries) => {
    const first = entries.at(-1);
    const success = entries.find((entry) => entry.status === "success");
    return {
      baselineValid: first?.status === "success",
      hybridValid: Boolean(success),
      semanticMatch: Boolean(success?.final_success_query),
      reused: entries.length === 1 && Boolean(success),
      retryAttempted: entries.some((entry) => entry.retry_version > 0 || entry.status === "retry"),
      retryRecovered: Boolean(success) && entries.some((entry) => entry.retry_version > 0),
      baselineLatencyMs: first?.execution_ms ?? 0,
      hybridLatencyMs: success?.execution_ms ?? first?.execution_ms ?? 0,
      baselineExecutionMs: first?.execution_ms ?? 0,
      hybridExecutionMs: success?.execution_ms ?? first?.execution_ms ?? 0,
    };
  }));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    windowMinutes: 15,
    performance: getPerformanceSummary(),
    cache: getCacheStats(),
    recentSamples: getPerformanceSamples(20),
    intelligence,
    kpiEvidence: getKpiEvidenceTelemetrySummary(),
    infrastructure: {
      azureSqlCpu: { status: "not_connected", value: null },
      queryStore: { status: "not_connected", enabled: null },
      reportingIsolation: { status: "not_verified", value: null },
      indexMaintenance: { status: "not_connected", value: null },
      criticalTableScans: { status: "not_connected", value: null },
    },
    privacy: {
      phiCached: false,
      policy: "Only approved low-change reference data and non-patient aggregates are eligible.",
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
