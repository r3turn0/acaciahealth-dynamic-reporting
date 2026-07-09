// ─────────────────────────────────────────────────────────────────────────────
// Safe Query Builder — Access-Proxy Layer (Phase 1)  🚨 SECURITY ENFORCEMENT
//
// Builds a single-table, read-only, PAGINATED SELECT that can ONLY touch the
// tables/columns declared in a Data Contract. Every rule below is enforced:
//
//   • Table must be present in the contract               (no wildcard access)
//   • Only contract-allowed columns are selected          (no SELECT *)
//   • Identifiers are strictly validated + bracket-quoted (no SQL injection)
//   • LIMIT/OFFSET pagination via OFFSET…FETCH (SQL Server)
//   • Row cap enforced (default 100, hard max 500)
//
// Produces the shape expected by the existing db.ts callers:
//   { text: string, values: NamedParam[] }
// ─────────────────────────────────────────────────────────────────────────────

import type { DataContract } from "./contractService";
import { allowedColumnsFor } from "./contractService";
import type { NamedParam } from "@/lib/services/db";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

export interface Pagination {
  page?: number;      // 1-based
  pageSize?: number;
  orderBy?: string;   // must be one of the allowed columns
}

export interface SafeQuery {
  text: string;
  countText: string;
  values: NamedParam[];
  columns: string[];
  page: number;
  pageSize: number;
}

// ── Identifier safety ───────────────────────────────────────────────────────────

// A single identifier part: starts with letter/underscore, then word chars only.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(part: string, kind: string): void {
  if (!IDENT.test(part)) {
    throw new Error(`Invalid ${kind} identifier: "${part}"`);
  }
}

/** Bracket-quote a possibly schema-qualified table id: "Billing.LINE_ITEMS". */
function quoteTable(tableId: string): string {
  const parts = tableId.split(".");
  if (parts.length > 2) throw new Error(`Invalid table identifier: "${tableId}"`);
  for (const p of parts) assertIdent(p, "table");
  return parts.map((p) => `[${p}]`).join(".");
}

/** Bracket-quote a column identifier. */
function quoteColumn(col: string): string {
  assertIdent(col, "column");
  return `[${col}]`;
}

// ── Pagination clamps ─────────────────────────────────────────────────────────────

function clampPage(page?: number): number {
  const p = Number(page);
  return Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
}

function clampPageSize(pageSize?: number): number {
  const s = Number(pageSize);
  if (!Number.isFinite(s) || s <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(s), MAX_PAGE_SIZE);
}

// ── Builder ────────────────────────────────────────────────────────────────────────

/**
 * Build a safe, paginated, contract-scoped query for a single table.
 * Throws "Table not allowed" / "No columns defined" when the contract forbids it.
 */
export function buildSafeQuery(
  contract: DataContract,
  table: string,
  pagination: Pagination = {}
): SafeQuery {
  // 1. Contract enforcement — table must be allowed.
  const allowed = allowedColumnsFor(contract, table);
  if (!allowed) {
    throw new Error("Table not allowed");
  }
  if (allowed.length === 0) {
    throw new Error("No columns defined for table");
  }

  // Resolve the canonical table id from the contract (not the raw user input).
  const lower = table.toLowerCase();
  const contractTable = contract.tables.find(
    (t) => t.name.toLowerCase() === lower || t.name.split(".").pop()!.toLowerCase() === lower
  )!;
  const safeTable = quoteTable(contractTable.name);

  // 2. Column whitelist — validate + quote each allowed column.
  const safeColumns = allowed.map(quoteColumn);

  // 3. ORDER BY — required for OFFSET…FETCH. Must be an allowed column.
  const orderByRaw = pagination.orderBy;
  const orderCol =
    orderByRaw && allowed.some((c) => c.toLowerCase() === orderByRaw.toLowerCase())
      ? orderByRaw
      : allowed[0];
  const safeOrder = quoteColumn(orderCol);

  // 4. Pagination.
  const page = clampPage(pagination.page);
  const pageSize = clampPageSize(pagination.pageSize);
  const offset = (page - 1) * pageSize;

  // OFFSET/FETCH values are BOUND parameters, never interpolated.
  const values: NamedParam[] = [
    { name: "offset", value: offset, type: "int" },
    { name: "pageSize", value: pageSize, type: "int" },
  ];

  const text = `
    SELECT ${safeColumns.join(", ")}
    FROM ${safeTable}
    ORDER BY ${safeOrder}
    OFFSET @offset ROWS
    FETCH NEXT @pageSize ROWS ONLY
  `.trim();

  const countText = `SELECT COUNT(*) AS total FROM ${safeTable}`;

  return { text, countText, values, columns: allowed, page, pageSize };
}
