import { NextRequest, NextResponse } from "next/server";
import { correlateAlerts } from "@/lib/intelligence/correlation";
import { intelligenceStore } from "@/lib/intelligence/store";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const severity = request.nextUrl.searchParams.get("severity");
  const status = request.nextUrl.searchParams.get("status");
  const query = request.nextUrl.searchParams.get("q")?.toLowerCase();
  let alerts = correlateAlerts(intelligenceStore.snapshot().alerts);
  if (category) alerts = alerts.filter((alert) => alert.category === category);
  if (severity) alerts = alerts.filter((alert) => alert.severity === severity);
  if (status) alerts = alerts.filter((alert) => alert.status === status);
  if (query) alerts = alerts.filter((alert) => `${alert.title} ${alert.description} ${alert.entityName}`.toLowerCase().includes(query));
  return NextResponse.json({ alerts, total: alerts.length });
}
