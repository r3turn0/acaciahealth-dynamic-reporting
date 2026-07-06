export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { checkConnection, isDbConfigured } from "@/lib/services/db";
import { getCacheStats } from "@/lib/services/cache";

export async function GET() {
  const dbConfigured = isDbConfigured();
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
        mode: dbConfigured ? "live_db" : "demo",
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
