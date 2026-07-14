/**
 * kpiService — Define, compute, and persist KPI definitions.
 *
 * Separation contract
 * -------------------
 *   ONLY uses AppDataClient (PostgreSQL / in-memory).
 *   NEVER imports ReadOnlyDataClient or touches the analytics data source.
 *
 * Computation runs on a dataset passed in from the caller (already fetched
 * by datasetService).  Results are persisted to the app DB.
 */

import { createHash } from "crypto";
import * as AppDB from "@/lib/db/appClient";
import type { DataRow } from "./datasetService";

// ── Types ─────────────────────────────────────────────────────────────────────

export type KpiAgg = "sum" | "avg" | "min" | "max" | "count" | "rate";
export type KpiStatus = "draft" | "active" | "archived";

export interface KpiDefinition {
  id: string;
  name: string;
  description: string;
  formula: string;           // Human-readable formula / expression label
  column: string | null;     // Source column to aggregate
  agg: KpiAgg;
  target?: number | null;    // Optional benchmark / target value
  unit?: string;             // "%" | "$" | "patients" etc.
  tags: string[];
  status: KpiStatus;
  created_by: string;
  created_date: string;
  updated_date: string;
}

export interface KpiResult {
  id: string;
  kpi_id: string;
  kpi_name: string;
  value: number;
  row_count: number;
  computed_at: string;
  dataset_snapshot_id: string | null;
  meta: Record<string, unknown>;
}

const KPI_TABLE = "kpi_definitions";
const KPI_RESULT_TABLE = "kpi_results";

// In-memory fallback stores (used when Postgres is not configured)
const kpiStore = new Map<string, KpiDefinition>();
const kpiResultStore = new Map<string, KpiResult>();
let _seeded = false;

function seedDefaults() {
  if (_seeded || kpiStore.size > 0) return;
  _seeded = true;
  const now = new Date().toISOString();
  const defaults: Omit<KpiDefinition, "id">[] = [
    {
      name: "Weekly Admissions",
      description: "Total admissions in the reporting period",
      formula: "COUNT(admissions)",
      column: "admissions",
      agg: "sum",
      target: 150,
      unit: "patients",
      tags: ["admissions", "volume"],
      status: "active",
      created_by: "system",
      created_date: now,
      updated_date: now,
    },
    {
      name: "Revenue WTD",
      description: "Week-to-date billed revenue",
      formula: "SUM(revenue)",
      column: "revenue",
      agg: "sum",
      target: 500000,
      unit: "$",
      tags: ["revenue", "finance"],
      status: "active",
      created_by: "system",
      created_date: now,
      updated_date: now,
    },
    {
      name: "Average Census",
      description: "Average daily patient census",
      formula: "AVG(census)",
      column: "census",
      agg: "avg",
      target: 80,
      unit: "patients",
      tags: ["census"],
      status: "active",
      created_by: "system",
      created_date: now,
      updated_date: now,
    },
  ];
  for (const d of defaults) {
    const id = createHash("sha256").update(d.name).digest("hex").slice(0, 12);
    kpiStore.set(id, { id, ...d });
  }
}

// ── CRUD: KPI Definitions ─────────────────────────────────────────────────────

export async function listKpis(): Promise<KpiDefinition[]> {
  seedDefaults();
  try {
    const rows = await AppDB.list<KpiDefinition>(KPI_TABLE, { orderBy: "created_date" });
    if (rows.length > 0) return rows;
  } catch { /* fall through to in-memory */ }
  return Array.from(kpiStore.values()).sort(
    (a, b) => b.created_date.localeCompare(a.created_date)
  );
}

export async function getKpi(id: string): Promise<KpiDefinition | null> {
  seedDefaults();
  try {
    const row = await AppDB.findById<KpiDefinition>(KPI_TABLE, id);
    if (row) return row;
  } catch { /* fall through */ }
  return kpiStore.get(id) ?? null;
}

export interface DefineKpiInput {
  name: string;
  description?: string;
  formula?: string;
  column: string | null;
  agg: KpiAgg;
  target?: number | null;
  unit?: string;
  tags?: string[];
  created_by?: string;
}

