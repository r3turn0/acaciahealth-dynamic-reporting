export const ASSET_TYPES = ["dataset", "table", "column", "measure", "kpi", "report", "dashboard", "query", "template", "validation", "scorecard", "agent", "glossary"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type CatalogAsset = { id: string; type: AssetType; name: string; description: string; tags: string[]; location: string; related: string[] };

export const healthcareAssets: CatalogAsset[] = [
  { id: "kpi-adc", type: "kpi", name: "Average Daily Census (ADC)", description: "Average active patient census by day and branch.", tags: ["adc", "census", "patient days", "occupancy"], location: "KPI Catalog / Clinical Operations", related: ["daily-census", "col-patient-days"] },
  { id: "daily-census", type: "dataset", name: "Daily Census", description: "Validated daily patient census facts by branch, episode, and service date.", tags: ["census", "patient", "branch", "episode"], location: "Dataset Builder / Clinical", related: ["kpi-adc", "col-patient-days"] },
  { id: "col-patient-days", type: "column", name: "PatientDays", description: "Count of covered patient service days used by ADC and revenue-per-patient-day.", tags: ["patient days", "adc", "revenue"], location: "dbo.DailyCensus.PatientDays", related: ["kpi-adc", "kpi-rppd"] },
  { id: "kpi-admissions", type: "kpi", name: "Admissions", description: "New admissions by start-of-care date, branch, and care type.", tags: ["admission", "start of care", "soc", "growth"], location: "KPI Catalog / Growth", related: ["report-recert", "col-admission-date"] },
  { id: "col-admission-date", type: "column", name: "AdmissionDate", description: "Admission or start-of-care date for an episode.", tags: ["admission", "date", "soc"], location: "dbo.ClientEpisodes.AdmissionDate", related: ["kpi-admissions"] },
  { id: "report-recert", type: "report", name: "Recertification Due Report", description: "Patients approaching recertification, grouped by branch and due date.", tags: ["recert", "report", "branch"], location: "Reports / Clinical Compliance", related: ["kpi-recert"] },
  { id: "kpi-recert", type: "kpi", name: "Recertification Compliance", description: "Share of eligible episodes recertified before the due date.", tags: ["recert", "compliance", "episode"], location: "KPI Catalog / Compliance", related: ["report-recert"] },
  { id: "kpi-rppd", type: "kpi", name: "Revenue Per Patient Day", description: "Net revenue divided by patient days with branch-level trending.", tags: ["revenue", "patient days", "rppd"], location: "KPI Catalog / Finance", related: ["col-patient-days", "measure-revenue"] },
  { id: "measure-revenue", type: "measure", name: "Net Revenue", description: "Allowed revenue less contractual adjustments and reversals.", tags: ["revenue", "finance", "collections"], location: "Finance Semantic Model", related: ["kpi-rppd"] },
  { id: "validation-adc", type: "validation", name: "ADC Must Not Be Negative", description: "Data quality rule requiring calculated ADC to be zero or greater.", tags: ["adc", "quality", "negative"], location: "Validation Rules / Census", related: ["kpi-adc"] },
  { id: "agent-kpi", type: "agent", name: "KPI Detection Agent", description: "Classifies healthcare metrics, identifies thresholds, and registers KPI opportunities.", tags: ["agent", "kpi", "classification"], location: "Agent Registry", related: ["kpi-adc", "kpi-admissions"] },
  { id: "glossary-ntuc", type: "glossary", name: "NTUC", description: "Not Taken Under Care: referrals not converted into an admission.", tags: ["ntuc", "referrals", "non-admit"], location: "Business Glossary", related: [] },
  { id: "dashboard-executive", type: "dashboard", name: "Executive Census & Growth", description: "Census, ADC, admissions, referral conversion, and revenue trends.", tags: ["executive", "census", "growth", "revenue"], location: "Dashboards / Executive", related: ["kpi-adc", "kpi-admissions"] },
  { id: "scorecard-bp1", type: "scorecard", name: "BP1 Compliance Scorecard", description: "Operational compliance scorecard by branch and reporting period.", tags: ["bp1", "compliance", "branch"], location: "Scorecards / Quality", related: [] },
  { id: "template-variance", type: "template", name: "KPI Variance Investigation", description: "SQL template for actual-versus-expected KPI variance analysis.", tags: ["sql", "variance", "kpi"], location: "SQL Templates", related: ["kpi-adc"] },
];

const synonyms: Record<string, string[]> = { adc: ["average daily census", "occupancy"], admissions: ["start of care", "soc", "new admissions"], recert: ["recertification"], duplicate: ["duplicated", "duplicates"], patientdays: ["patient days", "service days"] };
export function lexicalCatalogSearch(query: string, types?: AssetType[]) {
  const raw = query.toLowerCase().trim();
  const expanded = new Set(raw.split(/\W+/).filter(Boolean));
  for (const [term, values] of Object.entries(synonyms)) if (raw.includes(term) || values.some((v) => raw.includes(v))) { expanded.add(term); values.forEach((v) => v.split(/\W+/).forEach((token) => expanded.add(token))); }
  return healthcareAssets.filter((asset) => !types?.length || types.includes(asset.type)).map((asset) => {
    const haystack = `${asset.name} ${asset.description} ${asset.tags.join(" ")} ${asset.location}`.toLowerCase();
    const hits = [...expanded].filter((token) => token.length > 1 && haystack.includes(token)).length;
    const exact = haystack.includes(raw) ? 0.5 : 0;
    return { ...asset, score: Math.min(0.99, exact + hits / Math.max(expanded.size, 1) * 0.49), matchedTerms: [...expanded].filter((token) => haystack.includes(token)) };
  }).filter((asset) => asset.score > 0).sort((a, b) => b.score - a.score);
}
