import { NextRequest, NextResponse } from "next/server";
import baseConfig from "@/lib/config/kpiConfig.json";
import scorecardDiscovery from "@/lib/config/scorecardDiscovery.json";

// ── In-memory registry ─────────────────────────────────────────────────────────
// In production this would persist to a DB. For now it starts from kpiConfig.json
// and accepts mutations for the session lifetime.

type KpiStatus = "Draft" | "Validated" | "Approved" | "Published" | "Archived";
type KpiDef = Record<string, unknown> & {
  label: string;
  category: string;
  version: string;
  status: KpiStatus;
  formula: string;
  source: string;
  dimensions: string[];
  parameters: Record<string, unknown>;
  filters: Record<string, unknown>;
  location_key: string;
  service_line_field: string;
  active_service_lines: string[];
  description: string;
  owner?: string;
  steward?: string;
  grain?: string;
  sourceColumns?: string[];
  dependencies?: string[];
  aliases?: string[];
  discoveryState?: "Configured" | "Discovered";
  provenance?: Record<string, unknown>;
  validation?: {
    status: "validated" | "partial" | "unverified";
    confidence: number;
    variance: number | null;
    reason: string;
    lastRun?: string;
  };
  _meta?: {
    createdBy?: string;
    createdDate?: string;
    approvedBy?: string;
    approvedDate?: string;
    deployedDate?: string;
    changeLog?: string[];
  };
};

type Registry = {
  schemaVersion: string;
  effectiveDate: string;
  status: string;
  totalKpis: number;
  kpis: Record<string, KpiDef>;
  deploymentHistory: DeploymentRecord[];
};

type DeploymentRecord = {
  deploymentId: string;
  schemaVersion: string;
  deployedBy: string;
  deployedDate: string;
  target: string;
  status: string;
  kpiCount: number;
};

function normalizedKpiName(value: string): string {
  return value.toLowerCase().replace(/\b(avg|average|total|current)\b/g, "").replace(/[^a-z0-9]/g, "");
}

const configuredKpis = JSON.parse(JSON.stringify((baseConfig as { kpis: Record<string, unknown> }).kpis ?? {})) as Record<string, KpiDef>;
const configuredNames = new Set(Object.values(configuredKpis).map((definition) => normalizedKpiName(definition.label)));
for (const candidate of scorecardDiscovery.candidates) {
  if (configuredNames.has(normalizedKpiName(candidate.label))) continue;
  const id = configuredKpis[candidate.id] ? `scorecard_${candidate.id}` : candidate.id;
  configuredKpis[id] = {
    label: candidate.label,
    category: candidate.category,
    version: "0.1.0",
    status: "Draft",
    formula: candidate.formula,
    source: candidate.source,
    dimensions: candidate.dimensions,
    parameters: {},
    filters: {},
    location_key: "epi_branchcode",
    service_line_field: "epi_slid",
    active_service_lines: ["HOME HEALTH", "HOSPICE", "PRIVATE DUTY"],
    description: `${candidate.label} was discovered in the uploaded KPI scorecard and requires governed formula validation.`,
    owner: `${candidate.category} Owner`,
    steward: "Data Governance",
    grain: "Branch / reporting period",
    sourceColumns: candidate.sourceColumns,
    dependencies: [],
    aliases: candidate.aliases,
    discoveryState: "Discovered",
    provenance: candidate.provenance,
    validation: candidate.validation as KpiDef["validation"],
    _meta: { createdBy: "Source Documentation Agent", createdDate: scorecardDiscovery.generatedAt, changeLog: ["Discovered from KPI scorecard workbook"] },
  };
}

// Seed from static config plus non-certified scorecard discoveries.
const registry: Registry = {
  schemaVersion: (baseConfig._meta as { schemaVersion: string }).schemaVersion,
  effectiveDate: (baseConfig._meta as { updatedAt: string }).updatedAt,
  status: "Published",
  totalKpis: Object.keys(configuredKpis).length,
  kpis: configuredKpis,
  deploymentHistory: [
    {
      deploymentId: "deploy-001",
      schemaVersion: "6.0",
      deployedBy: "System",
      deployedDate: "2026-07-20T00:00:00Z",
      target: "Production",
      status: "Success",
      kpiCount: Object.keys((baseConfig as { kpis: Record<string, unknown> }).kpis ?? {}).length,
    },
  ],
};

