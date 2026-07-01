/**
 * GET /api/protected/reports
 * Protected API route — validates JWT via getToken(), then queries SQL Server.
 * Returns the latest 50 reports ordered by CreatedAt DESC.
 * Unauthorized requests receive 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { executeRawQuery } from "@/lib/services/db";
import { buildCacheKey, getCache, setCache } from "@/lib/services/cache";

const DEMO_REPORTS = Array.from({ length: 20 }, (_, i) => ({
  ReportId: i + 1,
  ReportName: `${["Admissions", "Revenue", "Hospice Census", "LUPA Rate", "Discharge"][i % 5]} Report ${Math.floor(i / 5) + 1}`,
  Branch: ["Hospice OC", "Home Health", "Hospice GI", "Hospice IRC", "Palliative Care"][i % 5],
  CreatedBy: ["analyst@acaciahealth.org", "admin@acaciahealth.org"][i % 2],
  CreatedAt: new Date(Date.now() - i * 3 * 86400000).toISOString(),
  RowCount: Math.floor(50 + Math.random() * 500),
  Status: i % 7 === 0 ? "Error" : "Success",
}));

export async function GET(req: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Cache ───────────────────────────────────────────────────────────────
  const cacheKey = buildCacheKey("protected:reports", { sub: token.sub ?? "anon" });
  const cached = getCache<typeof DEMO_REPORTS>(cacheKey);
  if (cached) {
    return NextResponse.json({ data: cached, cache_hit: true, user: token.email });
  }

  // ── Demo mode (no DB configured) ────────────────────────────────────────
  if (!process.env.DB_HOST && !process.env.SQL_CONNECTION_STRING) {
    return NextResponse.json({
      data: DEMO_REPORTS,
      cache_hit: false,
      demo_mode: true,
      user: token.email,
    });
  }

  // ── Live SQL query ───────────────────────────────────────────────────────
  try {
    const rows = await executeRawQuery(
      "SELECT TOP 50 * FROM Reports ORDER BY CreatedAt DESC"
    );
    setCache(cacheKey, rows, 60_000); // 60 s cache
    return NextResponse.json({ data: rows, cache_hit: false, user: token.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
