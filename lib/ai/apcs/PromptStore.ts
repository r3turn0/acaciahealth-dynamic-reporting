/**
 * lib/ai/apcs/PromptStore.ts
 *
 * Advanced Prompt Compaction System — Storage Engine (Layers 6–10)
 *
 * Layer 6  — History Summarization    (conversation history → learned facts)
 * Layer 7  — RAG Reference Model      (large blocks stored externally, referenced by ID)
 * Layer 8  — Schema Hashing           (schema fingerprint → cache key, diff-only updates)
 * Layer 9  — Query Failure Memory     (QSIG references replace full SQL retry chains)
 * Layer 10 — Compact Execution Format (intent AST → minimal string)
 *
 * Storage: in-process Map with optional Postgres persistence via AppDataClient.
 * All stores are server-side only.
 */

import * as appClient from "@/lib/db/appClient";
import { estimateTokens } from "./PromptCompactor";
import type { PromptAst } from "./PromptCompactor";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Layer 6 — Learned fact derived from conversation / retry history */
export interface LearnedFact {
  id: string;
  created_at: string;
  fact_type: "table_mapping" | "column_mapping" | "kpi_mapping" | "failure_fix" | "user_preference";
  /** Human term the user used */
  user_term: string;
  /** Actual database object / correct term */
  resolved_to: string;
  /** Context (optional: branch, service line, date range) */
  context: string | null;
  confidence: number;
  hit_count: number;
}

/** Layer 7 — RAG document (large block stored externally) */
export interface RagDocument {
  id: string;          // e.g. "RAG_DOC_001"
  tag: string;         // e.g. "schema", "kpi_definitions", "semantic_layer"
  content: string;
  tokens: number;
  schema_hash: string; // tied to schema version for invalidation
  created_at: string;
  last_used: string;
}

/** Layer 8 — Schema version record */
export interface SchemaVersion {
  hash: string;
  fingerprint: string; // sorted table list
  table_count: number;
  column_count: number;
  created_at: string;
  last_seen: string;
}

