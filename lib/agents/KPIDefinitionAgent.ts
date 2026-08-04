/**
 * lib/agents/KPIDefinitionAgent.ts
 *
 * Manual KPI definition registry.
 * Allows users to create reusable, named KPIs that are stored in-process
 * and consumed by KPIEngineAgent + VectorEmbeddingAgent.
 *
 * Schema:
 *   name         — unique identifier (e.g. "ADC", "HCE_Rate")
 *   description  — plain-English explanation for AI + UI display
 *   formulaSql   — SELECT-only T-SQL template (may use @StartDate / @EndDate)
 *   dimensions   — array of column names used as dimensions (for groupBy)
 *   filters      — optional WHERE-clause fragments
 *   datasetId    — optional binding to a specific dataset
 *   tags         — free-form tags for search
 *
 * Storage: in-process singleton map (persists for the Node.js process lifetime).
 * Future: connect to a DB table for cross-process persistence.
 */

import { agentRegistry } from "@/lib/orchestrator/AgentOfAgents";
import type { Agent }    from "@/lib/orchestrator/AgentOfAgents";
import { vectorEmbeddingAgent } from "./VectorEmbeddingAgent";

// ── KPI schema ────────────────────────────────────────────────────────────────

export interface KPIDefinition {
  id:          string;
  name:        string;
  description: string;
  formulaSql:  string;
  dimensions:  string[];
  filters:     string[];
  datasetId?:  string;
  tags:        string[];
  createdAt:   string;
  updatedAt:   string;
}

export interface CreateKPIInput {
  name:        string;
  description: string;
  formulaSql:  string;
  dimensions?: string[];
  filters?:    string[];
  datasetId?:  string;
  tags?:       string[];
}

export interface UpdateKPIInput extends Partial<Omit<CreateKPIInput, "name">> {
  name: string;
}

export interface KPIRegistryOutput {
  kpis:    KPIDefinition[];
  count:   number;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class KPIDefinitionAgent
  implements Agent<CreateKPIInput, KPIDefinition>
{
  readonly name = "KPIDefinitionAgent";

  private registry: Map<string, KPIDefinition> = new Map();

  /** Create or overwrite a KPI definition. */
  async run(input: CreateKPIInput): Promise<KPIDefinition> {
    return this.create(input);
  }

  create(input: CreateKPIInput): KPIDefinition {
    if (!input.name?.trim())       throw new Error("KPI name is required");
    if (!input.formulaSql?.trim()) throw new Error("KPI formulaSql is required");
    if (!input.formulaSql.trim().toUpperCase().startsWith("SELECT")) {
      throw new Error("KPI formulaSql must be a SELECT statement");
    }

    const now = new Date().toISOString();
    const id  = input.name.toLowerCase().replace(/\s+/g, "_");

    const kpi: KPIDefinition = {
      id,
      name:        input.name.trim(),
      description: input.description?.trim() ?? "",
      formulaSql:  input.formulaSql.trim(),
      dimensions:  input.dimensions ?? [],
      filters:     input.filters    ?? [],
      datasetId:   input.datasetId,
      tags:        input.tags       ?? [],
      createdAt:   this.registry.get(id)?.createdAt ?? now,
      updatedAt:   now,
    };

    this.registry.set(id, kpi);

    // Re-index in vector store so NL queries can find this KPI
    vectorEmbeddingAgent.indexKPIs([{
      name:        kpi.name,
      description: kpi.description,
      formulaSql:  kpi.formulaSql,
      dimensions:  kpi.dimensions,
    }]).catch(() => { /* non-fatal */ });

    return kpi;
  }

  update(input: UpdateKPIInput): KPIDefinition {
    const id  = input.name.toLowerCase().replace(/\s+/g, "_");
    const existing = this.registry.get(id);
    if (!existing) throw new Error(`KPI "${input.name}" not found`);

    return this.create({
      name:        existing.name,
      description: input.description ?? existing.description,
      formulaSql:  input.formulaSql  ?? existing.formulaSql,
      dimensions:  input.dimensions  ?? existing.dimensions,
      filters:     input.filters     ?? existing.filters,
      datasetId:   input.datasetId   ?? existing.datasetId,
      tags:        input.tags        ?? existing.tags,
    });
  }

  delete(name: string): boolean {
    const id = name.toLowerCase().replace(/\s+/g, "_");
    return this.registry.delete(id);
  }

  get(name: string): KPIDefinition | undefined {
    const id = name.toLowerCase().replace(/\s+/g, "_");
    return this.registry.get(id);
  }

  list(): KPIRegistryOutput {
    const kpis = Array.from(this.registry.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { kpis, count: kpis.length };
  }

  search(query: string): KPIDefinition[] {
    const q = query.toLowerCase();
    return Array.from(this.registry.values()).filter((k) =>
      k.name.toLowerCase().includes(q) ||
      k.description.toLowerCase().includes(q) ||
      k.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
}

// ── Singleton + auto-register ─────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & { __kpiDefinitionAgent?: KPIDefinitionAgent };
if (!_global.__kpiDefinitionAgent) {
  _global.__kpiDefinitionAgent = new KPIDefinitionAgent();
  agentRegistry.register(_global.__kpiDefinitionAgent);
}

export const kpiDefinitionAgent: KPIDefinitionAgent = _global.__kpiDefinitionAgent;
