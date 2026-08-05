import { runQueryGateway } from "@/lib/gateway/QueryGateway";
import { validateReadOnlySql } from "@/lib/services/queryGuard";

export type PromptHealthStatus = "valid" | "degraded" | "broken";

export interface PromptDefinition {
  id: string;
  prompt: string;
  expectedKpis: string[];
  expectedTables: string[];
}

export interface PromptHealthResult extends PromptDefinition {
  status: PromptHealthStatus;
  lastValidatedAt: string;
  diagnostics: string[];
  generatedKpis: string[];
  generatedTables: string[];
}

export const REPORT_PROMPTS: PromptDefinition[] = [
  { id: "visits-month", prompt: "Show me patient visits by month for 2026", expectedKpis: ["visits"], expectedTables: ["CLIENT_EPISODE_VISITS_ALL"] },
  { id: "weekly-admissions", prompt: "Weekly admissions grouped by branch for the last 30 days", expectedKpis: ["admissions"], expectedTables: ["CLIENT_EPISODES_ALL", "BRANCHES"] },
  { id: "revenue-service-line", prompt: "Revenue by service line this quarter", expectedKpis: ["revenue"], expectedTables: ["LINE_ITEMS", "CLIENT_EPISODES_ALL"] },
  { id: "active-census", prompt: "Active patient census broken down by care type", expectedKpis: ["census"], expectedTables: ["CLIENT_EPISODES_ALL"] },
  { id: "branch-discharges", prompt: "Compare discharges by branch last 4 weeks", expectedKpis: ["discharges"], expectedTables: ["CLIENT_EPISODES_ALL", "BRANCHES"] },
  { id: "visits-discipline", prompt: "Average visits per patient by discipline this month", expectedKpis: ["visits"], expectedTables: ["CLIENT_EPISODE_VISITS_ALL"] },
];

const CACHE_TTL_MS = 15 * 60_000;
let cache: { checkedAt: number; results: PromptHealthResult[] } | null = null;

function normalized(values: string[]) {
  return values.map((value) => value.toUpperCase());
}

async function validatePrompt(definition: PromptDefinition): Promise<PromptHealthResult> {
  const diagnostics: string[] = [];
  try {
    const result = await runQueryGateway({
      query: definition.prompt,
      source: "natural_language",
      startDate: "2026-01-01",
      endDate: "2026-08-05",
      role: "analyst",
      planOnly: true,
    });
    const sqlValidation = validateReadOnlySql(result.sql);
    const generatedTables = result.lineage.tablesUsed;
    const generatedKpis = result.intent.requiredKpis;
    const tableSet = normalized(generatedTables);
    const kpiSet = normalized(generatedKpis);
    const missingTables = definition.expectedTables.filter((table) => !tableSet.some((actual) => actual.includes(table.toUpperCase())));
    const missingKpis = definition.expectedKpis.filter((kpi) => !kpiSet.some((actual) => actual.includes(kpi.toUpperCase())) && !result.sql.toUpperCase().includes(kpi.toUpperCase()));

    if (!sqlValidation.valid) diagnostics.push(...sqlValidation.errors);
    if (!result.validation.valid) diagnostics.push(...result.validation.errors);
    if (missingTables.length) diagnostics.push(`Expected source not resolved: ${missingTables.join(", ")}`);
    if (missingKpis.length) diagnostics.push(`Expected KPI not resolved: ${missingKpis.join(", ")}`);

    const status: PromptHealthStatus = !sqlValidation.valid || !result.validation.valid
      ? "broken"
      : missingTables.length || missingKpis.length
        ? "degraded"
        : "valid";

    return { ...definition, status, lastValidatedAt: new Date().toISOString(), diagnostics, generatedKpis, generatedTables };
  } catch {
    return {
      ...definition,
      status: "broken",
      lastValidatedAt: new Date().toISOString(),
      diagnostics: ["Generation or validation did not complete safely."],
      generatedKpis: [],
      generatedTables: [],
    };
  }
}

export async function getPromptHealth(force = false): Promise<PromptHealthResult[]> {
  if (!force && cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache.results;
  const results = await Promise.all(REPORT_PROMPTS.map(validatePrompt));
  cache = { checkedAt: Date.now(), results };
  return results;
}