/** Layer 9 — Query failure memory record */
export interface QueryFailureMemory {
  qsig: string;         // e.g. "QSIG_1024"
  query_signature: string; // normalized SQL hash or user request hash
  failure_reason: string;
  fix_strategy: string;
  successful_retry: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

/** Layer 10 — Compact execution format */
export interface CompactExecutionIntent {
  task: "db_query" | "kpi_analysis" | "correction" | "explanation";
  inferSchema: boolean;
  metadata: boolean;
  retries: boolean;
  historicalLearning: boolean;
  schemaHash: string | null;
  qsig: string | null;        // reference to failure memory if this is a retry
  ragRefs: string[];           // e.g. ["RAG_DOC_001", "RAG_DOC_002"]
  learnedFacts: string[];      // fact IDs to inject
}

/** Full metrics for a compaction session */
export interface CompactionMetrics {
  session_id: string;
  timestamp: string;
  original_tokens: number;
  compacted_tokens: number;
  reduction_pct: number;
  layers_applied: string[];
  schema_cache_hit: boolean;
  rag_refs_used: string[];
  failure_refs_used: string[];
  learned_facts_injected: number;
  expansion_accurate: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fallback stores
// ─────────────────────────────────────────────────────────────────────────────

const _ragDocs    = new Map<string, RagDocument>();
const _schemaVers = new Map<string, SchemaVersion>();
const _failMem    = new Map<string, QueryFailureMemory>();
const _facts      = new Map<string, LearnedFact>();
const _metrics: CompactionMetrics[] = [];

let _ragCounter = 1;
let _qsigCounter = 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 8 — Schema Hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic schema hash from a schema JSON string.
 * Stores the version record so future prompts can reference the hash
 * instead of retransmitting the entire schema.
 */
export function computeSchemaHash(schemaJson: string): string {
  const fingerprint = schemaJson.trim();
  const hash = `SCHEMA_HASH:${simpleHash(fingerprint)}`;

  if (!_schemaVers.has(hash)) {
    let tableCount = 0;
    let columnCount = 0;
    try {
      const parsed = JSON.parse(fingerprint);
      const tables = Array.isArray(parsed) ? parsed : (parsed.tables ?? []);
      tableCount = tables.length;
      columnCount = tables.reduce((acc: number, t: { columns?: unknown[] }) =>
        acc + (t.columns?.length ?? 0), 0);
    } catch { /* ignore parse errors for hashing */ }

    _schemaVers.set(hash, {
      hash,
      fingerprint: fingerprint.slice(0, 200), // abbreviated for storage
      table_count: tableCount,
      column_count: columnCount,
      created_at: now(),
      last_seen: now(),
    });
  } else {
    const existing = _schemaVers.get(hash)!;
    existing.last_seen = now();
  }

  return hash;
}

/** Retrieve a schema version record by hash */
export function getSchemaVersion(hash: string): SchemaVersion | null {
  return _schemaVers.get(hash) ?? null;
}

/** Return true if the schema hash is already known (cache hit) */
export function isSchemaHashCached(hash: string): boolean {
  return _schemaVers.has(hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 7 — RAG Reference Model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store a large prompt block externally and return a RAG reference ID.
 * Future prompts use [RAG_DOC_NNN] instead of the full block.
 */
export function storeRagDocument(
  tag: string,
  content: string,
  schemaHash: string
): string {
  // Deduplicate by content hash
  const contentHash = simpleHash(content);
  const dedupeKey = `${tag}::${contentHash}`;

  for (const [id, doc] of _ragDocs) {
    if (simpleHash(doc.content) === contentHash && doc.tag === tag) {
      doc.last_used = now();
      return id;
    }
  }

  const id = `RAG_DOC_${String(_ragCounter++).padStart(3, "0")}`;
  _ragDocs.set(id, {
    id,
    tag,
    content,
    tokens: estimateTokens(content),
    schema_hash: schemaHash,
    created_at: now(),
    last_used: now(),
  });
  void dedupeKey; // used above
  return id;
}

/** Retrieve a RAG document by ID */
export function retrieveRagDocument(id: string): RagDocument | null {
  const doc = _ragDocs.get(id) ?? null;
  if (doc) doc.last_used = now();
  return doc;
}

/** Expand all [RAG_DOC_*] references in a prompt string */
export function expandRagRefs(prompt: string): string {
  return prompt.replace(/\[RAG_DOC_\d+\]/g, (ref) => {
    const id = ref.slice(1, -1);
    const doc = _ragDocs.get(id);
    return doc ? doc.content : ref; // keep ref if not found (graceful)
  });
}

/** Get total tokens stored in RAG (for metrics) */
export function getRagStats(): { count: number; totalTokens: number; tags: string[] } {
  let totalTokens = 0;
  const tags = new Set<string>();
  for (const doc of _ragDocs.values()) {
    totalTokens += doc.tokens;
    tags.add(doc.tag);
  }
  return { count: _ragDocs.size, totalTokens, tags: [...tags] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 9 — Query Failure Memory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a query failure signature in the failure memory.
 * Returns a compact QSIG reference (e.g. "QSIG_1024").
 */
export function recordFailureMemory(
  querySignature: string,
  failureReason: string,
  fixStrategy: string,
  successfulRetry: string | null = null
): string {
  // Check for existing record by signature
  for (const [qsig, mem] of _failMem) {
    if (mem.query_signature === querySignature) {
      mem.failure_reason   = failureReason;
      mem.fix_strategy     = fixStrategy;
      mem.attempt_count   += 1;
      mem.updated_at       = now();
      if (successfulRetry) mem.successful_retry = successfulRetry;
      return qsig;
    }
  }

  const qsig = `QSIG_${_qsigCounter++}`;
  _failMem.set(qsig, {
    qsig,
    query_signature: querySignature,
    failure_reason: failureReason,
    fix_strategy: fixStrategy,
    successful_retry: successfulRetry,
    attempt_count: 1,
    created_at: now(),
    updated_at: now(),
  });
  return qsig;
}

/** Retrieve a failure memory record by QSIG */
export function getFailureMemory(qsig: string): QueryFailureMemory | null {
  return _failMem.get(qsig) ?? null;
}

/** Look up QSIG for a known query signature (null if not seen before) */
export function lookupQsig(querySignature: string): string | null {
  for (const [qsig, mem] of _failMem) {
    if (mem.query_signature === querySignature) return qsig;
  }
  return null;
}

/** Get all failure memory records (for UI) */
export function getAllFailureMemory(): QueryFailureMemory[] {
  return [..._failMem.values()].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 6 — History Summarization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a retry chain into a compact learned facts record.
 * Instead of retransmitting full SQL history, the agent gets:
 *   { learned_table_mapping: X, failed_table: Y, correction: use_X }
 */
export function summarizeRetryHistory(history: Array<{
  userRequest: string;
  queriedTable?: string;
  failedTable?: string;
  successTable?: string;
  failureReason?: string;
  fixStrategy?: string;
}>): LearnedFact[] {
  const facts: LearnedFact[] = [];

  for (const entry of history) {
    if (entry.failedTable && entry.successTable) {
      const id = `fact_${simpleHash(entry.failedTable + entry.successTable)}`;
      const existing = _facts.get(id);
      if (existing) {
        existing.hit_count += 1;
        existing.confidence = Math.min(0.99, existing.confidence + 0.05);
      } else {
        const fact: LearnedFact = {
          id,
          created_at: now(),
          fact_type: "table_mapping",
          user_term: entry.failedTable,
          resolved_to: entry.successTable,
          context: entry.userRequest.slice(0, 100),
          confidence: 0.7,
          hit_count: 1,
        };
        _facts.set(id, fact);
        facts.push(fact);
      }
    }

    if (entry.failureReason && entry.fixStrategy) {
      const id = `fact_${simpleHash(entry.failureReason + entry.fixStrategy)}`;
      if (!_facts.has(id)) {
        const fact: LearnedFact = {
          id,
          created_at: now(),
          fact_type: "failure_fix",
          user_term: entry.failureReason,
          resolved_to: entry.fixStrategy,
          context: null,
          confidence: 0.65,
          hit_count: 1,
        };
        _facts.set(id, fact);
        facts.push(fact);
      }
    }
  }

  return facts;
}

/**
 * Format learned facts as a compact prompt section (replaces full history).
 * Significantly cheaper than retransmitting entire retry chains.
 */
export function formatLearnedFactsBlock(facts: LearnedFact[]): string {
  if (facts.length === 0) return "";

  const lines = [
    "Learned Facts (from query history — use these FIRST):",
  ];

  for (const f of facts.slice(0, 10)) {
    switch (f.fact_type) {
      case "table_mapping":
        lines.push(`  learned_table_mapping: ${f.user_term} → use ${f.resolved_to} [conf=${f.confidence.toFixed(2)}]`);
        break;
      case "column_mapping":
        lines.push(`  learned_column_mapping: ${f.user_term} → ${f.resolved_to} [conf=${f.confidence.toFixed(2)}]`);
        break;
      case "failure_fix":
        lines.push(`  known_fix: ${f.user_term} → ${f.resolved_to}`);
        break;
      case "kpi_mapping":
        lines.push(`  kpi_mapping: "${f.user_term}" = ${f.resolved_to}`);
        break;
      default:
        lines.push(`  note: ${f.user_term} → ${f.resolved_to}`);
    }
  }

  return lines.join("\n");
}

/** Retrieve all learned facts (sorted by confidence) */
export function getAllLearnedFacts(limit = 50): LearnedFact[] {
  return [..._facts.values()]
    .sort((a, b) => b.confidence - a.confidence || b.hit_count - a.hit_count)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 10 — Compact Execution Format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a PromptAst into a minimal compact execution intent.
 * The intent is stored alongside the compacted prompt to allow
 * full internal expansion without retransmitting schema/KPI blocks.
 */
export function buildCompactIntent(
  ast: PromptAst,
  schemaHash: string | null,
  options: {
    ragRefs?: string[];
    qsig?: string | null;
    learnedFactIds?: string[];
  } = {}
): CompactExecutionIntent {
  return {
    task: ast.intent === "unknown" ? "db_query" : ast.intent as CompactExecutionIntent["task"],
    inferSchema: ast.schema,
    metadata: ast.metadata,
    retries: ast.retries,
    historicalLearning: ast.historicalLearning,
    schemaHash,
    qsig: options.qsig ?? null,
    ragRefs: options.ragRefs ?? [],
    learnedFacts: options.learnedFactIds ?? [],
  };
}

/**
 * Serialize compact intent to a minimal JSON string for injection into prompts.
 * Only non-false values are included to save tokens.
 */
export function serializeCompactIntent(intent: CompactExecutionIntent): string {
  const parts: Record<string, unknown> = { task: intent.task };
  if (intent.inferSchema)        parts.inferSchema        = true;
  if (intent.metadata)           parts.metadata           = true;
  if (intent.retries)            parts.retries            = true;
  if (intent.historicalLearning) parts.historicalLearning = true;
  if (intent.schemaHash)         parts.schemaHash         = intent.schemaHash;
  if (intent.qsig)               parts.qsig               = intent.qsig;
  if (intent.ragRefs.length)     parts.ragRefs            = intent.ragRefs;
  if (intent.learnedFacts.length) parts.learnedFacts      = intent.learnedFacts;
  return JSON.stringify(parts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics tracking
// ─────────────────────────────────────────────────────────────────────────────

export function recordCompactionMetrics(metrics: Omit<CompactionMetrics, "session_id" | "timestamp">): string {
  const session_id = `apcs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _metrics.push({ ...metrics, session_id, timestamp: now() });
  if (_metrics.length > 500) _metrics.splice(0, _metrics.length - 500);
  return session_id;
}

export function getCompactionMetrics(limit = 50): CompactionMetrics[] {
  return [..._metrics].reverse().slice(0, limit);
}

export function getAggregateMetrics(): {
  total_sessions: number;
  avg_reduction_pct: number;
  total_tokens_saved: number;
  cache_hit_rate: number;
  total_rag_stored: number;
} {
  if (_metrics.length === 0) return {
    total_sessions: 0, avg_reduction_pct: 0, total_tokens_saved: 0,
    cache_hit_rate: 0, total_rag_stored: 0,
  };

  const total_sessions = _metrics.length;
  const avg_reduction_pct = Math.round(
    _metrics.reduce((s, m) => s + m.reduction_pct, 0) / total_sessions
  );
  const total_tokens_saved = _metrics.reduce((s, m) =>
    s + (m.original_tokens - m.compacted_tokens), 0
  );
  const cache_hit_rate = Math.round(
    (_metrics.filter((m) => m.schema_cache_hit).length / total_sessions) * 100
  );
  const ragStats = getRagStats();

  return { total_sessions, avg_reduction_pct, total_tokens_saved, cache_hit_rate, total_rag_stored: ragStats.totalTokens };
}