export async function defineKpi(input: DefineKpiInput): Promise<KpiDefinition> {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(input.name + now)
    .digest("hex")
    .slice(0, 12);

  const kpi: KpiDefinition = {
    id,
    name: input.name,
    description: input.description ?? "",
    formula: input.formula ?? `${input.agg.toUpperCase()}(${input.column ?? "*"})`,
    column: input.column,
    agg: input.agg,
    target: input.target ?? null,
    unit: input.unit ?? "",
    tags: input.tags ?? [],
    status: "active",
    created_by: input.created_by ?? "analyst",
    created_date: now,
    updated_date: now,
  };

  try {
    await AppDB.insert(KPI_TABLE, kpi as AppDB.AppRecord);
  } catch {
    kpiStore.set(id, kpi);
  }
  kpiStore.set(id, kpi); // always update in-memory mirror
  return kpi;
}

export async function updateKpi(
  id: string,
  patch: Partial<Omit<KpiDefinition, "id" | "created_date" | "created_by">>
): Promise<KpiDefinition | null> {
  const now = new Date().toISOString();
  const withTs = { ...patch, updated_date: now };
  try {
    const row = await AppDB.update<KpiDefinition>(KPI_TABLE, id, withTs as Partial<KpiDefinition>);
    if (row) { kpiStore.set(id, row); return row; }
  } catch { /* fall through */ }
  const existing = kpiStore.get(id);
  if (!existing) return null;
  const merged = { ...existing, ...withTs } as KpiDefinition;
  kpiStore.set(id, merged);
  return merged;
}

export async function deleteKpi(id: string): Promise<boolean> {
  try { await AppDB.remove(KPI_TABLE, id); } catch { /* ignore */ }
  return kpiStore.delete(id);
}

// ── Computation ───────────────────────────────────────────────────────────────

/**
 * Compute a KPI value from a passed-in dataset.
 * The dataset is already fetched by datasetService — no DB reads here.
 */
export function computeKpi(
  kpi: KpiDefinition,
  rows: DataRow[]
): { value: number; rowCount: number } {
  if (!rows.length) return { value: 0, rowCount: 0 };

  if (kpi.agg === "count") return { value: rows.length, rowCount: rows.length };

  const nums = rows
    .map((r) => Number(r[kpi.column ?? ""] ?? 0))
    .filter((n) => !Number.isNaN(n));

  if (!nums.length) return { value: 0, rowCount: rows.length };

  let value: number;
  switch (kpi.agg) {
    case "sum":  value = nums.reduce((a, b) => a + b, 0); break;
    case "avg":  value = nums.reduce((a, b) => a + b, 0) / nums.length; break;
    case "min":  value = Math.min(...nums); break;
    case "max":  value = Math.max(...nums); break;
    case "rate": value = (nums.filter((n) => n > 0).length / nums.length) * 100; break;
    default:     value = 0;
  }

  return { value: Math.round(value * 100) / 100, rowCount: rows.length };
}

// ── Persistence: KPI Results ──────────────────────────────────────────────────

export async function storeKpiResult(
  kpiId: string,
  value: number,
  rowCount: number,
  snapshotId: string | null = null,
  meta: Record<string, unknown> = {}
): Promise<KpiResult> {
  const kpi = await getKpi(kpiId);
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`${kpiId}:${now}`)
    .digest("hex")
    .slice(0, 12);

  const result: KpiResult = {
    id,
    kpi_id: kpiId,
    kpi_name: kpi?.name ?? kpiId,
    value,
    row_count: rowCount,
    computed_at: now,
    dataset_snapshot_id: snapshotId,
    meta,
  };

  try {
    await AppDB.insert(KPI_RESULT_TABLE, result as AppDB.AppRecord);
  } catch { /* fall through */ }
  kpiResultStore.set(id, result);
  return result;
}

export async function getKpiResults(kpiId?: string): Promise<KpiResult[]> {
  try {
    if (kpiId) {
      const rows = await AppDB.list<KpiResult>(KPI_RESULT_TABLE, {
        where: { column: "kpi_id", value: kpiId },
        orderBy: "computed_at",
      });
      if (rows.length > 0) return rows;
    } else {
      const rows = await AppDB.list<KpiResult>(KPI_RESULT_TABLE, { orderBy: "computed_at" });
      if (rows.length > 0) return rows;
    }
  } catch { /* fall through */ }

  const all = Array.from(kpiResultStore.values());
  const filtered = kpiId ? all.filter((r) => r.kpi_id === kpiId) : all;
  return filtered.sort((a, b) => b.computed_at.localeCompare(a.computed_at));
}
