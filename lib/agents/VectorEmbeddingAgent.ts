/**
 * lib/agents/VectorEmbeddingAgent.ts
 *
 * Semantic Intelligence Layer — wraps the existing vectorSearch + embeddings
 * stack as a first-class agent that can be registered with AgentOfAgents.
 *
 * Responsibilities:
 *   1. indexMetadata  — embed tables / columns / relationships from metadata.json
 *                       or a normalised MetadataNormalizationAgent output
 *   2. indexKPIs      — embed KPI definitions so NL queries match KPI names
 *   3. search         — semantic similarity search over the indexed corpus
 *   4. buildContext   — reshape search results into a typed ContextPayload
 *                       consumed by SemanticQueryEngine and KPIEngineAgent
 *
 * Integration points:
 *   SemanticQueryEngine — enriched context injected before intent resolution
 *   KPIEngineAgent      — relevant KPI definitions surfaced for live queries
 *   DatasetBuilderAgent — relevant table/join suggestions
 */

import { vectorSearch, type VectorSearchResult, type VectorSearchOptions, type CorpusDocType } from "@/lib/ai/vectorSearch";
import { embedTexts }        from "@/lib/ai/embeddings";
import { getPgVectorPool, isPgVectorConfigured } from "@/lib/db/pgvectorClient";
import { pgVectorLiteral }   from "@/lib/ai/embeddings";
import { eventBus }          from "@/lib/orchestrator/EventBus";
import { agentRegistry }     from "@/lib/orchestrator/AgentOfAgents";
import type { Agent }        from "@/lib/orchestrator/AgentOfAgents";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NormalisedMetadata {
  tables: {
    tableName:    string;
    tableSchema:  string;
    description?: string;
    columns: {
      columnName:   string;
      type:         string;
      description?: string;
    }[];
    relationships: {
      fromColumn: string;
      toTable:    string;
      toColumn:   string;
    }[];
  }[];
  kpis?: {
    name:        string;
    description: string;
    formulaSql:  string;
    dimensions:  string[];
  }[];
}

export interface ContextPayload {
  relevantTables:    VectorSearchResult[];
  relevantColumns:   VectorSearchResult[];
  relevantKPIs:      VectorSearchResult[];
  relevantHistory:   VectorSearchResult[];
  topMatches:        VectorSearchResult[];
  contextSummary:    string;
}

export interface VectorSearchInput {
  query:        string;
  topK?:        number;
  savedReports?: Parameters<typeof vectorSearch>[0]["savedReports"];
  fixLog?:       Parameters<typeof vectorSearch>[0]["fixLog"];
}

export interface IndexMetadataInput {
  metadata: NormalisedMetadata;
  /** If true, re-index even if corpus already exists */
  force?: boolean;
}

