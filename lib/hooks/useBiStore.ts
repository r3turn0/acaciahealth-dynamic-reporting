"use client";

import { useSyncExternalStore } from "react";
import type {
  DataRow,
  DatasetField,
  DatasetSchema,
  KpiReport,
  Relationship,
} from "@/lib/bi/types";

/**
 * Shared BI Studio store. Bridges the /api/bi endpoints into a tiny external
 * store so the Dataset Builder, KPI Explorer canvas, and Report manager all
 * stay in sync (created datasets appear instantly, saved reports refresh, the
 * "Open in KPI Explorer" handoff carries the active dataset across tabs).
 */

interface BiState {
  datasets: DatasetSchema[];
  reports: KpiReport[];
  loaded: boolean;
}

let state: BiState = { datasets: [], reports: [], loaded: false };
let hydrating = false;
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!state.loaded && !hydrating) void hydrate();
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

async function hydrate() {
  hydrating = true;
  try {
    const [d, r] = await Promise.all([
      fetch("/api/bi/datasets").then((res) => res.json()),
      fetch("/api/bi/reports").then((res) => res.json()),
    ]);
    state.datasets = Array.isArray(d.datasets) ? d.datasets : [];
    state.reports = Array.isArray(r.reports) ? r.reports : [];
    state.loaded = true;
    emit();
  } catch {
    state.loaded = true;
    emit();
  } finally {
    hydrating = false;
  }
}

export async function refreshDatasets() {
  const d = await fetch("/api/bi/datasets").then((res) => res.json());
  state.datasets = Array.isArray(d.datasets) ? d.datasets : [];
  emit();
}

export async function refreshReports() {
  const r = await fetch("/api/bi/reports").then((res) => res.json());
  state.reports = Array.isArray(r.reports) ? r.reports : [];
  emit();
}

// ── Dataset mutations ──────────────────────────────────────────────────────────

export interface NewDataset {
  name: string;
  fields: DatasetField[];
  relationships?: Relationship[];
  sampleData?: DataRow[];
  source?: DatasetSchema["source"];
}

export async function createDataset(input: NewDataset): Promise<DatasetSchema | null> {
  const res = await fetch("/api/bi/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const dataset: DatasetSchema = await res.json();
  state.datasets = [dataset, ...state.datasets];
  emit();
  return dataset;
}

export async function updateDataset(
  id: string,
  patch: Partial<NewDataset> & { bumpVersion?: boolean; note?: string }
): Promise<DatasetSchema | null> {
  const res = await fetch(`/api/bi/datasets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const updated: DatasetSchema = await res.json();
  state.datasets = state.datasets.map((d) => (d.id === id ? updated : d));
  emit();
  return updated;
}

export async function deleteDataset(id: string): Promise<void> {
  const prev = state.datasets;
  state.datasets = state.datasets.filter((d) => d.id !== id);
  // Reports bound to this dataset are orphaned; drop them from the local view.
  state.reports = state.reports.filter((r) => r.datasetId !== id);
  emit();
  const res = await fetch(`/api/bi/datasets/${id}`, { method: "DELETE" });
  if (!res.ok) {
    state.datasets = prev;
    emit();
  }
}

// ── Report mutations ────────────────────────────────────────────────────────────

export interface NewReport {
  name: string;
  datasetId: string;
  metrics: KpiReport["metrics"];
  dimensions: string[];
  filters: KpiReport["filters"];
  chart: KpiReport["chart"];
}

export async function createReport(input: NewReport): Promise<KpiReport | null> {
  const res = await fetch("/api/bi/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const report: KpiReport = await res.json();
  state.reports = [report, ...state.reports];
  emit();
  return report;
}

export async function updateReport(
  id: string,
  patch: Partial<NewReport>
): Promise<KpiReport | null> {
  const res = await fetch(`/api/bi/reports/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const updated: KpiReport = await res.json();
  state.reports = state.reports.map((r) => (r.id === id ? updated : r));
  emit();
  return updated;
}

export async function duplicateReport(id: string): Promise<KpiReport | null> {
  const res = await fetch(`/api/bi/reports/${id}?duplicate`, { method: "POST" });
  if (!res.ok) return null;
  const copy: KpiReport = await res.json();
  state.reports = [copy, ...state.reports];
  emit();
  return copy;
}

export async function deleteReport(id: string): Promise<void> {
  const prev = state.reports;
  state.reports = state.reports.filter((r) => r.id !== id);
  emit();
  const res = await fetch(`/api/bi/reports/${id}`, { method: "DELETE" });
  if (!res.ok) {
    state.reports = prev;
    emit();
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useBiStore(): BiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