const VALID_SOURCES = [
  "CLIENT_EPISODES_ALL",
  "CLIENT_EPISODE_VISIT_NOTES",
  "CLIENT_EPISODE_VISITS_ALL",
  "PDGM_PERIOD",
  "Billing.LINE_ITEMS",
  "WORKER_BASE",
];

const LIFECYCLE: Record<KpiStatus, KpiStatus[]> = {
  Draft:     ["Validated"],
  Validated: ["Approved"],
  Approved:  ["Published"],
  Published: ["Archived"],
  Archived:  [],
};

function validateKpi(id: string, def: Partial<KpiDef>): string[] {
  const errors: string[] = [];
  if (!def.label?.trim())        errors.push("label is required");
  if (!def.category?.trim())     errors.push("category is required");
  if (!def.formula?.trim())      errors.push("formula is required");
  if (!def.source?.trim())       errors.push("source is required");
  else if (!VALID_SOURCES.includes(def.source)) errors.push(`source '${def.source}' is not a registered fact table`);
  if (!def.dimensions?.length)   errors.push("at least one dimension is required");
  if (!def.location_key || def.location_key !== "epi_branchcode") errors.push("location_key must be epi_branchcode");
  if (!def.service_line_field || def.service_line_field !== "epi_slid") errors.push("service_line_field must be epi_slid");
  // Duplicate check (skip current id)
  const existing = Object.entries(registry.kpis).find(
    ([k, v]) => k !== id && v.label?.toLowerCase() === def.label?.toLowerCase()
  );
  if (existing) errors.push(`duplicate KPI label '${def.label}' already exists as '${existing[0]}'`);
  return errors;
}

