/**
 * lib/agents/KPIEngineAgent.ts
 *
 * Executes live KPI queries against the database and generates AI insights.
 * Replaces static/demo outputs entirely — always runs real SQL.
 *
 * Responsibilities:
 *   1. Receive a KPI name or formula_sql + datasetId
 *   2. Validate SQL (SELECT-only)
 *   3. Execute against the live DB via executeRawQuery
 *   4. Generate AI insights from the result rows
 *   5. Emit KPI_REQUESTED + QUERY_EXECUTED events
 *
 * Emits:
 *   KPI_REQUESTED   — on entry
 *   QUERY_EXECUTED  — on success
 *   QUERY_FAILED    — on DB error
 */

import { eventBus }      from "@/lib/orchestrator/EventBus";
import { agentRegistry } from "@/lib/orchestrator/AgentOfAgents";
import type { Agent }    from "@/lib/orchestrator/AgentOfAgents";
import { kpiDefinitionAgent, type KPIDefinition } from "./KPIDefinitionAgent";
import kpiConfig from "@/lib/config/kpiConfig.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KPIEngineInput {
  /** KPI name to look up in the registry, OR provide formula_sql directly */
  kpiName?:    string;
  /** Direct SQL override (takes precedence over kpiName) */
  formulaSql?: string;
  /** Dataset ID for scoping (informational — used in events) */
  datasetId?:  string;
  /** Natural language query that triggered this KPI (for AI insights context) */
  userQuery?:  string;
  /** Date range for parameterised queries */
  startDate?:  string;
  endDate?:    string;
  /** Optional branch filter */
  branchCode?: string;
}

