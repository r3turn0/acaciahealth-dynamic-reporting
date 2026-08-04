import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/services/dashboardSummary";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getDashboardSummary();
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json(
      { error: "Dashboard data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
