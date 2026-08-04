import kpiConfig from "@/lib/config/kpiConfig.json";
import semanticLayer from "@/lib/config/semanticLayer.json";

export interface KpiDependencyNode {
  key: string;
  label: string;
  formula: string;
  aliases: string[];
  required: string[];
  optional: string[];
  reportKpis: string[];
}

export interface ResolvedKpiGraph {
  root: KpiDependencyNode;
  nodes: KpiDependencyNode[];
  requiredKeys: string[];
  optionalKeys: string[];
  truncated: boolean;
}

type ConfigKpi = { label: string; formula?: string; description?: string };
const configuredKpis = kpiConfig.kpis as Record<string, ConfigKpi>;

const DEPENDENCIES: Record<string, Pick<KpiDependencyNode, "required" | "optional" | "reportKpis">> = {
  revenue: { required: ["patient_days"], optional: ["admissions", "current_census"], reportKpis: ["revenue"] },
  revenue_per_patient_day: { required: ["revenue", "patient_days"], optional: ["current_census"], reportKpis: ["revenue", "patient_days"] },
  current_census: { required: ["admissions", "discharges"], optional: ["patient_days"], reportKpis: ["current_census_by_service_line_branch"] },
  census: { required: ["admissions", "discharges"], optional: ["patient_days"], reportKpis: ["current_census_by_service_line_branch"] },
  average_daily_census: { required: ["patient_days"], optional: ["admissions", "discharges"], reportKpis: ["current_census_by_service_line_branch", "patient_days"] },
  admissions: { required: [], optional: ["referrals_received", "avg_days_referral_to_admission"], reportKpis: ["admissions"] },
  discharges: { required: [], optional: ["live_discharge_rate"], reportKpis: ["discharges"] },
  avg_length_of_stay: { required: [], optional: ["discharges", "current_census"], reportKpis: ["avg_length_of_stay"] },
  ar_aging: { required: [], optional: ["billing_holds", "unbilled_revenue"], reportKpis: ["ar_aging"] },
  recertifications: { required: [], optional: ["current_census"], reportKpis: ["recertifications"] },
  hospice_census_equivalent: { required: ["patient_days"], optional: ["average_daily_census"], reportKpis: ["hospice_census_equivalent"] },
  lupa_rate: { required: [], optional: ["calculated_lupa_exposure", "revenue_per_patient_day"], reportKpis: ["lupa_rate"] },
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function aliasesFor(key: string, label: string): string[] {
  const terminology = semanticLayer.terminology as Record<string, { label: string; aliases: string[] }>;
  const term = terminology[key];
  return [...new Set([key, label, normalize(label), ...(term?.aliases ?? [])])];
}

export function getKpiDependencyNode(key: string): KpiDependencyNode | null {
  const normalizedKey = normalize(key);
  const definition = configuredKpis[normalizedKey];
  if (!definition) return null;
  const dependency = DEPENDENCIES[normalizedKey] ?? { required: [], optional: [], reportKpis: [normalizedKey] };
  return {
    key: normalizedKey,
    label: definition.label,
    formula: definition.formula ?? definition.description ?? "Governed KPI definition",
    aliases: aliasesFor(normalizedKey, definition.label),
    required: dependency.required.filter((candidate) => Boolean(configuredKpis[candidate])),
    optional: dependency.optional.filter((candidate) => Boolean(configuredKpis[candidate])),
    reportKpis: dependency.reportKpis,
  };
}

export function resolveKpiDependencyGraph(key: string, options?: { maxDepth?: number; maxNodes?: number }): ResolvedKpiGraph | null {
  const root = getKpiDependencyNode(key);
  if (!root) return null;
  const maxDepth = options?.maxDepth ?? 3;
  const maxNodes = options?.maxNodes ?? 12;
  const nodes: KpiDependencyNode[] = [];
  const visited = new Set<string>();
  let truncated = false;

  function visit(nodeKey: string, depth: number): void {
    if (visited.has(nodeKey)) return;
    if (depth > maxDepth || nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    const node = getKpiDependencyNode(nodeKey);
    if (!node) return;
    visited.add(node.key);
    nodes.push(node);
    for (const dependency of [...node.required, ...node.optional]) visit(dependency, depth + 1);
  }

  visit(root.key, 0);
  return {
    root,
    nodes,
    requiredKeys: [...new Set(nodes.flatMap((node) => node.required))],
    optionalKeys: [...new Set(nodes.flatMap((node) => node.optional))],
    truncated,
  };
}

export function listAnalyzableKpis(): Array<{ key: string; label: string }> {
  return Object.entries(configuredKpis).map(([key, definition]) => ({ key, label: definition.label }));
}
