import { NextResponse } from "next/server";
import { correlateAlerts, evaluateSystemMetrics } from "@/lib/intelligence/correlation";
import { intelligenceStore } from "@/lib/intelligence/store";

export async function GET() {
  const snapshot = intelligenceStore.snapshot();
  evaluateSystemMetrics(snapshot.database);
  return NextResponse.json({ ...snapshot, alerts: correlateAlerts(intelligenceStore.snapshot().alerts) });
}
