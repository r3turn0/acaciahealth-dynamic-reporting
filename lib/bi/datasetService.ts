/**
 * datasetService — persistence for user-defined dataset schemas.
 *
 * In-process store with deterministic ids and schema versioning. Mirrors the
 * pattern used by lib/agents/reportRegistry.ts and is upgradeable to a real DB.
 */

import { createHash } from "crypto";
import type {
  DatasetField,
  DatasetSchema,
  DataRow,
  Relationship,
  SchemaVersion,
} from "./types";

const store = new Map<string, DatasetSchema>();

function newId(name: string): string {
  return createHash("sha256")
    .update(name + Math.random().toString(36) + Date.now())
    .digest("hex")
    .slice(0, 12);
}

// ── Seed a demo dataset so the module is explorable out of the box ────────────

function seed() {
  if (store.size > 0) return;
  const now = new Date().toISOString();
  const regions = ["North", "South", "East", "West"];
  const products = ["Alpha", "Beta", "Gamma"];
  const sampleData: DataRow[] = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.now() - Math.floor(Math.random() * 90) * 86400000);
    sampleData.push({
      date: d.toISOString().slice(0, 10),
      region: regions[i % regions.length],
      product: products[i % products.length],
      revenue: Math.round(2000 + Math.random() * 8000),
      units: Math.round(10 + Math.random() * 90),
      returned: Math.random() > 0.8,
    });
  }
  const fields: DatasetField[] = [
    { name: "date", type: "date" },
    { name: "region", type: "string" },
    { name: "product", type: "string" },
    { name: "revenue", type: "number" },
    { name: "units", type: "number" },
    { name: "returned", type: "boolean" },
  ];
  const id = newId("Sales Dataset");
  store.set(id, {
    id,
    name: "Sales Dataset",
    fields,
    relationships: [],
    sampleData,
    version: 1,
    history: [{ version: 1, fields, relationships: [], savedDate: now, note: "Initial demo schema" }],
    source: "manual",
    createdDate: now,
    updatedDate: now,
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listDatasets(): DatasetSchema[] {
  seed();
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.updatedDate).getTime() - new Date(a.updatedDate).getTime()
  );
}

export function getDataset(id: string): DatasetSchema | null {
  seed();
  return store.get(id) ?? null;
}

export interface CreateDatasetInput {
  name: string;
  fields: DatasetField[];
  relationships?: Relationship[];
  sampleData?: DataRow[];
  source?: DatasetSchema["source"];
}

export function createDataset(input: CreateDatasetInput): DatasetSchema {
  seed();
  const now = new Date().toISOString();
  const id = newId(input.name);
  const fields = input.fields;
  const relationships = input.relationships ?? [];
  const version: SchemaVersion = {
    version: 1,
    fields,
    relationships,
    savedDate: now,
    note: "Initial schema",
  };
  const dataset: DatasetSchema = {
    id,
    name: input.name,
    fields,
    relationships,
    sampleData: input.sampleData ?? [],
    version: 1,
    history: [version],
    source: input.source ?? "manual",
    createdDate: now,
    updatedDate: now,
  };
  store.set(id, dataset);
  return dataset;
}

export interface UpdateDatasetInput {
  name?: string;
  fields?: DatasetField[];
  relationships?: Relationship[];
  sampleData?: DataRow[];
  /** When true, snapshots the previous schema into history (a new version). */
  bumpVersion?: boolean;
  note?: string;
}

export function updateDataset(id: string, patch: UpdateDatasetInput): DatasetSchema | null {
  seed();
  const existing = store.get(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const schemaChanged = patch.fields || patch.relationships;

  let history = existing.history;
  let version = existing.version;

  if (patch.bumpVersion && schemaChanged) {
    version = existing.version + 1;
    history = [
      ...existing.history,
      {
        version,
        fields: patch.fields ?? existing.fields,
        relationships: patch.relationships ?? existing.relationships,
        savedDate: now,
        note: patch.note ?? `Version ${version}`,
      },
    ];
  }

  const updated: DatasetSchema = {
    ...existing,
    name: patch.name ?? existing.name,
    fields: patch.fields ?? existing.fields,
    relationships: patch.relationships ?? existing.relationships,
    sampleData: patch.sampleData ?? existing.sampleData,
    version,
    history,
    updatedDate: now,
  };
  store.set(id, updated);
  return updated;
}

export function deleteDataset(id: string): boolean {
  return store.delete(id);
}
