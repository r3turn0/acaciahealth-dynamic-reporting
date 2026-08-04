/**
 * GET /api/query-history
 * Returns paginated query history with optional filters.
 *
 * Query params:
 *   limit      — max entries to return (default 50, max 200)
 *   offset     — pagination offset (default 0)
 *   status     — filter by status: success | failure | retry | aborted
 *   search     — filter by user_request substring (case-insensitive)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getQueryHistory,
  getQueryHistoryStats,
} from "@/lib/services/queryHistoryStore";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(parseInt(searchParams.get("limit")  ?? "50", 10), 200);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0",  10), 0);
    const status = searchParams.get("status")  as "success" | "failure" | "retry" | "aborted" | null;
    const search = searchParams.get("search") ?? undefined;

    const [entries, stats] = await Promise.all([
      getQueryHistory({ limit, offset, status: status ?? undefined, search }),
      getQueryHistoryStats(),
    ]);

    return NextResponse.json({
      entries,
      total: entries.length,
      limit,
      offset,
      stats,
    });
  } catch (err) {
    console.error("[query-history API]", err);
    return NextResponse.json(
      { error: "Failed to fetch query history" },
      { status: 500 }
    );
  }
}
