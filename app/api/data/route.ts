export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// Access Proxy API  🚨 SECURITY ENFORCEMENT LAYER
//
//   Frontend → [/api/data] → Data Contract check → Safe Query Builder → Read-Only DB
//
//   GET /api/data?appId=acacia-app-1&table=patients&page=1&pageSize=100
//
// The frontend NEVER talks to the database. This route:
//   1. Loads the app's data contract (403 if none)
//   2. Builds a contract-scoped, paginated, single-table SELECT
//   3. Executes it read-only against the DB (or returns deterministic demo data)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getContract } from "@/lib/access/contractService";
import { buildSafeQuery, DEFAULT_PAGE_SIZE } from "@/lib/access/queryBuilder";
import {
  executeQueryWithParams,
  executeRawQuery,
  isDbConfigured,
  BackendUnreachableError,
} from "@/lib/services/db";
import type { SafeQuery } from "@/lib/access/queryBuilder";

// Deterministic pseudo-random for stable demo data.
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function demoValue(column: string, rng: () => number, rowIx: number): unknown {
  const c = column.toLowerCase();
  if (c.endsWith("id") || c === "id") return rowIx;
  if (c.includes("amount") || c.includes("total") || c.includes("revenue"))
    return Math.round(rng() * 500000) / 100;
  if (c.includes("date") || c.includes("_at")) {
    const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(rng() * 3.15e10));
    return d.toISOString().slice(0, 10);
  }
  if (c.includes("count") || c.includes("qty") || c.includes("number"))
    return Math.floor(rng() * 900) + 1;
  if (c.includes("name")) return `Sample ${Math.floor(rng() * 900) + 100}`;
  if (c.includes("status")) return ["Active", "Pending", "Closed"][Math.floor(rng() * 3)];
  return `val_${Math.floor(rng() * 9000) + 1000}`;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const appId = params.get("appId");
  const table = params.get("table");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const orderBy = params.get("orderBy") ?? undefined;

  if (!appId || !table) {
    return NextResponse.json({ error: "Missing appId or table" }, { status: 400 });
  }

  // 1. Contract enforcement.
  const contract = getContract(appId);
  if (!contract) {
    return NextResponse.json({ error: "No contract found for this app" }, { status: 403 });
  }

  // 2. Build the safe, paginated query (throws if table/columns not allowed).
  let safe;
  try {
    safe = buildSafeQuery(contract, table, { page, pageSize, orderBy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query build failed";
    // "Table not allowed" is an authorization failure → 403.
    const status = message === "Table not allowed" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const canonicalTable =
    contract.tables.find((t) => t.name.toLowerCase() === table.toLowerCase())?.name ?? table;

  // 3a. Demo mode — deterministic synthetic rows scoped to allowed columns.
  if (!isDbConfigured()) {
    return NextResponse.json(buildDemoPage(table, canonicalTable, safe));
  }

  // 3b. Live read-only execution.
  try {
    const [rows, countRows] = await Promise.all([
      executeQueryWithParams(safe.text, safe.values),
      executeRawQuery(safe.countText),
    ]);
    const total = Number((countRows[0] as { total?: number })?.total ?? rows.length);
    return NextResponse.json({
      table: canonicalTable,
      columns: safe.columns,
      rows,
      page: safe.page,
      pageSize: safe.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safe.pageSize)),
      source: "live_db",
    });
  } catch (err) {
    // Configured but unreachable (tunnel down / private host) → serve demo data
    // so the contract preview stays functional instead of hard-failing.
    if (err instanceof BackendUnreachableError) {
      console.warn("[access] /api/data backend unreachable, serving demo data:", err.message);
      return NextResponse.json(buildDemoPage(table, canonicalTable, safe));
    }
    console.error("[access] /api/data query error:", err);
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}

// Deterministic synthetic page for demo / unreachable-DB scenarios.
function buildDemoPage(table: string, canonicalTable: string, safe: SafeQuery) {
  const total = 100 + (table.length * 37) % 400;
  const rng = seeded(table.length * 1000 + safe.page);
  const start = (safe.page - 1) * safe.pageSize;
  const count = Math.max(0, Math.min(safe.pageSize, total - start));
  const rows = Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = {};
    for (const col of safe.columns) row[col] = demoValue(col, rng, start + i + 1);
    return row;
  });
  return {
    table: canonicalTable,
    columns: safe.columns,
    rows,
    page: safe.page,
    pageSize: safe.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safe.pageSize)),
    source: "demo" as const,
  };
}
