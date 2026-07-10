"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared dashboard-pins store. Backed by the /api/pins endpoints but mirrored
 * into a tiny external store so every view (Dashboard, Saved Reports, KPI
 * Explorer) reflects pin/unpin actions instantly and stays in sync without
 * prop drilling or refetch races.
 */

export type PinType = "report" | "kpi";

export interface DashboardPin {
  id: string;
  type: PinType;
  refId: string;
  title: string;
  subtitle: string;
  kpi: string;
  meta: Record<string, unknown>;
  pinned_by: string;
  pinned_date: string;
}

export interface PinInput {
  type: PinType;
  refId: string;
  title: string;
  subtitle?: string;
  kpi?: string;
  meta?: Record<string, unknown>;
}

let pins: DashboardPin[] = [];
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Lazily hydrate from the server the first time anything subscribes.
  if (!loaded && !loading) void refreshPins();
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return pins;
}

/** Re-fetch pins from the server and broadcast to subscribers. */
export async function refreshPins(): Promise<void> {
  loading = true;
  try {
    const res = await fetch("/api/pins");
    const json = await res.json();
    pins = Array.isArray(json.pins) ? json.pins : [];
    loaded = true;
    emit();
  } catch {
    // Leave existing snapshot in place on failure.
  } finally {
    loading = false;
  }
}

function keyOf(type: PinType, refId: string) {
  return `${type}:${refId.toLowerCase()}`;
}

/** Whether a given item is currently pinned. */
export function isPinned(type: PinType, refId: string): boolean {
  return pins.some((p) => keyOf(p.type, p.refId) === keyOf(type, refId));
}

/** Pin an item (optimistic). No-op if already pinned. */
export async function pinItem(input: PinInput): Promise<void> {
  if (isPinned(input.type, input.refId)) return;

  // Optimistic insert with a temporary id.
  const optimistic: DashboardPin = {
    id: `tmp-${keyOf(input.type, input.refId)}`,
    type: input.type,
    refId: input.refId,
    title: input.title,
    subtitle: input.subtitle ?? "",
    kpi: input.kpi ?? "custom",
    meta: input.meta ?? {},
    pinned_by: "analyst",
    pinned_date: new Date().toISOString(),
  };
  pins = [optimistic, ...pins];
  emit();

  try {
    const res = await fetch("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const saved: DashboardPin = await res.json();
      // Replace the optimistic entry with the server record.
      pins = [saved, ...pins.filter((p) => p.id !== optimistic.id)];
      emit();
    } else {
      // Roll back.
      pins = pins.filter((p) => p.id !== optimistic.id);
      emit();
    }
  } catch {
    pins = pins.filter((p) => p.id !== optimistic.id);
    emit();
  }
}

/** Remove a pin by its id (optimistic). */
export async function unpinItem(id: string): Promise<void> {
  const prev = pins;
  pins = pins.filter((p) => p.id !== id);
  emit();
  try {
    const res = await fetch(`/api/pins/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      pins = prev;
      emit();
    }
  } catch {
    pins = prev;
    emit();
  }
}

/** Toggle a pin off by (type, refId) — convenience for source views. */
export async function unpinByRef(type: PinType, refId: string): Promise<void> {
  const match = pins.find((p) => keyOf(p.type, p.refId) === keyOf(type, refId));
  if (match) await unpinItem(match.id);
}

/** React hook returning the current pins snapshot. */
export function useDashboardPins(): DashboardPin[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => pins);
}
