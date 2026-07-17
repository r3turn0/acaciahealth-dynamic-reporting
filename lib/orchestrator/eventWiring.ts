/**
 * lib/orchestrator/eventWiring.ts
 *
 * Connects EventBus events to agent reactions.
 * Import this file once at startup (e.g. in the main API route or layout) to
 * activate the reactive pipeline:
 *
 *   SCHEMA_UPDATED → VectorEmbeddingAgent (re-index from public/metadata.json)
 *   EMBEDDINGS_INDEXED → console trace
 *   QUERY_FAILED → console trace (future: trigger self-healer)
 *
 * This module is idempotent — the guard prevents double-binding across
 * HMR reloads in development.
 */

import { eventBus } from "./EventBus";

const _global = globalThis as typeof globalThis & { __eventWiringDone?: boolean };
if (!_global.__eventWiringDone) {
  _global.__eventWiringDone = true;

  // SCHEMA_UPDATED → re-seed vector corpus from the now-normalised metadata
  eventBus.on("SCHEMA_UPDATED", async (payload) => {
    console.log(
      `[EventBus] SCHEMA_UPDATED — ${payload.tables.length} tables, ` +
      `${payload.columnCount} columns, source: ${payload.source}`
    );
    try {
      // Dynamic import to avoid circular deps at module load time
      const { seedSchemaCorpus } = await import("@/lib/ai/vectorSearch");
      const result = await seedSchemaCorpus();
      if (result.inserted > 0) {
        console.log(`[EventBus] Seeded ${result.inserted} vector documents from updated schema.`);
      }
    } catch (err) {
      console.warn("[EventBus] SCHEMA_UPDATED → seedSchemaCorpus failed (non-fatal):", err);
    }
  });

  eventBus.on("EMBEDDINGS_INDEXED", (payload) => {
    console.log(
      `[EventBus] EMBEDDINGS_INDEXED — corpus: ${payload.corpus}, ` +
      `${payload.docCount} docs at ${payload.timestamp}`
    );
  });

  eventBus.on("DATASET_CREATED", (payload) => {
    console.log(
      `[EventBus] DATASET_CREATED — id: ${payload.datasetId}, ` +
      `tables: ${payload.tables.join(", ")}`
    );
  });

  eventBus.on("QUERY_FAILED", (payload) => {
    console.warn(
      `[EventBus] QUERY_FAILED — error: ${payload.error.slice(0, 120)}`
    );
  });

  eventBus.on("QUERY_EXECUTED", (payload) => {
    console.log(
      `[EventBus] QUERY_EXECUTED — ${payload.rowCount} rows in ${payload.durationMs}ms`
    );
  });
}
