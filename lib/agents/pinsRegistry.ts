/**
 * Dashboard Pins Registry
 * Persists items a user has pinned to their dashboard to an in-process store
 * (upgradeable to DB when SQL_CONNECTION_STRING is set). Mirrors the in-memory
 * pattern used by the Report Registry.
 *
 * Two pin kinds are supported:
 *   - "report" — references a saved report (id captured in refId)
 *   - "kpi"    — references a KPI definition (kpi key captured in refId)
 */

import { createHash } from "crypto";

export type PinType = "report" | "kpi";

export interface DashboardPin {
  id: string;
  type: PinType;
  /** Saved-report id or KPI key this pin points at. */
  refId: string;
  title: string;
  subtitle: string;
  /** KPI category used for the badge (e.g. "admissions", "revenue", "custom"). */
  kpi: string;
  /** Extra display payload — sql for reports, aggregation/grouping for KPIs. */
  meta: Record<string, unknown>;
  pinned_by: string;
  pinned_date: string;
}

// ── In-memory store (replace with DB queries when SQL is live) ────────────────

const pinStore = new Map<string, DashboardPin>();

/** Deterministic id so the same ref can't be pinned twice. */
function pinId(type: PinType, refId: string): string {
  return createHash("sha256").update(`${type}:${refId}`).digest("hex").slice(0, 12);
}

// ── CRUD operations ───────────────────────────────────────────────────────────

export function listPins(): DashboardPin[] {
  return Array.from(pinStore.values()).sort(
    (a, b) => new Date(b.pinned_date).getTime() - new Date(a.pinned_date).getTime()
  );
}

export function isPinned(type: PinType, refId: string): boolean {
  return pinStore.has(pinId(type, refId));
}

export function addPin(
  input: Omit<DashboardPin, "id" | "pinned_date">
): DashboardPin {
  const id = pinId(input.type, input.refId);
  const existing = pinStore.get(id);
  if (existing) return existing;

  const pin: DashboardPin = {
    id,
    ...input,
    pinned_date: new Date().toISOString(),
  };
  pinStore.set(id, pin);
  return pin;
}

export function removePin(id: string): boolean {
  return pinStore.delete(id);
}

/** Remove by (type, refId) — used when toggling a pin off from a source view. */
export function removePinByRef(type: PinType, refId: string): boolean {
  return pinStore.delete(pinId(type, refId));
}
