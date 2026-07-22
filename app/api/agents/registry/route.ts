/**
 * /api/agents/registry
 *
 * Full CRUD for the Agent Registry.
 *
 * GET    /api/agents/registry             — list all agents (snapshot)
 * POST   /api/agents/registry             — registerAgent (create or update)
 * PATCH  /api/agents/registry             — updateAgent (partial update)
 * DELETE /api/agents/registry             — removeAgent
 *
 * Query params for GET:
 *   domain   — filter by domain
 *   enabled  — "true" | "false"
 *   tag      — filter by tag
 *   name     — get a specific agent name (all versions)
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { agentRegistryStore, type AgentDomain } from "@/lib/orchestrator/AgentRegistryStore";

// Ensure store is seeded
import "@/lib/orchestrator/AgentRegistryStore";
// Ensure legacy agents are still registered on the AgentOfAgents registry
import "@/lib/orchestrator/eventWiring";
import "@/lib/agents/VectorEmbeddingAgent";
import "@/lib/agents/MetadataNormalizationAgent";
import "@/lib/agents/KPIEngineAgent";
import "@/lib/agents/KPIDefinitionAgent";
import "@/lib/agents/RelationshipBuilderAgent";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const domain  = searchParams.get("domain")  as AgentDomain | null;
  const enabled = searchParams.get("enabled");
  const tag     = searchParams.get("tag");
  const name    = searchParams.get("name");

  if (name) {
    const versions = agentRegistryStore.listByName(name);
    if (versions.length === 0) {
      return NextResponse.json({ error: `Agent "${name}" not found` }, { status: 404 });
    }
    return NextResponse.json({ name, versions, count: versions.length });
  }

  const filter: Parameters<typeof agentRegistryStore.list>[0] = {};
  if (domain)          filter.domain  = domain;
  if (enabled !== null) filter.enabled = enabled === "true";
  if (tag)             filter.tag     = tag;

  const snapshot = agentRegistryStore.snapshot();
  const filtered = agentRegistryStore.list(Object.keys(filter).length > 0 ? filter : undefined);

  return NextResponse.json({
    agents:       filtered,
    count:        filtered.length,
    enabledCount: filtered.filter((a) => a.enabled).length,
    totalCount:   snapshot.totalCount,
    generatedAt:  snapshot.generatedAt,
    version:      snapshot.version,
  });
}

// ── POST ——— registerAgent ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, version, description, domain, runtime: agentRuntime, dependencies, tags,
          enabled, isActiveVersion, featureFlag, abVariants, config, registeredBy } = body;

  if (!name || !version || !description || !domain) {
    return NextResponse.json(
      { error: "name, version, description, and domain are required" },
      { status: 400 }
    );
  }

  const reg = agentRegistryStore.registerAgent({
    name:            String(name),
    version:         String(version),
    description:     String(description),
    domain:          domain as AgentDomain,
    runtime:         (agentRuntime as "nodejs" | "edge" | "worker" | "external") ?? "nodejs",
    dependencies:    Array.isArray(dependencies) ? (dependencies as string[]) : [],
    tags:            Array.isArray(tags) ? (tags as string[]) : [],
    enabled:         enabled !== false,
    isActiveVersion: Boolean(isActiveVersion ?? true),
    featureFlag:     featureFlag ? String(featureFlag) : undefined,
    abVariants:      Array.isArray(abVariants) ? abVariants : [],
    config:          (config as Record<string, unknown>) ?? {},
    registeredBy:    String(registeredBy ?? "api"),
  });

  return NextResponse.json({ agent: reg, registered: true }, { status: 201 });
}

// ── PATCH ——— updateAgent ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, version, ...patch } = body;

  if (!name || !version) {
    return NextResponse.json({ error: "name and version are required" }, { status: 400 });
  }

  // Handle swap (promote version)
  if (patch.swapToActive) {
    const swapped = agentRegistryStore.swapAgent(String(name), String(version));
    if (!swapped) {
      return NextResponse.json({ error: `Agent "${name}@${version}" not found` }, { status: 404 });
    }
    return NextResponse.json({ agent: swapped, swapped: true });
  }

  // Handle enable/disable shortcut
  if (typeof patch.enabled === "boolean") {
    patch.enabled
      ? agentRegistryStore.enableAgent(String(name), String(version))
      : agentRegistryStore.disableAgent(String(name), String(version));
    const updated = agentRegistryStore.get(String(name), String(version));
    return NextResponse.json({ agent: updated, updated: true });
  }

  // Handle A/B variants shortcut
  if (Array.isArray(patch.abVariants)) {
    const updated = agentRegistryStore.setABVariants(String(name), String(version), patch.abVariants);
    if (!updated) return NextResponse.json({ error: `Agent "${name}@${version}" not found` }, { status: 404 });
    return NextResponse.json({ agent: updated, updated: true });
  }

  const updated = agentRegistryStore.updateAgent(String(name), String(version), patch as Parameters<typeof agentRegistryStore.updateAgent>[2]);
  if (!updated) {
    return NextResponse.json({ error: `Agent "${name}@${version}" not found` }, { status: 404 });
  }

  return NextResponse.json({ agent: updated, updated: true });
}

// ── DELETE ——— removeAgent ────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const name    = searchParams.get("name");
  const version = searchParams.get("version") ?? undefined;

  if (!name) {
    return NextResponse.json({ error: "name query param is required" }, { status: 400 });
  }

  const removed = agentRegistryStore.removeAgent(name, version);
  if (!removed) {
    return NextResponse.json({ error: `Agent "${name}" not found` }, { status: 404 });
  }

  return NextResponse.json({ removed: true, name, version: version ?? "all" });
}
