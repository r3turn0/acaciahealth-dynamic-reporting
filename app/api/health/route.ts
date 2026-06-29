import { NextResponse } from "next/server";
import { checkConnection } from "@/lib/services/db";
import { getCacheStats } from "@/lib/services/cache";

export async function GET() {
  const dbConnected = process.env.SQL_CONNECTION_STRING
    ? await checkConnection()
    : false;

  const cacheStats = getCacheStats();

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      database: {
        connected: dbConnected,
        configured: !!process.env.SQL_CONNECTION_STRING,
        mode: process.env.SQL_CONNECTION_STRING ? "live_db" : "demo",
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
