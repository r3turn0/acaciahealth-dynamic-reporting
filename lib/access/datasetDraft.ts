"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared, in-memory "dataset draft" — the tables a user has staged from the
 * Discover Data tab before finalizing them in Build Dataset. Kept in a tiny
 * external store (not React state) so the selection survives navigation
 * between the Discover and Build views without prop drilling.
 *
 * Values are table identifiers as the user encounters them (short names such
 * as "CLIENT_EPISODES_ALL"). The Build Dataset workspace resolves these
 * against the schema registry by short-name match.
 */

let staged: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return staged;
}

/** Add a table to the draft (no-op if already staged). Returns true if added. */
export function addTableToDraft(name: string): boolean {
  const key = name.trim();
  if (!key) return false;
  if (staged.some((t) => t.toLowerCase() === key.toLowerCase())) return false;
  staged = [...staged, key];
  emit();
  return true;
}

/** Remove a table from the draft. */
export function removeTableFromDraft(name: string) {
  const next = staged.filter((t) => t.toLowerCase() !== name.toLowerCase());
  if (next.length !== staged.length) {
    staged = next;
    emit();
  }
}

/** Whether a table is currently staged in the draft. */
export function isTableStaged(name: string): boolean {
  return staged.some((t) => t.toLowerCase() === name.toLowerCase());
}

/** Clear the entire draft. */
export function clearDatasetDraft() {
  if (staged.length) {
    staged = [];
    emit();
  }
}

/** React hook returning the current list of staged table names. */
export function useDatasetDraft(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