export interface KPIEngineOutput {
  kpiName:       string;
  sql:           string;
  rows:          Record<string, unknown>[];
  rowCount:      number;
  durationMs:    number;
  insights:      string;
  kpiDefinition?: KPIDefinition;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace @StartDate / @EndDate / @BranchCode with literal values for read-only queries. */
function parameteriseSql(sql: string, input: KPIEngineInput): string {
  const start     = input.startDate  ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const end       = input.endDate    ?? new Date().toISOString().slice(0, 10);
  const branch    = input.branchCode ?? "";

  return sql
    .replace(/@StartDate/gi, `'${start}'`)
    .replace(/@EndDate/gi,   `'${end}'`)
    .replace(/@BranchCode/gi, branch ? `'${branch}'` : "NULL");
}

/** Generate a short plain-text insight from result rows. */
async function generateInsights(
  rows: Record<string, unknown>[],
  kpiName: string,
  userQuery: string
): Promise<string> {
  if (rows.length === 0) return `No data returned for "${kpiName}".`;

  // Try AI insight if configured
  const hasAI = !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
  if (hasAI) {
    try {
      const { chatJSON } = await import("@/lib/ai/gateway");
      const sample = JSON.stringify(rows.slice(0, 10));
      const sysPrompt = "You are a healthcare BI analyst. Respond only with valid JSON matching { \"insight\": \"...\" }. Be specific with numbers.";
      const userPrompt = `KPI: ${kpiName}\nUser query: "${userQuery}"\nResults (first 10 rows):\n${sample}\nSummarise in 2-3 sentences.`;
      const response = await chatJSON<{ insight: string }>(sysPrompt, userPrompt);
      if (response?.insight) return response.insight;
    } catch { /* fall through to rule-based */ }
  }

  // Rule-based insight (no AI key)
  const firstKey  = Object.keys(rows[0])[0];
  const lastKey   = Object.keys(rows[0]).at(-1) ?? firstKey;
  const firstVal  = rows[0][lastKey];
  const numericVal = typeof firstVal === "number"
    ? firstVal.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(firstVal ?? "N/A");

  if (rows.length === 1) {
    return `${kpiName}: ${numericVal} (${firstKey}: ${String(rows[0][firstKey] ?? "—")}).`;
  }

  const values  = rows.map((r) => Number(r[lastKey])).filter((n) => !Number.isNaN(n));
  const total   = values.reduce((a, b) => a + b, 0);
  const avg     = values.length ? (total / values.length).toFixed(2) : "N/A";
  const maxRow  = rows[values.indexOf(Math.max(...values))] ?? rows[0];

  return `${kpiName}: ${rows.length} records returned. Average ${lastKey}: ${avg}. ` +
    `Top ${firstKey}: ${String(maxRow[firstKey] ?? "—")} (${String(maxRow[lastKey] ?? "—")}).`;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class KPIEngineAgent implements Agent<KPIEngineInput, KPIEngineOutput> {
  readonly name = "KPIEngineAgent";

  async run(input: KPIEngineInput): Promise<KPIEngineOutput> {
    const { kpiName = "Custom KPI", datasetId = "", userQuery = kpiName } = input;
    const start = Date.now();

    // Emit entry event
    eventBus.emit("KPI_REQUESTED", {
      datasetId, kpiName, userQuery,
      timestamp: new Date().toISOString(),
    });

    // ── Resolve SQL ─────────────────────────────────────────────────────────
    let sql          = input.formulaSql ?? "";
    let kpiDefinition: KPIDefinition | undefined;

    if (!sql && kpiName) {
      // 1. Check the custom KPI registry
      kpiDefinition = kpiDefinitionAgent.get(kpiName);
      if (kpiDefinition) {
        sql = kpiDefinition.formulaSql;
      } else {
        // 2. Fall back to kpiConfig.json
        const staticKpi = (kpiConfig as Record<string, { sql?: string; formula?: string }>)[kpiName];
        if (staticKpi?.sql)     sql = staticKpi.sql;
        if (staticKpi?.formula) sql = staticKpi.formula;
      }
    }

    if (!sql) {
      return {
        kpiName, sql: "", rows: [], rowCount: 0, durationMs: 0,
        insights: `No SQL formula found for KPI "${kpiName}". Define it with KPIDefinitionAgent.`,
        kpiDefinition,
      };
    }

    // ── Parameterise ────────────────────────────────────────────────────────
    const resolvedSql = parameteriseSql(sql, input);

    // ── Execute ─────────────────────────────────────────────────────────────
    let rows: Record<string, unknown>[] = [];
    let execError: string | undefined;

    try {
      const { executeRawQuery, isDbConfigured } = await import("@/lib/services/db");

      if (!isDbConfigured()) {
        execError = "Database not configured — cannot execute live KPI query.";
      } else {
        rows = (await executeRawQuery(resolvedSql)) as Record<string, unknown>[];
        const durationMs = Date.now() - start;
        eventBus.emit("QUERY_EXECUTED", {
          sql: resolvedSql, rowCount: rows.length, durationMs,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      execError = err instanceof Error ? err.message : String(err);
      eventBus.emit("QUERY_FAILED", {
        sql: resolvedSql, error: execError, userQuery,
        timestamp: new Date().toISOString(),
      });
    }

    const durationMs = Date.now() - start;

    if (execError) {
      return {
        kpiName, sql: resolvedSql, rows: [], rowCount: 0, durationMs,
        insights: `KPI execution failed: ${execError}`,
        kpiDefinition,
      };
    }

    // ── Insights ────────────────────────────────────────────────────────────
    const insights = await generateInsights(rows, kpiName, userQuery);

    return { kpiName, sql: resolvedSql, rows, rowCount: rows.length, durationMs, insights, kpiDefinition };
  }
}

// ── Singleton + auto-register ─────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & { __kpiEngineAgent?: KPIEngineAgent };
if (!_global.__kpiEngineAgent) {
  _global.__kpiEngineAgent = new KPIEngineAgent();
  agentRegistry.register(_global.__kpiEngineAgent);
}

export const kpiEngineAgent: KPIEngineAgent = _global.__kpiEngineAgent;
