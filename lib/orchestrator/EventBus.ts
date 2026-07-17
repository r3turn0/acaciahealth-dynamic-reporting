/**
 * lib/orchestrator/EventBus.ts
 *
 * Typed in-process event bus for inter-agent communication.
 * Events are fired synchronously in the same Node.js process.
 *
 * System events:
 *   SCHEMA_UPDATED       — metadata.json was parsed and normalised
 *   DATASET_CREATED      — a new dataset was built and assigned a UUID
 *   DATASET_UPDATED      — an existing dataset was modified
 *   KPI_REQUESTED        — a user triggered a KPI computation
 *   QUERY_EXECUTED       — a SQL query ran successfully
 *   QUERY_FAILED         — a SQL query failed (triggers healer)
 *   EMBEDDINGS_INDEXED   — VectorEmbeddingAgent finished indexing a corpus
 */

import EventEmitter from "events";

// ── Event payloads ────────────────────────────────────────────────────────────

export interface SchemaUpdatedPayload {
  tables:        string[];
  columnCount:   number;
  relationships: number;
  source:        "upload" | "live_db";
  timestamp:     string;
}

export interface DatasetCreatedPayload {
  datasetId:   string;
  tables:      string[];
  joinCount:   number;
  ttlMinutes:  number;
  timestamp:   string;
}

export interface DatasetUpdatedPayload {
  datasetId: string;
  changes:   string[];
  timestamp: string;
}

export interface KpiRequestedPayload {
  datasetId: string;
  kpiName:   string;
  userQuery: string;
  timestamp: string;
}

export interface QueryExecutedPayload {
  sql:       string;
  rowCount:  number;
  durationMs: number;
  timestamp: string;
}

export interface QueryFailedPayload {
  sql:       string;
  error:     string;
  userQuery: string;
  timestamp: string;
}

export interface EmbeddingsIndexedPayload {
  corpus:    string;
  docCount:  number;
  timestamp: string;
}

export type SystemEventName =
  | "SCHEMA_UPDATED"
  | "DATASET_CREATED"
  | "DATASET_UPDATED"
  | "KPI_REQUESTED"
  | "QUERY_EXECUTED"
  | "QUERY_FAILED"
  | "EMBEDDINGS_INDEXED";

export type SystemEventPayload<T extends SystemEventName> =
  T extends "SCHEMA_UPDATED"     ? SchemaUpdatedPayload    :
  T extends "DATASET_CREATED"    ? DatasetCreatedPayload   :
  T extends "DATASET_UPDATED"    ? DatasetUpdatedPayload   :
  T extends "KPI_REQUESTED"      ? KpiRequestedPayload     :
  T extends "QUERY_EXECUTED"     ? QueryExecutedPayload    :
  T extends "QUERY_FAILED"       ? QueryFailedPayload      :
  T extends "EMBEDDINGS_INDEXED" ? EmbeddingsIndexedPayload:
  never;

// ── Typed event emitter ───────────────────────────────────────────────────────

class AcaciaEventBus extends EventEmitter {
  emit<T extends SystemEventName>(
    event: T,
    payload: SystemEventPayload<T>
  ): boolean {
    return super.emit(event, payload);
  }

  on<T extends SystemEventName>(
    event: T,
    listener: (payload: SystemEventPayload<T>) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<T extends SystemEventName>(
    event: T,
    listener: (payload: SystemEventPayload<T>) => void
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}

// Singleton — one bus per Node.js process
const _global = globalThis as typeof globalThis & { __acaciaEventBus?: AcaciaEventBus };
if (!_global.__acaciaEventBus) {
  _global.__acaciaEventBus = new AcaciaEventBus();
  _global.__acaciaEventBus.setMaxListeners(50);
}

export const eventBus: AcaciaEventBus = _global.__acaciaEventBus;
