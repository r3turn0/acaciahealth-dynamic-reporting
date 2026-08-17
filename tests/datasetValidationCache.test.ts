import { describe, expect, it } from "vitest";
import {
  canPublishDataset,
  getDatasetValidationCacheDiagnostics,
  getDatasetValidationSnapshot,
  saveDatasetValidation,
} from "@/lib/validation/datasetValidationRegistry";
import type { DatasetValidation } from "@/lib/validation/datasetValidation";

function validation(datasetId: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): DatasetValidation {
  return {
    validationId: `validation-${datasetId}`,
    datasetId,
    score: 100,
    grade: "A",
    status: "Passed",
    checks: [],
    categoryScores: {} as DatasetValidation["categoryScores"],
    detectedKpis: [],
    missingInputs: [],
    createdDate: new Date().toISOString(),
    expiresAt,
    virtual: true,
    authoritative: false,
  };
}

describe("dataset validation snapshots", () => {
  it("reuses only matching fresh fingerprints", () => {
    saveDatasetValidation({ validation: validation("dataset-cache"), tableCount: 1, relationshipCount: 0, updatedAt: new Date().toISOString(), fingerprint: "fingerprint-a" });
    expect(getDatasetValidationSnapshot("dataset-cache", "fingerprint-a")?.validation.datasetId).toBe("dataset-cache");
    expect(getDatasetValidationSnapshot("dataset-cache", "fingerprint-b")).toBeNull();
  });

  it("rejects expired snapshots and exposes bounded-cache diagnostics", () => {
    saveDatasetValidation({ validation: validation("dataset-expired", new Date(Date.now() - 1_000).toISOString()), tableCount: 1, relationshipCount: 0, updatedAt: new Date().toISOString(), fingerprint: "expired" });
    expect(getDatasetValidationSnapshot("dataset-expired", "expired")).toBeNull();
    const diagnostics = getDatasetValidationCacheDiagnostics();
    expect(diagnostics.entries).toBeLessThanOrEqual(diagnostics.maxEntries);
    expect(diagnostics.hits).toBeGreaterThanOrEqual(1);
    expect(diagnostics.misses).toBeGreaterThanOrEqual(2);
  });

  it("uses governed dataset health when validation is absent or expired", () => {
    expect(canPublishDataset("dataset-without-validation", 82)).toBe(true);
    expect(canPublishDataset("dataset-without-validation", 69)).toBe(false);
    expect(canPublishDataset("dataset-expired", 93)).toBe(true);
  });

  it("honors a fresh failing validation over the displayed health score", () => {
    const failed = { ...validation("dataset-failed"), score: 60, grade: "F" as const, status: "Failed" as const };
    saveDatasetValidation({ validation: failed, tableCount: 1, relationshipCount: 0, updatedAt: new Date().toISOString() });
    expect(canPublishDataset("dataset-failed", 93)).toBe(false);
  });
});
