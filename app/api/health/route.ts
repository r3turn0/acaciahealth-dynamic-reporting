export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { checkConnection, isDbConfigured } from "@/lib/services/db";
import { getCacheStats } from "@/lib/services/cache";

export async function GET() {
  const dbConfigured = isDbConfigured();
  // checkConnection is bounded by the driver's connection timeout and shared
  // cooldown. Do not race it with a timer: that leaves an orphaned connection
  // attempt which can emit delayed pool timeout errors after this response.
  const dbConnected = dbConfigured ? await checkConnection() : false;

  const cacheStats = getCacheStats();

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      database: {
        connected: dbConnected,
        configured: dbConfigured,
        mode: dbConnected ? "live_db" : dbConfigured ? "unavailable" : "demo",
      },
      ai: {
        configured: !!(process.env.AI_GATEWAY_API_KEY || process.env.AZURE_OPENAI_API_KEY),
        model: process.env.AZURE_OPENAI_DEPLOYMENT
          ? `azure/${process.env.AZURE_OPENAI_DEPLOYMENT}`
          : "openai/gpt-4o-mini",
      },
      cache: {
        active_entries: cacheStats.size,
      },
    },
    environment: process.env.NODE_ENV,
  });
}