function bumpVersion(ver: string, type: "major" | "minor" | "patch" = "minor"): string {
  const [maj, min, rev] = ver.split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${(rev ?? 0) + 1}`;
}

// ── GET — list / single / registry ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id       = searchParams.get("id");
  const action   = searchParams.get("action");
  const category = searchParams.get("category");
  const status   = searchParams.get("status");

  if (action === "registry") {
    return NextResponse.json({
      schemaVersion: registry.schemaVersion,
      effectiveDate: registry.effectiveDate,
      status: registry.status,
      totalKpis: Object.keys(registry.kpis).length,
      domains: Object.entries(
        Object.values(registry.kpis).reduce<Record<string, number>>((acc, k) => {
          acc[k.category] = (acc[k.category] ?? 0) + 1;
          return acc;
        }, {})
      ).map(([domain, count]) => ({ domain, count })),
      deploymentHistory: registry.deploymentHistory,
      discovery: {
        correlationId: scorecardDiscovery.correlationId,
        sourceFile: scorecardDiscovery.sourceFile,
        worksheetCount: scorecardDiscovery.worksheetCount,
        candidateCount: scorecardDiscovery.candidateCount,
        discoveredCount: Object.values(registry.kpis).filter((kpi) => kpi.discoveryState === "Discovered").length,
        generatedAt: scorecardDiscovery.generatedAt,
      },
    });
  }

  if (action === "parameters") {
    return NextResponse.json((baseConfig._meta as { sharedParameters: unknown }).sharedParameters ?? {});
  }

  if (action === "categories") {
    const cats = [...new Set(Object.values(registry.kpis).map((k) => k.category))].sort();
    return NextResponse.json(cats);
  }

  if (action === "diff") {
    const fromVersion = searchParams.get("from") ?? "5.0";
    const toVersion   = searchParams.get("to")   ?? registry.schemaVersion;
    // Return current schema as the authoritative diff
    return NextResponse.json({
      from: fromVersion,
      to: toVersion,
      added: Object.entries(registry.kpis)
        .filter(([, v]) => v.status !== "Archived")
        .map(([k, v]) => ({ id: k, label: v.label, category: v.category, version: v.version })),
      removed: [],
      modified: [],
    });
  }

  if (id) {
    const kpi = registry.kpis[id];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    return NextResponse.json({ id, ...kpi });
  }

  // List with optional filters
  let entries = Object.entries(registry.kpis);
  if (category) entries = entries.filter(([, v]) => v.category === category);
  if (status)   entries = entries.filter(([, v]) => v.status === status);

  return NextResponse.json({
    total: entries.length,
    kpis: entries.map(([id, def]) => ({ id, ...def })),
  });
}

// ── POST — create / clone / validate / publish / deploy / rollback ────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, id, kpiId, data, target, deployedBy, versionType } = body as {
    action: string;
    id?: string;
    kpiId?: string;
    data?: Partial<KpiDef>;
    target?: string;
    deployedBy?: string;
    versionType?: "major" | "minor" | "patch";
  };

  // ── CREATE ──────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (!id || !data) return NextResponse.json({ error: "id and data required" }, { status: 400 });
    if (registry.kpis[id]) return NextResponse.json({ error: `KPI '${id}' already exists` }, { status: 409 });
    const errors = validateKpi(id, data);
    if (errors.length) return NextResponse.json({ valid: false, errors }, { status: 422 });
    registry.kpis[id] = {
      label: "", category: "", version: "1.0.0", status: "Draft",
      formula: "", source: "", dimensions: [], parameters: {}, filters: {},
      location_key: "epi_branchcode", service_line_field: "epi_slid",
      active_service_lines: [], description: "",
      ...data,
      _meta: { createdBy: deployedBy ?? "Admin", createdDate: new Date().toISOString(), changeLog: ["Initial draft"] },
    };
    return NextResponse.json({ success: true, id, kpi: registry.kpis[id] }, { status: 201 });
  }

  // ── CLONE ───────────────────────────────────────────────────────────────────
  if (action === "clone") {
    if (!kpiId || !id) return NextResponse.json({ error: "kpiId and id (new id) required" }, { status: 400 });
    const source = registry.kpis[kpiId];
    if (!source) return NextResponse.json({ error: `KPI '${kpiId}' not found` }, { status: 404 });
    if (registry.kpis[id]) return NextResponse.json({ error: `Target id '${id}' already exists` }, { status: 409 });
    registry.kpis[id] = {
      ...JSON.parse(JSON.stringify(source)) as KpiDef,
      label: `${source.label} (Copy)`,
      status: "Draft",
      version: "1.0.0",
      _meta: { createdBy: deployedBy ?? "Admin", createdDate: new Date().toISOString(), changeLog: [`Cloned from ${kpiId}`] },
    };
    return NextResponse.json({ success: true, id, kpi: registry.kpis[id] });
  }

  // ── VALIDATE ─────────────────────────────────────────────────────────────────
  if (action === "validate") {
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const kpi = registry.kpis[id];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    const errors = validateKpi(id, data ?? kpi);
    if (errors.length) return NextResponse.json({ valid: false, errors });
    kpi.status = "Validated";
    return NextResponse.json({ valid: true, errors: [], id });
  }

  // ── APPROVE ──────────────────────────────────────────────────────────────────
  if (action === "approve") {
    const kpi = registry.kpis[id ?? ""];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    if (kpi.status !== "Validated") return NextResponse.json({ error: "KPI must be Validated before approval" }, { status: 422 });
    kpi.status = "Approved";
    kpi._meta = { ...kpi._meta, approvedBy: deployedBy ?? "Admin", approvedDate: new Date().toISOString() };
    return NextResponse.json({ success: true, id, status: kpi.status });
  }

  // ── PUBLISH ───────────────────────────────────────────────────────────────────
  if (action === "publish") {
    const kpi = registry.kpis[id ?? ""];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    if (kpi.status !== "Approved") return NextResponse.json({ error: "KPI must be Approved before publishing" }, { status: 422 });
    kpi.status = "Published";
    return NextResponse.json({ success: true, id, status: kpi.status });
  }

  // ── DEPLOY ────────────────────────────────────────────────────────────────────
  if (action === "deploy") {
    const deployTarget = target ?? "Production";
    const record: DeploymentRecord = {
      deploymentId: `deploy-${Date.now()}`,
      schemaVersion: registry.schemaVersion,
      deployedBy: deployedBy ?? "Admin",
      deployedDate: new Date().toISOString(),
      target: deployTarget,
      status: "Success",
      kpiCount: Object.values(registry.kpis).filter((k) => k.status === "Published").length,
    };
    registry.deploymentHistory.unshift(record);
    return NextResponse.json({ success: true, deployment: record });
  }

  // ── VERSION ───────────────────────────────────────────────────────────────────
  if (action === "version") {
    const kpi = registry.kpis[id ?? ""];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    const oldVer = kpi.version;
    kpi.version = bumpVersion(oldVer, versionType ?? "minor");
    kpi.status = "Draft";
    kpi._meta = { ...kpi._meta, changeLog: [...(kpi._meta?.changeLog ?? []), `Version bumped ${oldVer} → ${kpi.version}`] };
    return NextResponse.json({ success: true, id, oldVersion: oldVer, newVersion: kpi.version });
  }

  // ── ROLLBACK ──────────────────────────────────────────────────────────────────
  if (action === "rollback") {
    const kpi = registry.kpis[id ?? ""];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    kpi.status = "Archived";
    kpi._meta = { ...kpi._meta, changeLog: [...(kpi._meta?.changeLog ?? []), `Rolled back at ${new Date().toISOString()}`] };
    return NextResponse.json({ success: true, id, status: "Archived" });
  }

  // ── DEACTIVATE ────────────────────────────────────────────────────────────────
  if (action === "deactivate") {
    const kpi = registry.kpis[id ?? ""];
    if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
    kpi.status = "Archived";
    return NextResponse.json({ success: true, id, status: "Archived" });
  }

  // ── IMPORT ────────────────────────────────────────────────────────────────────
  if (action === "import") {
    if (!data || typeof data !== "object") return NextResponse.json({ error: "data (schema JSON) required" }, { status: 400 });
    const incoming = data as Record<string, KpiDef>;
    let imported = 0;
    for (const [k, def] of Object.entries(incoming)) {
      const errs = validateKpi(k, def);
      if (!errs.length) { registry.kpis[k] = def; imported++; }
    }
    return NextResponse.json({ success: true, imported, total: Object.keys(incoming).length });
  }

  return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
}

// ── PATCH — edit a KPI ────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const { id, data, versionBump } = await req.json().catch(() => ({})) as {
    id: string;
    data: Partial<KpiDef>;
    versionBump?: boolean;
  };
  if (!id || !data) return NextResponse.json({ error: "id and data required" }, { status: 400 });
  const kpi = registry.kpis[id];
  if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });

  const errors = validateKpi(id, { ...kpi, ...data });
  if (errors.length) return NextResponse.json({ valid: false, errors }, { status: 422 });

  const oldVersion = kpi.version;
  Object.assign(kpi, data);
  if (versionBump) kpi.version = bumpVersion(oldVersion, "patch");
  kpi.status = "Draft"; // edits reset to Draft
  kpi._meta = {
    ...kpi._meta,
    changeLog: [...(kpi._meta?.changeLog ?? []), `Updated at ${new Date().toISOString()}`],
  };
  return NextResponse.json({ success: true, id, kpi });
}

// ── DELETE — hard delete (Draft/Archived only) ────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const kpi = registry.kpis[id];
  if (!kpi) return NextResponse.json({ error: `KPI '${id}' not found` }, { status: 404 });
  if (!["Draft", "Archived"].includes(kpi.status)) {
    return NextResponse.json({ error: "Only Draft or Archived KPIs may be deleted" }, { status: 422 });
  }
  delete registry.kpis[id];
  return NextResponse.json({ success: true, id });
}
