/**
 * lib/orchestrator/AgentRegistryStore.ts
 *
 * Pluggable Agent Registry with full CRUD, versioning, dependency mapping,
 * configuration management, runtime selection, feature toggles, and A/B testing.
 *
 * Architecture:
 *   - Each agent has a unique (name, version) key. Multiple versions can
 *     coexist; only the "active" version is used in pipeline execution.
 *   - Dependency mapping: agents declare which other agents they require.
 *     The engine validates the graph before executing a pipeline.
 *   - Feature toggles: each registration can be enabled/disabled without removal.
 *   - A/B config: agents can declare a/b variants with traffic split weights.
 *   - Runtime selection: per-agent override of the AI model/runtime context.
 *   - Configuration management: typed per-agent config bag, merged with defaults.
 */

// ── Core types ────────────────────────────────────────────────────────────────

export type AgentDomain =
  | "Metadata Engine"
  | "Query Generation"
  | "Semantic Intelligence Layer"
  | "Business Intelligence"
  | "Data Quality"
  | "Report Validation"
  | "Security Audit"
  | "Recommendation Engine"
  | "KPI Intelligence"
  | "KPI Definitions"
  | "Relationship Engine"
  | "Custom";

export type AgentRuntime = "nodejs" | "edge" | "worker" | "external";

export type AgentStatus = "ready" | "running" | "error" | "disabled" | "deprecated";

export interface ABVariant {
  /** Variant label, e.g. "control" | "treatment" */
  label:  string;
  /** Traffic weight — relative. e.g. [70, 30] for 70/30 split. */
  weight: number;
  /** Config overrides applied for this variant */
  config: Record<string, unknown>;
}

export interface AgentConfig {
  /** AI model override, e.g. "gpt-4o" */
  model?:          string;
  /** Max tokens for AI calls */
  maxTokens?:      number;
  /** Temperature for AI calls */
  temperature?:    number;
  /** Timeout in ms */
  timeoutMs?:      number;
  /** Maximum retries on transient failure */
  maxRetries?:     number;
  /** Custom config properties */
  [key: string]:   unknown;
}

export interface AgentRegistration {
  /** Unique identifier, e.g. "MetadataNormalizationAgent" */
  name:           string;
  /** SemVer string, e.g. "1.2.0" */
  version:        string;
  /** Human-readable description */
  description:    string;
  /** Domain classification */
  domain:         AgentDomain;
  /** Runtime environment */
  runtime:        AgentRuntime;
  /** Other agent names this agent depends on */
  dependencies:   string[];
  /** Tags for search/filtering */
  tags:           string[];
  /** Whether this registration is active */
  enabled:        boolean;
  /** Whether this is the active version for this agent name */
  isActiveVersion: boolean;
  /** Feature toggle key (optional — links to a feature flag) */
  featureFlag?:   string;
  /** A/B test variants (empty = no A/B testing) */
  abVariants:     ABVariant[];
  /** Merged effective config */
  config:         AgentConfig;
  /** Timestamp registered */
  registeredAt:   string;
  /** Timestamp last updated */
  updatedAt:      string;
  /** Who registered this agent */
  registeredBy:   string;
  /** Current runtime status */
  status:         AgentStatus;
  /** Execution metrics */
  metrics: {
    totalRuns:     number;
    successRuns:   number;
    errorRuns:     number;
    avgDurationMs: number;
    lastRunAt?:    string;
    lastErrorMsg?: string;
  };
}

export interface AgentRegistrySnapshot {
  agents:      AgentRegistration[];
  totalCount:  number;
  enabledCount: number;
  generatedAt: string;
  version:     string;
}

// ── Default configs per domain ────────────────────────────────────────────────

