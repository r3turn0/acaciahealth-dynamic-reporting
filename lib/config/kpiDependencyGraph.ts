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
  avg_days_referral_to_admission: { required: [], optional: ["admissions", "referrals_received"], reportKpis: ["avg_days_referral_to_admission"] },
  admissions_within_2_days: { required: ["admissions"], optional: ["avg_days_referral_to_admission"], reportKpis: ["avg_days_referral_to_admission", "admissions"] },
  referral_conversion_rate: { required: ["admissions", "referrals_received"], optional: ["avg_days_referral_to_admission"], reportKpis: ["referrals_ntuc", "admissions"] },
  referrals_received: { required: [], optional: ["admissions", "avg_days_referral_to_admission"], reportKpis: ["referrals_ntuc"] },
  ntuc: { required: [], optional: ["referrals_received", "admissions"], reportKpis: ["referrals_ntuc"] },
  hospice_census_equivalent_by_branch: { required: ["patient_days"], optional: ["hospice_census_equivalent"], reportKpis: ["hospice_census_equivalent"] },
  enterprise_total_hce: { required: ["patient_days"], optional: ["hospice_census_equivalent_by_branch", "hh_palliative_combined_hce"], reportKpis: ["hospice_census_equivalent"] },
  implied_average_daily_census: { required: ["patient_days"], optional: ["average_daily_census"], reportKpis: ["patient_days", "current_census_by_service_line_branch"] },
  admissions_by_care_type: { required: ["admissions"], optional: [], reportKpis: ["admissions"] },
  average_daily_census_by_service_line_branch: { required: ["patient_days"], optional: ["current_census_by_service_line_branch"], reportKpis: ["current_census_by_service_line_branch", "patient_days"] },
  daily_census: { required: ["current_census"], optional: ["patient_days"], reportKpis: ["current_census_by_service_line_branch"] },
  daily_census_trend: { required: ["daily_census"], optional: ["admissions", "discharges"], reportKpis: ["current_census_by_service_line_branch"] },
  qa_compliance: { required: [], optional: ["visit_notes_activity"], reportKpis: ["qa_compliance"] },
  bp1_compliance_within_48hrs: { required: ["admissions"], optional: ["qa_compliance"], reportKpis: ["bp1_compliance_within_48hrs"] },
  billing_holds: { required: [], optional: ["unbilled_revenue", "ar_aging"], reportKpis: ["billing_holds"] },
  unbilled_revenue: { required: [], optional: ["billing_holds", "revenue"], reportKpis: ["ar_aging"] },
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
