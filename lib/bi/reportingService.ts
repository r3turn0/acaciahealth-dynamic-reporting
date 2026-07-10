/**
 * reportingService — persistence for saved KPI report configurations.
 *
 * In-process store mirroring datasetService. Each report is a JSON config
 * (metrics + dimensions + filters + chart) bound to a dataset id.
 */

import { createHash } from "crypto";
import type { KpiReport } from "./types";

const store = new Map<string, KpiReport>();

function newId(name: string): string {
  return createHash("sha256")
    .update(name + Math.random().toString(36) + Date.now())
    .digest("hex")
    .slice(0, 12);
}

export function listReports(datasetId?: string): KpiReport[] {
  const all = Array.from(store.values()).sort(
    (a, b) => new Date(b.updatedDate).getTime() - new Date(a.updatedDate).getTime()
  );
  return datasetId ? all.filter((r) => r.datasetId === datasetId) : all;
}

export function getReport(id: string): KpiReport | null {
  return store.get(id) ?? null;
}

export type CreateReportInput = Omit<
  KpiReport,
  "id" | "createdDate" | "updatedDate" | "createdBy"
> & { createdBy?: string };

export function createReport(input: CreateReportInput): KpiReport {
  const now = new Date().toISOString();
  const id = newId(input.name);
  const report: KpiReport = {
    id,
    name: input.name,
    datasetId: input.datasetId,
    metrics: input.metrics,
    dimensions: input.dimensions,
    filters: input.filters,
    chart: input.chart,
    createdBy: input.createdBy ?? "analyst",
    createdDate: now,
    updatedDate: now,
  };
  store.set(id, report);
  return report;
}

export function updateReport(
  id: string,
  patch: Partial<Omit<KpiReport, "id" | "createdDate" | "createdBy">>
): KpiReport | null {
  const existing = store.get(id);
  if (!existing) return null;
  const updated: KpiReport = {
    ...existing,
    ...patch,
    id: existing.id,
    createdDate: existing.createdDate,
    createdBy: existing.createdBy,
    updatedDate: new Date().toISOString(),
  };
  store.set(id, updated);
  return updated;
}

export function duplicateReport(id: string): KpiReport | null {
  const existing = store.get(id);
  if (!existing) return null;
  return createReport({
    name: `${existing.name} (copy)`,
    datasetId: existing.datasetId,
    metrics: existing.metrics,
    dimensions: existing.dimensions,
    filters: existing.filters,
    chart: existing.chart,
    createdBy: existing.createdBy,
  });
}

export function deleteReport(id: string): boolean {
  return store.delete(id);
}
