import type { DatasetValidation } from "@/lib/validation/datasetValidation";

export type DatasetValidationRecord = {
  validation: DatasetValidation;
  tableCount: number;
  relationshipCount: number;
  updatedAt: string;
  fingerprint?: string;
};

export type DatasetValidationCacheDiagnostics = {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
  maxEntries: number;
};

const MAX_VALIDATION_ENTRIES = 100;
let cacheHits = 0;
let cacheMisses = 0;
let cacheEvictions = 0;

const globalRegistry = globalThis as typeof globalThis & {
  __datasetValidationRegistry?: Map<string, DatasetValidationRecord>;
};

const registry = globalRegistry.__datasetValidationRegistry ?? new Map<string, DatasetValidationRecord>();
globalRegistry.__datasetValidationRegistry = registry;

export function saveDatasetValidation(record: DatasetValidationRecord) {
  registry.delete(record.validation.datasetId);
  registry.set(record.validation.datasetId, record);
  while (registry.size > MAX_VALIDATION_ENTRIES) {
    const oldestKey = registry.keys().next().value as string | undefined;
    if (!oldestKey) break;
    registry.delete(oldestKey);
    cacheEvictions += 1;
  }
  return record;
}

export function getDatasetValidation(datasetId: string) {
  return registry.get(datasetId) ?? null;
}

export function getDatasetValidationSnapshot(datasetId: string, fingerprint: string) {
  const record = registry.get(datasetId);
  if (record?.fingerprint === fingerprint && Date.parse(record.validation.expiresAt) > Date.now()) {
    cacheHits += 1;
    return record;
  }
  cacheMisses += 1;
  return null;
}

export function getDatasetValidationCacheDiagnostics(): DatasetValidationCacheDiagnostics {
  return {
    entries: registry.size,
    hits: cacheHits,
    misses: cacheMisses,
    evictions: cacheEvictions,
    maxEntries: MAX_VALIDATION_ENTRIES,
  };
}

export function listDatasetValidations() {
  return [...registry.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function canPublishDataset(datasetId: string) {
  const record = getDatasetValidation(datasetId);
  return Boolean(
    record
      && record.validation.status !== "Failed"
      && record.validation.score >= 70
      && Date.parse(record.validation.expiresAt) > Date.now()
  );
}