const DOMAIN_DEFAULTS: Record<AgentDomain, Partial<AgentConfig>> = {
  "Metadata Engine":               { timeoutMs: 30000, maxRetries: 2 },
  "Query Generation":              { timeoutMs: 60000, maxRetries: 3, temperature: 0 },
  "Semantic Intelligence Layer":   { timeoutMs: 45000, maxRetries: 2, temperature: 0 },
  "Business Intelligence":         { timeoutMs: 60000, maxRetries: 2, temperature: 0.3 },
  "Data Quality":                  { timeoutMs: 30000, maxRetries: 1 },
  "Report Validation":             { timeoutMs: 20000, maxRetries: 1 },
  "Security Audit":                { timeoutMs: 15000, maxRetries: 0 },
  "Recommendation Engine":         { timeoutMs: 45000, maxRetries: 2, temperature: 0.5 },
  "KPI Intelligence":              { timeoutMs: 60000, maxRetries: 3 },
  "KPI Definitions":               { timeoutMs: 10000, maxRetries: 1 },
  "Relationship Engine":           { timeoutMs: 30000, maxRetries: 2 },
  "Custom":                        { timeoutMs: 30000, maxRetries: 2 },
};

// ── The store ─────────────────────────────────────────────────────────────────

export class AgentRegistryStore {
  private store: Map<string, AgentRegistration> = new Map();
  // key = `${name}@${version}`
  private makeKey(name: string, version: string) { return `${name}@${version}`; }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a new agent (or update an existing one with the same name+version).
   * Pass `isActiveVersion: true` to promote this version as the default.
   */
  registerAgent(params: Omit<AgentRegistration, "registeredAt" | "updatedAt" | "status" | "metrics">): AgentRegistration {
    const key = this.makeKey(params.name, params.version);
    const now = new Date().toISOString();

    // If promoting to active, demote all other versions of same name
    if (params.isActiveVersion) {
      for (const [k, v] of this.store) {
        if (v.name === params.name && k !== key) {
          this.store.set(k, { ...v, isActiveVersion: false });
        }
      }
    }

    const merged: AgentConfig = {
      ...DOMAIN_DEFAULTS[params.domain],
      ...params.config,
    };

    const existing = this.store.get(key);
    const reg: AgentRegistration = {
      ...params,
      config:      merged,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt:   now,
      status:      params.enabled ? "ready" : "disabled",
      metrics:     existing?.metrics ?? {
        totalRuns: 0, successRuns: 0, errorRuns: 0, avgDurationMs: 0,
      },
    };

    this.store.set(key, reg);
    return reg;
  }

  /** Remove an agent registration entirely. */
  removeAgent(name: string, version?: string): boolean {
    if (version) {
      return this.store.delete(this.makeKey(name, version));
    }
    // Remove all versions
    let removed = false;
    for (const [k, v] of this.store) {
      if (v.name === name) { this.store.delete(k); removed = true; }
    }
    return removed;
  }

  /**
   * Update an existing registration's fields.
   * Only supplied fields are changed; others are preserved.
   */
  updateAgent(
    name: string,
    version: string,
    patch: Partial<Omit<AgentRegistration, "name" | "version" | "registeredAt" | "metrics">>
  ): AgentRegistration | null {
    const key = this.makeKey(name, version);
    const existing = this.store.get(key);
    if (!existing) return null;

    const updated: AgentRegistration = {
      ...existing,
      ...patch,
      name,
      version,
      registeredAt: existing.registeredAt,
      metrics:      existing.metrics,
      updatedAt:    new Date().toISOString(),
      status:       patch.enabled !== undefined
        ? (patch.enabled ? "ready" : "disabled")
        : existing.status,
    };

    if (patch.config) {
      updated.config = { ...DOMAIN_DEFAULTS[updated.domain], ...existing.config, ...patch.config };
    }

    // If promoting this to active, demote others
    if (patch.isActiveVersion) {
      for (const [k, v] of this.store) {
        if (v.name === name && k !== key) {
          this.store.set(k, { ...v, isActiveVersion: false, updatedAt: updated.updatedAt });
        }
      }
    }

    this.store.set(key, updated);
    return updated;
  }

