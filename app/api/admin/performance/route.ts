import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/services/cache";
import { getPerformanceSamples, getPerformanceSummary } from "@/lib/services/performanceTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    windowMinutes: 15,
    performance: getPerformanceSummary(),
    cache: getCacheStats(),
    recentSamples: getPerformanceSamples(20),
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
