import type { DatasetValidation } from "@/lib/validation/datasetValidation";

export type DatasetValidationRecord = {
  validation: DatasetValidation;
  tableCount: number;
  relationshipCount: number;
  updatedAt: string;
};

const globalRegistry = globalThis as typeof globalThis & {
  __datasetValidationRegistry?: Map<string, DatasetValidationRecord>;
};

const registry = globalRegistry.__datasetValidationRegistry ?? new Map<string, DatasetValidationRecord>();
globalRegistry.__datasetValidationRegistry = registry;

export function saveDatasetValidation(record: DatasetValidationRecord) {
  registry.set(record.validation.datasetId, record);
  return record;
}

export function getDatasetValidation(datasetId: string) {
  return registry.get(datasetId) ?? null;
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
