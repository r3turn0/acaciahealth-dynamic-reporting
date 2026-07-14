/**
 * datasetService — Fetch raw data from the READ-ONLY analytics data source.
 *
 * Separation contract
 * -------------------
 *   ONLY uses ReadOnlyDataClient (MSSQL).
 *   NEVER imports AppDataClient or writes to any database.
 *
 * The service also performs client-side filtering and aggregation on the
 * returned rows so callers can post-process without additional DB round-trips.
 */

import {
  query,
  queryWithParams,
  isConfigured,
  BackendUnreachableError,
} from "@/lib/db/readOnlyClient";
import type { QueryParams, NamedParam } from "@/lib/services/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataRow = Record<string, unknown>;

export interface QueryDefinition {
  sql: string;
  /** Standard date-range params bound as @StartDate / @EndDate. */
  startDate: string;
  endDate: string;
  /** Extra named params (e.g. @BranchCode). */
  params?: NamedParam[];
}

export interface FilterCondition {
  column: string;
  op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "startsWith";
  value: unknown;
}

export interface AggregationConfig {
  groupBy: string[];
  metrics: { column: string; fn: "sum" | "avg" | "min" | "max" | "count" }[];
}

export interface DatasetResult {
  rows: DataRow[];
  columns: string[];
  rowCount: number;
  executionMs: number;
  truncated: boolean;
  demoMode: boolean;
}

const MAX_ROWS = 10_000;

// ── Core: fetch raw data ──────────────────────────────────────────────────────

/**
 * Execute a query definition against the read-only data source.
 * Falls back to demo data when the DB is not configured.
 */
export async function fetchRawData(def: QueryDefinition): Promise<DatasetResult> {
  const start = Date.now();

  if (!isConfigured()) {
    const demoRows = buildDemoRows(def.sql);
    return {
      rows: demoRows,
      columns: demoRows.length > 0 ? Object.keys(demoRows[0]) : [],
      rowCount: demoRows.length,
      executionMs: Date.now() - start,
      truncated: false,
      demoMode: true,
    };
  }

  try {
    let rows: DataRow[];
    if (def.params && def.params.length > 0) {
      rows = await queryWithParams(def.sql, [
        { name: "StartDate", value: def.startDate, type: "date" },
        { name: "EndDate", value: def.endDate, type: "date" },
        ...def.params,
      ]);
    } else {
      rows = await query(def.sql, {
        StartDate: def.startDate,
        EndDate: def.endDate,
      } as QueryParams);
    }

    const truncated = rows.length >= MAX_ROWS;
    return {
      rows: rows.slice(0, MAX_ROWS),
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      executionMs: Date.now() - start,
      truncated,
      demoMode: false,
    };
  } catch (err) {
    if (err instanceof BackendUnreachableError) throw err;
    throw new Error(`datasetService.fetchRawData: ${(err as Error).message}`);
  }
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Apply in-memory filters to an already-fetched result set.
 * Use this for interactive pivoting — avoids round-trips to the DB.
 */
export function applyFilters(rows: DataRow[], filters: FilterCondition[]): DataRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const raw = row[f.column];
      if (raw === undefined || raw === null) return false;
      const str = String(raw).toLowerCase();
      const val = String(f.value).toLowerCase();
      switch (f.op) {
        case "eq":        return str === val;
        case "neq":       return str !== val;
        case "gt":        return Number(raw) > Number(f.value);
        case "lt":        return Number(raw) < Number(f.value);
        case "gte":       return Number(raw) >= Number(f.value);
        case "lte":       return Number(raw) <= Number(f.value);
        case "contains":  return str.includes(val);
        case "startsWith":return str.startsWith(val);
        default:          return true;
      }
    })
  );
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Group rows by `groupBy` columns and compute each metric.
 * Returns a new (smaller) DataRow array ready for charting.
 */
export function aggregateData(rows: DataRow[], config: AggregationConfig): DataRow[] {
  if (config.groupBy.length === 0 && config.metrics.length === 0) return rows;

  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = config.groupBy.map((col) => String(row[col] ?? "")).join("\0");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries()).map(([key, groupRows]) => {
    const parts = key.split("\0");
    const result: DataRow = {};
    config.groupBy.forEach((col, i) => { result[col] = parts[i]; });
    for (const m of config.metrics) {
      const nums = groupRows
        .map((r) => Number(r[m.column]))
        .filter((n) => !Number.isNaN(n));
      switch (m.fn) {
        case "sum":   result[`${m.fn}_${m.column}`] = nums.reduce((a, b) => a + b, 0); break;
        case "avg":   result[`${m.fn}_${m.column}`] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; break;
        case "min":   result[`${m.fn}_${m.column}`] = nums.length ? Math.min(...nums) : 0; break;
        case "max":   result[`${m.fn}_${m.column}`] = nums.length ? Math.max(...nums) : 0; break;
        case "count": result[`count_${m.column}`] = groupRows.length; break;
      }
    }
    return result;
  });
}

// ── Export helpers ─────────────────────────────────────────────────────────────

/** Serialize a row array to CSV with headers. */
export function toCSV(rows: DataRow[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = cols.map(escape).join(",");
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** Serialize a row array to pretty-printed JSON. */
export function toJSON(rows: DataRow[]): string {
  return JSON.stringify(rows, null, 2);
}

// ── Demo data builder ─────────────────────────────────────────────────────────

function buildDemoRows(sql: string): DataRow[] {
  const lower = sql.toLowerCase();
  const branches = ["Hospice OC", "Home Health LA", "Hospice GI", "Hospice IRC", "Palliative"];
  const careTypes = ["Routine Home Care", "Continuous Home Care", "Inpatient Respite", "General Inpatient"];

  if (lower.includes("revenue") || lower.includes("li_amount")) {
    return branches.flatMap((branch) =>
      Array.from({ length: 4 }, (_, w) => ({
        branch_name: branch,
        week_number: w + 1,
        revenue: Math.round(40000 + Math.random() * 80000),
      }))
    );
  }
  if (lower.includes("care_type") || lower.includes("ct_name")) {
    return careTypes.map((ct) => ({
      care_type: ct,
      census: Math.round(20 + Math.random() * 120),
    }));
  }
  // Default: admissions by branch / week
  return branches.flatMap((branch) =>
    Array.from({ length: 4 }, (_, w) => ({
      branch_name: branch,
      week_number: w + 1,
      admissions: Math.round(5 + Math.random() * 35),
    }))
  );
}
