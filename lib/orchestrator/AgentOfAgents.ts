/**
 * lib/orchestrator/AgentOfAgents.ts
 *
 * Routes inputs to the correct domain agent, emits completion events,
 * and maintains an execution trace for each run.
 *
 * Agent registry (populated at runtime by each agent's init call):
 *   VectorEmbeddingAgent     — semantic similarity indexing + search
 *   MetadataNormalizationAgent — parse + normalise metadata.json
 *   SchemaIntelligenceAgent  — maintain schema graph
 *   DatasetBuilderAgent      — build + cache temporary datasets
 *   KPIEngineAgent           — execute live KPI queries + AI insights
 *   KPIDefinitionAgent       — manual KPI definitions + registry
 */

import { eventBus, type SystemEventName, type SystemEventPayload } from "./EventBus";

// ── Agent interface ───────────────────────────────────────────────────────────

export interface Agent<TInput = unknown, TOutput = unknown> {
  name: string;
  run(input: TInput): Promise<TOutput>;
}

// ── Execution trace ───────────────────────────────────────────────────────────

export interface AgentRunEvent {
  agent:     string;
  status:    "running" | "ok" | "error";
  durationMs: number;
  input?:    unknown;
  output?:   unknown;
  error?:    string;
  timestamp: string;
}

export interface AgentOfAgentsResult<T = unknown> {
  agent:     string;
  output:    T;
  trace:     AgentRunEvent[];
  totalMs:   number;
  success:   boolean;
  error?:    string;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class AgentOfAgents {
  private agents: Map<string, Agent> = new Map();

  /** Register an agent so it can be dispatched by name. */
  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  /** List all registered agent names. */
  list(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Execute a named agent and emit a completion event.
   * Returns a structured result with trace + timing.
   */
  async execute<TOutput = unknown>(
    agentName: string,
    input: unknown
  ): Promise<AgentOfAgentsResult<TOutput>> {
    const trace: AgentRunEvent[] = [];
    const totalStart = Date.now();

    const agent = this.agents.get(agentName);
    if (!agent) {
      return {
        agent:   agentName,
        output:  undefined as TOutput,
        trace,
        totalMs: 0,
        success: false,
        error:   `Agent "${agentName}" not found. Registered: ${this.list().join(", ")}`,
      };
    }

    const start = Date.now();
    trace.push({
      agent: agentName, status: "running",
      durationMs: 0, input,
      timestamp: new Date().toISOString(),
    });

    try {
      const output = (await agent.run(input)) as TOutput;
      const durationMs = Date.now() - start;

      trace.push({
        agent: agentName, status: "ok",
        durationMs, output,
        timestamp: new Date().toISOString(),
      });

      // Emit completion event
      const eventName = `${agentName}_COMPLETED` as SystemEventName;
      if (eventBus.eventNames().includes(eventName)) {
        eventBus.emit(eventName, output as SystemEventPayload<typeof eventName>);
      }

      return {
        agent: agentName,
        output,
        trace,
        totalMs: Date.now() - totalStart,
        success: true,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);

      trace.push({
        agent: agentName, status: "error",
        durationMs, error,
        timestamp: new Date().toISOString(),
      });

      return {
        agent: agentName,
        output: undefined as TOutput,
        trace,
        totalMs: Date.now() - totalStart,
        success: false,
        error,
      };
    }
  }

  /**
   * Execute a sequence of agents in order, passing each output as the
   * next agent's input. Stops on first failure.
   */
  async pipeline(
    steps: { agent: string; input?: unknown; transform?: (prev: unknown) => unknown }[]
  ): Promise<AgentOfAgentsResult[]> {
    const results: AgentOfAgentsResult[] = [];
    let previousOutput: unknown = undefined;

    for (const step of steps) {
      const input = step.transform
        ? step.transform(previousOutput)
        : (step.input ?? previousOutput);

      const result = await this.execute(step.agent, input);
      results.push(result);

      if (!result.success) break;
      previousOutput = result.output;
    }

    return results;
  }
}

// ── Singleton registry ────────────────────────────────────────────────────────

const _global = globalThis as typeof globalThis & { __agentOfAgents?: AgentOfAgents };
if (!_global.__agentOfAgents) {
  _global.__agentOfAgents = new AgentOfAgents();
}

export const agentRegistry: AgentOfAgents = _global.__agentOfAgents;
