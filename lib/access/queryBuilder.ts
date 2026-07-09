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
import { allowedColumnsFor, isJoinAllowed } from "./contractService";
import type { RegistryTable } from "./schemaRegistry";
import type { NamedParam } from "@/lib/services/db";

export const MAX_JOINS = 5;

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

// ── Joined builder ───────────────────────────────────────────────────────────────
//
// Builds a multi-table INNER JOIN, still fully contract-scoped and paginated.
// 🚨 The ON conditions come ONLY from the schema registry (config-controlled)
//    and are never taken from the caller. The client supplies WHICH tables to
//    join; the join predicate is looked up, so no SQL can be injected here.

interface IncludedTable {
  meta: RegistryTable;
  alias: string;
  quoted: string;
  short: string;
  columns: string[];
  onCondition?: string; // set for non-base tables
}

/** Resolve a registry table from the provided metadata map by id or name. */
function resolveMeta(map: Map<string, RegistryTable>, key: string): RegistryTable | null {
  const lower = key.toLowerCase();
  for (const [id, t] of map) {
    if (
      id.toLowerCase() === lower ||
      t.name.toLowerCase() === lower ||
      id.split(".").pop()!.toLowerCase() === lower
    ) {
      return t;
    }
  }
  return null;
}

/** Find the config-defined join predicate between two tables (either direction). */
function relationBetween(a: RegistryTable, b: RegistryTable): string | null {
  const fwd = a.relationships.find((r) => r.toTable.toLowerCase() === b.id.toLowerCase());
  if (fwd) return fwd.condition;
  const rev = b.relationships.find((r) => r.toTable.toLowerCase() === a.id.toLowerCase());
  if (rev) return rev.condition;
  return null;
}

function prepareTable(
  contract: DataContract,
  meta: RegistryTable
): Omit<IncludedTable, "onCondition"> {
  const allowed = allowedColumnsFor(contract, meta.id);
  if (!allowed) throw new Error("Table not allowed");
  if (allowed.length === 0) throw new Error("No columns defined for table");
  if (!meta.alias || !IDENT.test(meta.alias)) {
    throw new Error(`Table "${meta.name}" has no valid alias for joins`);
  }
  // Validate each column identifier up front.
  allowed.forEach((c) => assertIdent(c, "column"));
  return {
    meta,
    alias: meta.alias,
    quoted: quoteTable(meta.id),
    short: meta.name.split(".").pop()!,
    columns: allowed,
  };
}

/**
 * Build a safe, paginated, contract-scoped INNER JOIN across a base table and
 * one or more related tables. Throws with an authorization-style message when
 * any table/join is not permitted by the contract.
 */
export function buildJoinedQuery(
  contract: DataContract,
  baseTableId: string,
  joinTableIds: string[],
  tableMeta: Map<string, RegistryTable>,
  pagination: Pagination = {}
): SafeQuery {
  if (joinTableIds.length === 0) throw new Error("No join tables specified");
  if (joinTableIds.length > MAX_JOINS) throw new Error("Too many joins requested");

  // 1. Base table.
  const baseMeta = resolveMeta(tableMeta, baseTableId);
  if (!baseMeta) throw new Error("Table not allowed");
  const base: IncludedTable = prepareTable(contract, baseMeta);
  const included: IncludedTable[] = [base];

  // 2. Each join table must be in the contract, authorized as a join, and have
  //    a config-defined predicate against an already-included table.
  for (const jid of joinTableIds) {
    const jMeta = resolveMeta(tableMeta, jid);
    if (!jMeta) throw new Error("Join not allowed");
    if (included.some((t) => t.meta.id.toLowerCase() === jMeta.id.toLowerCase())) continue;

    let condition: string | null = null;
    for (const other of included) {
      if (!isJoinAllowed(contract, other.meta.id, jMeta.id)) continue;
      const rel = relationBetween(other.meta, jMeta);
      if (rel) {
        condition = rel;
        break;
      }
    }
    if (!condition) throw new Error("Join not allowed");

    included.push({ ...prepareTable(contract, jMeta), onCondition: condition });
  }

  // 3. SELECT — qualified, aliased, contract-allowed columns only.
  const selectParts: string[] = [];
  const outColumns: string[] = [];
  for (const t of included) {
    for (const col of t.columns) {
      const label = `${t.short}.${col}`;
      selectParts.push(`[${t.alias}].${quoteColumn(col)} AS [${label}]`);
      outColumns.push(label);
    }
  }

  // 4. FROM + INNER JOINs (predicates are config-controlled, see note above).
  const fromClause =
    `${base.quoted} AS [${base.alias}]` +
    included
      .slice(1)
      .map((t) => ` INNER JOIN ${t.quoted} AS [${t.alias}] ON ${t.onCondition}`)
      .join("");

  // 5. ORDER BY base's first allowed column (required for OFFSET…FETCH).
  const orderCandidate = pagination.orderBy;
  const orderCol =
    orderCandidate && base.columns.some((c) => c.toLowerCase() === orderCandidate.toLowerCase())
      ? orderCandidate
      : base.columns[0];
  const safeOrder = `[${base.alias}].${quoteColumn(orderCol)}`;

  // 6. Pagination — bound parameters, never interpolated.
  const page = clampPage(pagination.page);
  const pageSize = clampPageSize(pagination.pageSize);
  const offset = (page - 1) * pageSize;
  const values: NamedParam[] = [
    { name: "offset", value: offset, type: "int" },
    { name: "pageSize", value: pageSize, type: "int" },
  ];

  const text = `
    SELECT ${selectParts.join(", ")}
    FROM ${fromClause}
    ORDER BY ${safeOrder}
    OFFSET @offset ROWS
    FETCH NEXT @pageSize ROWS ONLY
  `.trim();

  const countText = `SELECT COUNT(*) AS total FROM ${fromClause}`;

  return { text, countText, values, columns: outColumns, page, pageSize };
}