  /**
   * Swap the active version of an agent.
   * The previous active version is kept but flagged as inactive.
   */
  swapAgent(name: string, toVersion: string): AgentRegistration | null {
    const key = this.makeKey(name, toVersion);
    const target = this.store.get(key);
    if (!target) return null;
    return this.updateAgent(name, toVersion, { isActiveVersion: true });
  }

  // ── Feature toggles ───────────────────────────────────────────────────────

  enableAgent(name: string, version?: string): void {
    this._toggleAll(name, version, true);
  }

  disableAgent(name: string, version?: string): void {
    this._toggleAll(name, version, false);
  }

  private _toggleAll(name: string, version: string | undefined, enabled: boolean) {
    for (const [k, v] of this.store) {
      if (v.name === name && (!version || v.version === version)) {
        this.store.set(k, {
          ...v,
          enabled,
          status: enabled ? "ready" : "disabled",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  // ── A/B config ────────────────────────────────────────────────────────────

  /** Set or replace all A/B variants for an agent version. */
  setABVariants(name: string, version: string, variants: ABVariant[]): AgentRegistration | null {
    return this.updateAgent(name, version, { abVariants: variants });
  }

  /**
   * Resolve the effective config for this agent, picking an A/B variant
   * deterministically by runId (or randomly if no runId).
   */
  resolveConfig(name: string, runId?: string): { reg: AgentRegistration; config: AgentConfig; variant?: string } | null {
    const reg = this.getActiveVersion(name);
    if (!reg || !reg.enabled) return null;

    if (reg.abVariants.length === 0) {
      return { reg, config: reg.config };
    }

    // Weighted selection — deterministic by hash(runId) if provided
    const total = reg.abVariants.reduce((s, v) => s + v.weight, 0);
    let pick = runId
      ? Math.abs(hashStr(runId)) % total
      : Math.floor(Math.random() * total);

    for (const variant of reg.abVariants) {
      pick -= variant.weight;
      if (pick < 0) {
        return {
          reg,
          config: { ...reg.config, ...variant.config },
          variant: variant.label,
        };
      }
    }

    return { reg, config: reg.config };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  get(name: string, version: string): AgentRegistration | undefined {
    return this.store.get(this.makeKey(name, version));
  }

  getActiveVersion(name: string): AgentRegistration | undefined {
    // Prefer explicit isActiveVersion, fall back to highest semver
    const all = this.listByName(name).filter((r) => r.enabled);
    return all.find((r) => r.isActiveVersion) ?? all.sort(semverDesc)[0];
  }

  listByName(name: string): AgentRegistration[] {
    return Array.from(this.store.values()).filter((r) => r.name === name);
  }

  list(filter?: { domain?: AgentDomain; enabled?: boolean; tag?: string }): AgentRegistration[] {
    let results = Array.from(this.store.values());
    if (filter?.domain)  results = results.filter((r) => r.domain  === filter.domain);
    if (filter?.enabled !== undefined) results = results.filter((r) => r.enabled === filter.enabled);
    if (filter?.tag)     results = results.filter((r) => r.tags.includes(filter.tag!));
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** All unique agent names (deduplicated across versions). */
  listNames(): string[] {
    return [...new Set(Array.from(this.store.values()).map((r) => r.name))].sort();
  }

  snapshot(): AgentRegistrySnapshot {
    const agents = this.list();
    return {
      agents,
      totalCount:   agents.length,
      enabledCount: agents.filter((a) => a.enabled).length,
      generatedAt:  new Date().toISOString(),
      version:      "2.0.0",
    };
  }

  // ── Dependency validation ─────────────────────────────────────────────────

  /**
   * Validate that all declared dependencies are satisfied for a set of agent names.
   * Returns a list of missing dependencies.
   */
  validateDependencies(agentNames: string[]): { agent: string; missing: string[] }[] {
    const available = new Set(agentNames);
    const issues: { agent: string; missing: string[] }[] = [];

    for (const name of agentNames) {
      const reg = this.getActiveVersion(name);
      if (!reg) continue;
      const missing = reg.dependencies.filter((d) => !available.has(d));
      if (missing.length > 0) issues.push({ agent: name, missing });
    }

    return issues;
  }

  /**
   * Topological sort of agent names based on declared dependencies.
   * Returns sorted order (dependencies first) or throws on circular dependency.
   */
  topologicalSort(agentNames: string[]): string[] {
    const inDegree: Map<string, number> = new Map();
    const graph: Map<string, string[]> = new Map();

    for (const name of agentNames) {
      inDegree.set(name, 0);
      graph.set(name, []);
    }

    const nameSet = new Set(agentNames);
    for (const name of agentNames) {
      const reg = this.getActiveVersion(name);
      if (!reg) continue;
      for (const dep of reg.dependencies) {
        if (nameSet.has(dep)) {
          graph.get(dep)?.push(name);
          inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
        }
      }
    }

    const queue = agentNames.filter((n) => (inDegree.get(n) ?? 0) === 0);
    const sorted: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of graph.get(node) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== agentNames.length) {
      throw new Error(
        `Circular dependency detected in agents: ${agentNames.filter((n) => !sorted.includes(n)).join(", ")}`
      );
    }

    return sorted;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  recordRun(name: string, version: string, result: { success: boolean; durationMs: number; errorMsg?: string }) {
    const key = this.makeKey(name, version);
    const reg = this.store.get(key);
    if (!reg) return;

    const m = reg.metrics;
    const totalRuns   = m.totalRuns + 1;
    const successRuns = m.successRuns + (result.success ? 1 : 0);
    const errorRuns   = m.errorRuns   + (result.success ? 0 : 1);
    const avgDurationMs = Math.round(
      (m.avgDurationMs * m.totalRuns + result.durationMs) / totalRuns
    );

    this.store.set(key, {
      ...reg,
      status: result.success ? "ready" : "error",
      metrics: {
        totalRuns, successRuns, errorRuns, avgDurationMs,
        lastRunAt:    new Date().toISOString(),
        lastErrorMsg: result.success ? reg.metrics.lastErrorMsg : result.errorMsg,
      },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function semverDesc(a: AgentRegistration, b: AgentRegistration): number {
  const parse = (v: string) => v.split(".").map(Number);
  const av = parse(a.version);
  const bv = parse(b.version);
  for (let i = 0; i < 3; i++) {
    if ((bv[i] ?? 0) !== (av[i] ?? 0)) return (bv[i] ?? 0) - (av[i] ?? 0);
  }
  return 0;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const _g = globalThis as typeof globalThis & { __agentRegistryStore?: AgentRegistryStore };
if (!_g.__agentRegistryStore) {
  _g.__agentRegistryStore = new AgentRegistryStore();
}
export const agentRegistryStore: AgentRegistryStore = _g.__agentRegistryStore;

// ── Seed built-in agents ──────────────────────────────────────────────────────

const BUILT_IN_AGENTS: Omit<AgentRegistration, "registeredAt" | "updatedAt" | "status" | "metrics">[] = [
  {
    name:            "MetadataCatalogAgent",
    version:         "1.0.0",
    description:     "Schema discovery, column cataloging, metadata tagging, and data lineage mapping.",
    domain:          "Metadata Engine",
    runtime:         "nodejs",
    dependencies:    [],
    tags:            ["metadata", "schema", "catalog", "lineage"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "QueryGenerationAgent",
    version:         "1.0.0",
    description:     "SQL generation, DAX generation, query optimization, and parameterized query building.",
    domain:          "Query Generation",
    runtime:         "nodejs",
    dependencies:    ["MetadataCatalogAgent"],
    tags:            ["sql", "query", "generation", "optimization"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "SemanticSearchAgent",
    version:         "1.0.0",
    description:     "Vector search, knowledge retrieval, semantic model discovery, and NL-to-query interpretation.",
    domain:          "Semantic Intelligence Layer",
    runtime:         "nodejs",
    dependencies:    ["MetadataCatalogAgent"],
    tags:            ["semantic", "vector", "search", "nlp"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "BusinessIntelligenceAgent",
    version:         "1.0.0",
    description:     "Narrative insights, KPI interpretation, trend detection, and executive summaries.",
    domain:          "Business Intelligence",
    runtime:         "nodejs",
    dependencies:    ["QueryGenerationAgent"],
    tags:            ["bi", "insights", "kpi", "narrative"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "DataQualityAgent",
    version:         "1.0.0",
    description:     "Data profiling, anomaly detection, completeness checks, and reconciliation.",
    domain:          "Data Quality",
    runtime:         "nodejs",
    dependencies:    ["MetadataCatalogAgent"],
    tags:            ["quality", "profiling", "anomaly", "completeness"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "ReportValidationAgent",
    version:         "1.0.0",
    description:     "KPI verification, report auditing, visualization accuracy checks.",
    domain:          "Report Validation",
    runtime:         "nodejs",
    dependencies:    ["BusinessIntelligenceAgent", "DataQualityAgent"],
    tags:            ["validation", "audit", "report", "kpi"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "SecurityAuditAgent",
    version:         "1.0.0",
    description:     "Access reviews, RBAC validation, PHI/PII protection enforcement.",
    domain:          "Security Audit",
    runtime:         "nodejs",
    dependencies:    [],
    tags:            ["security", "rbac", "phi", "hipaa", "audit"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     "security_audit",
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "RecommendationAgent",
    version:         "1.0.0",
    description:     "Remediation plans, architecture recommendations, and next-best-action guidance.",
    domain:          "Recommendation Engine",
    runtime:         "nodejs",
    dependencies:    ["BusinessIntelligenceAgent", "DataQualityAgent"],
    tags:            ["recommendation", "remediation", "architecture"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "MetadataNormalizationAgent",
    version:         "1.0.0",
    description:     "Parses and normalises metadata.json into a canonical schema, emits SCHEMA_UPDATED.",
    domain:          "Metadata Engine",
    runtime:         "nodejs",
    dependencies:    [],
    tags:            ["metadata", "normalisation", "schema"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "VectorEmbeddingAgent",
    version:         "1.0.0",
    description:     "Embeds metadata, columns, KPIs, and relationships for semantic similarity search.",
    domain:          "Semantic Intelligence Layer",
    runtime:         "nodejs",
    dependencies:    ["MetadataNormalizationAgent"],
    tags:            ["vector", "embedding", "semantic", "search"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "KPIEngineAgent",
    version:         "1.0.0",
    description:     "Executes live KPI SQL queries, generates AI insights from results.",
    domain:          "KPI Intelligence",
    runtime:         "nodejs",
    dependencies:    ["QueryGenerationAgent"],
    tags:            ["kpi", "query", "insights"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "KPIDefinitionAgent",
    version:         "1.0.0",
    description:     "Manual KPI registry — create, update, search, and bind reusable KPI definitions.",
    domain:          "KPI Definitions",
    runtime:         "nodejs",
    dependencies:    [],
    tags:            ["kpi", "definitions", "registry"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
  {
    name:            "RelationshipBuilderAgent",
    version:         "1.0.0",
    description:     "Discovers table joins via metadata FKs, column-name heuristics, and semantic similarity.",
    domain:          "Relationship Engine",
    runtime:         "nodejs",
    dependencies:    ["MetadataCatalogAgent"],
    tags:            ["relationship", "join", "fk", "graph"],
    enabled:         true,
    isActiveVersion: true,
    featureFlag:     undefined,
    abVariants:      [],
    config:          {},
    registeredBy:    "system",
  },
];

// Seed on first load
if (agentRegistryStore.list().length === 0) {
  for (const agent of BUILT_IN_AGENTS) {
    agentRegistryStore.registerAgent(agent);
  }
}