export interface IndexResult {
  inserted:   number;
  skipped:    number;
  corpusName: string;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class VectorEmbeddingAgent implements Agent<VectorSearchInput, ContextPayload> {
  readonly name = "VectorEmbeddingAgent";

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Build text corpus from normalised metadata, batch-embed, upsert into pgvector.
   * Falls back to no-op when pgvector is not configured (in-process search still works).
   */
  async indexMetadata(input: IndexMetadataInput): Promise<IndexResult> {
    const { metadata } = input;
    const texts: string[] = [];
    const types: string[] = [];
    const metas: Record<string, unknown>[] = [];

    for (const t of metadata.tables) {
      const full = `${t.tableSchema}.${t.tableName}`;
      const cols = t.columns.map((c) => c.columnName).join(", ");

      // Table-level document
      texts.push(`Table: ${full}${t.description ? ` — ${t.description}` : ""}. Columns: ${cols}`);
      types.push("schema");
      metas.push({ table: full, tableSchema: t.tableSchema, tableName: t.tableName });

      // Column-level documents
      for (const col of t.columns) {
        texts.push(`Column: ${full}.${col.columnName} (${col.type})${col.description ? ` — ${col.description}` : ""}`);
        types.push("column");
        metas.push({ table: full, column: col.columnName, type: col.type });
      }

      // Relationship documents
      for (const rel of t.relationships) {
        const relText = `Relationship: ${full}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}`;
        texts.push(relText);
        types.push("relationship");
        metas.push({ from: `${full}.${rel.fromColumn}`, to: `${rel.toTable}.${rel.toColumn}` });
      }
    }

    // KPI documents (type cast: "kpi" extends the corpus beyond the base CorpusDocType union)
    for (const kpi of metadata.kpis ?? []) {
      texts.push(`KPI: ${kpi.name} — ${kpi.description}. SQL: ${kpi.formulaSql.slice(0, 200)}`);
      types.push("kpi" as CorpusDocType);
      metas.push({ kpiName: kpi.name, dimensions: kpi.dimensions });
    }

    if (texts.length === 0) return { inserted: 0, skipped: 0, corpusName: "metadata" };

    // If pgvector not configured, corpus lives in-process — still emit event
    if (!isPgVectorConfigured()) {
      eventBus.emit("EMBEDDINGS_INDEXED", {
        corpus: "metadata", docCount: texts.length,
        timestamp: new Date().toISOString(),
      });
      return { inserted: 0, skipped: texts.length, corpusName: "metadata" };
    }

    const embeddings = await embedTexts(texts);
    const pool = getPgVectorPool();
    let inserted = 0;
    let skipped  = 0;

    for (let i = 0; i < texts.length; i++) {
      if (!embeddings[i]?.length) { skipped++; continue; }
      const result = await pool.query(
        `INSERT INTO vectors (content, type, embedding, metadata)
         VALUES ($1, $2, $3::vector, $4)
         ON CONFLICT DO NOTHING`,
        [texts[i], types[i], pgVectorLiteral(embeddings[i]), JSON.stringify(metas[i])]
      );
      inserted += result.rowCount ?? 0;
    }

    eventBus.emit("EMBEDDINGS_INDEXED", {
      corpus: "metadata", docCount: inserted,
      timestamp: new Date().toISOString(),
    });

    return { inserted, skipped, corpusName: "metadata" };
  }

  /**
   * Index KPI definitions as standalone documents for direct KPI matching.
   */
  async indexKPIs(kpis: NonNullable<NormalisedMetadata["kpis"]>): Promise<IndexResult> {
    return this.indexMetadata({ metadata: { tables: [], kpis } });
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * Semantic similarity search — delegates to the existing vectorSearch stack
   * (pgvector when available, in-process cosine otherwise).
   */
  async search(input: VectorSearchInput): Promise<VectorSearchResult[]> {
    const opts: VectorSearchOptions = {
      query:        input.query,
      topK:         input.topK ?? 8,
      savedReports: input.savedReports ?? [],
      fixLog:       input.fixLog ?? [],
    };
    return vectorSearch(opts);
  }

  // ── Context builder ─────────────────────────────────────────────────────────

  /**
   * Build a typed ContextPayload from raw search results.
   * Filters results by type and computes a human-readable summary
   * that is injected directly into the SemanticQueryEngine prompt.
   */
  buildContext(results: VectorSearchResult[]): ContextPayload {
    const tables    = results.filter((r) => r.type === "schema");
    const columns   = results.filter((r) => r.type === "column");
    // "kpi" is not in the base CorpusDocType union — cast for forward-compatibility
    const kpis      = results.filter((r) => (r.type as string) === "kpi");
    const history   = results.filter((r) => r.type === "report" || r.type === "history" || r.type === "fix");

    const lines: string[] = [];
    if (tables.length)  lines.push(`Relevant tables: ${tables.map((t) => t.content.split(":")[1]?.split(",")[0]?.trim() ?? t.content.slice(0, 40)).join(", ")}`);
    if (kpis.length)    lines.push(`Matching KPIs: ${kpis.map((k) => k.content.split("—")[0]?.replace("KPI:", "").trim() ?? k.content.slice(0, 40)).join(", ")}`);
    if (columns.length) lines.push(`Relevant columns: ${columns.slice(0, 4).map((c) => c.content.split("(")[0]?.replace("Column:", "").trim() ?? c.content.slice(0, 30)).join(", ")}`);
    if (history.length) lines.push(`Similar past queries: ${history.slice(0, 2).map((h) => h.content.slice(0, 60)).join("; ")}`);

    return {
      relevantTables:  tables,
      relevantColumns: columns,
      relevantKPIs:    kpis,
      relevantHistory: history,
      topMatches:      results,
      contextSummary:  lines.join("\n") || "No prior context found.",
    };
  }

  // ── Agent.run ───────────────────────────────────────────────────────────────

  /** Main entry point when dispatched via AgentOfAgents. */
  async run(input: VectorSearchInput): Promise<ContextPayload> {
    const results = await this.search(input);
    return this.buildContext(results);
  }
}

// ── Singleton + auto-register ─────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & { __vectorEmbeddingAgent?: VectorEmbeddingAgent };
if (!_global.__vectorEmbeddingAgent) {
  _global.__vectorEmbeddingAgent = new VectorEmbeddingAgent();
  agentRegistry.register(_global.__vectorEmbeddingAgent);
}

export const vectorEmbeddingAgent: VectorEmbeddingAgent = _global.__vectorEmbeddingAgent;
