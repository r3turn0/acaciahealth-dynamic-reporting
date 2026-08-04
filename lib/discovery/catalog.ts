export const ASSET_TYPES = ["dataset", "table", "column", "measure", "kpi", "report", "dashboard", "query", "template", "validation", "scorecard", "agent", "glossary"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type CatalogAsset = { id: string; type: AssetType; name: string; description: string; tags: string[]; location: string; related: string[] };

const physicalMetadataAssets: CatalogAsset[] = [
  { id: "table-dbo-client-episodes-all", type: "table", name: "CLIENT_EPISODES_ALL", description: "Core episode grain with start of care, discharge, branch, service line, payor, and recertification fields.", tags: ["episodes", "patient", "admissions", "census", "recert"], location: "dbo.CLIENT_EPISODES_ALL", related: ["column-dbo-client-episodes-all-epi-id", "column-dbo-client-episodes-all-epi-socdate"] },
  { id: "column-dbo-client-episodes-all-epi-id", type: "column", name: "epi_id", description: "Stable episode identifier and primary join key for visit, billing, and PDGM facts.", tags: ["episode id", "primary key", "join"], location: "dbo.CLIENT_EPISODES_ALL.epi_id", related: ["table-dbo-client-episodes-all"] },
  { id: "column-dbo-client-episodes-all-epi-socdate", type: "column", name: "epi_SocDate", description: "Start-of-care date used to calculate admissions.", tags: ["soc", "start of care", "admission date"], location: "dbo.CLIENT_EPISODES_ALL.epi_SocDate", related: ["table-dbo-client-episodes-all", "kpi-admissions"] },
  { id: "table-dbo-client-episode-visits-all", type: "table", name: "CLIENT_EPISODE_VISITS_ALL", description: "Visit-level facts linked to episodes, workers, disciplines, service dates, and productivity points.", tags: ["visits", "workers", "productivity", "service date"], location: "dbo.CLIENT_EPISODE_VISITS_ALL", related: ["table-dbo-client-episodes-all"] },
  { id: "table-dbo-branches", type: "table", name: "BRANCHES", description: "Governed branch dimension containing code, name, county, state, and region.", tags: ["branch", "region", "county", "dimension"], location: "dbo.BRANCHES", related: ["table-dbo-client-episodes-all"] },
  { id: "column-dbo-branches-branch-code", type: "column", name: "branch_code", description: "Stable branch business key used by episode and workforce joins.", tags: ["branch", "code", "join key"], location: "dbo.BRANCHES.branch_code", related: ["table-dbo-branches"] },
  { id: "table-billing-line-items", type: "table", name: "LINE_ITEMS", description: "Billing line-item facts with episode, invoice, charge, paid amount, and claim status.", tags: ["billing", "revenue", "claims", "payments"], location: "Billing.LINE_ITEMS", related: ["table-dbo-client-episodes-all"] },
  { id: "column-billing-line-items-li-amount", type: "column", name: "li_amount", description: "Billed line-item amount used in revenue measures.", tags: ["revenue", "amount", "charge"], location: "Billing.LINE_ITEMS.li_amount", related: ["measure-revenue"] },
  { id: "table-dbo-pdgm-period", type: "table", name: "PDGM_PERIOD", description: "PDGM 30-day period facts including HIPPS, period number, LUPA status, and reimbursement type.", tags: ["pdgm", "lupa", "hipps", "reimbursement"], location: "dbo.PDGM_PERIOD", related: ["table-dbo-client-episodes-all"] },
  { id: "table-dbo-worker-base", type: "table", name: "WORKER_BASE", description: "Clinician and staff dimension used for visit and productivity analysis.", tags: ["worker", "clinician", "discipline", "productivity"], location: "dbo.WORKER_BASE", related: ["table-dbo-client-episode-visits-all", "table-dbo-branches"] },
];

export const healthcareAssets: CatalogAsset[] = [
  ...physicalMetadataAssets,
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
