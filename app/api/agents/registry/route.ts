/**
 * GET  /api/agents/registry
 * Returns the full list of registered agents + metadata.
 *
 * Used by the Agent Status panel in the UI to display which agents
 * are available, what they do, and whether they are healthy.
 */
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { agentRegistry } from "@/lib/orchestrator/AgentOfAgents";
import "@/lib/orchestrator/eventWiring";

// Side-effect imports ensure agents are registered before the handler runs
import "@/lib/agents/VectorEmbeddingAgent";
import "@/lib/agents/MetadataNormalizationAgent";
import "@/lib/agents/KPIEngineAgent";
import "@/lib/agents/KPIDefinitionAgent";
import "@/lib/agents/RelationshipBuilderAgent";

const AGENT_META: Record<string, { description: string; domain: string; version: string }> = {
  VectorEmbeddingAgent: {
    description: "Embeds metadata, columns, KPIs, and relationships for semantic similarity search.",
    domain:      "Semantic Intelligence Layer",
    version:     "1.0.0",
  },
  MetadataNormalizationAgent: {
    description: "Parses and normalises metadata.json into a canonical schema, emits SCHEMA_UPDATED.",
    domain:      "Metadata Engine",
    version:     "1.0.0",
  },
  KPIEngineAgent: {
    description: "Executes live KPI SQL queries, generates AI insights from results.",
    domain:      "KPI Intelligence",
    version:     "1.0.0",
  },
  KPIDefinitionAgent: {
    description: "Manual KPI registry — create, update, search, and bind reusable KPI definitions.",
    domain:      "KPI Definitions",
    version:     "1.0.0",
  },
  RelationshipBuilderAgent: {
    description: "Discovers table joins via metadata FKs, column-name heuristics, and vector semantic similarity. Generates validated JOIN SQL.",
    domain:      "Relationship Engine",
    version:     "1.0.0",
  },
};

export async function GET() {
  const agents = agentRegistry.list().map((name) => ({
    name,
    ...(AGENT_META[name] ?? { description: "Agent", domain: "System", version: "1.0.0" }),
    status: "ready",
  }));

  return NextResponse.json({
    agents,
    count:       agents.length,
    generatedAt: new Date().toISOString(),
  });
}
