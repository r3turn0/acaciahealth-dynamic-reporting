import type { AssetType, CatalogAsset, CatalogIndexHealth, CatalogSearchResult } from "@/lib/discovery/catalog";

export interface SearchEvidence {
  field: "name" | "description" | "tags" | "lineage" | "relationships" | "source" | "owner" | "location";
  term: string;
  excerpt: string;
  weight: number;
}

export interface IndexedCatalogSearchResult extends CatalogSearchResult {
  evidence: SearchEvidence[];
}

export interface SearchTiming {
  indexBuildMs: number;
  retrievalMs: number;
  totalMs: number;
}

export interface SearchExecution {
  results: IndexedCatalogSearchResult[];
  cacheHit: boolean;
  timing: SearchTiming;
  index: CatalogIndexHealth;
}

interface IndexedField {
  field: SearchEvidence["field"];
  value: string;
  tokens: Set<string>;
  weight: number;
}

interface IndexedAsset {
  asset: CatalogAsset;
  fields: IndexedField[];
}

interface IndexSnapshot {
  builtAt: string;
  assets: CatalogAsset[];
  documents: IndexedAsset[];
  countsByType: Partial<Record<AssetType, number>>;
}

const VIRTUAL_NOTICE = "Process-local deterministic search index; evidence is derived from governed metadata and virtual registries and is never written to the database.";
const CACHE_TTL_MS = 30_000;
const MAX_QUERY_CACHE = 100;
const TYPE_WEIGHT: Record<AssetType, number> = {
  dataset: 0.1, table: 0.09, column: 0.04, measure: 0.06, kpi: 0.12,
  report: 0.08, dashboard: 0.04, query: 0.02, template: 0.02,
  validation: 0.03, scorecard: 0.04, agent: 0.01, glossary: 0.07,
  relationship: 0.03,
};
const FIELD_WEIGHTS: Record<SearchEvidence["field"], number> = {
  name: 1,
  tags: 0.82,
  description: 0.72,
  lineage: 0.68,
  relationships: 0.66,
  source: 0.55,
  location: 0.5,
  owner: 0.35,
};
const SYNONYMS: Record<string, string[]> = {
  adc: ["average daily census", "occupancy", "patient days"],
  admissions: ["start of care", "soc", "new admissions"],
  recert: ["recertification", "cert period"],
  revenue: ["billing", "charges", "payments", "rppd"],
  clinician: ["worker", "discipline", "staff"],
  branch: ["location", "region", "office"],
  ntuc: ["not taken under care", "non admit"],
  patient: ["client", "member"],
  visit: ["encounter", "appointment"],
};

let snapshot: IndexSnapshot | null = null;
let snapshotExpiresAt = 0;
const queryCache = new Map<string, { expiresAt: number; results: IndexedCatalogSearchResult[] }>();

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter((token) => token.length > 1);
}

function expandTerms(query: string): Set<string> {
  const normalized = normalize(query);
  const terms = new Set(tokenize(normalized));
  for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
    if (normalized.includes(canonical) || aliases.some((alias) => normalized.includes(alias))) {
      terms.add(canonical);
      for (const alias of aliases) for (const token of tokenize(alias)) terms.add(token);
    }
  }
  return terms;
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else { leftIndex += 1; rightIndex += 1; }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function tokenMatches(term: string, candidate: string) {
  if (candidate === term || candidate.startsWith(term) || term.startsWith(candidate)) return true;
  return term.length >= 4 && candidate.length >= 4 && editDistanceAtMostOne(term, candidate);
}

function field(field: IndexedField["field"], values: string | string[]): IndexedField {
  const value = Array.isArray(values) ? values.filter(Boolean).join(" · ") : values;
  return { field, value, tokens: new Set(tokenize(value)), weight: FIELD_WEIGHTS[field] };
}

function indexAsset(asset: CatalogAsset): IndexedAsset {
  return {
    asset,
    fields: [
      field("name", asset.name),
      field("description", asset.description),
      field("tags", asset.tags),
      field("lineage", asset.lineage),
      field("relationships", asset.related),
      field("source", asset.source),
      field("owner", asset.owner),
      field("location", asset.location),
    ],
  };
}

function createSnapshot(assets: CatalogAsset[]): IndexSnapshot {
  const countsByType: Partial<Record<AssetType, number>> = {};
  for (const asset of assets) countsByType[asset.type] = (countsByType[asset.type] ?? 0) + 1;
  return { builtAt: new Date().toISOString(), assets, documents: assets.map(indexAsset), countsByType };
}

export function invalidateSearchIndex() {
  snapshot = null;
  snapshotExpiresAt = 0;
  queryCache.clear();
}

async function getSnapshot(buildAssets: () => Promise<CatalogAsset[]>): Promise<{ value: IndexSnapshot; cacheHit: boolean; buildMs: number }> {
  const startedAt = nowMs();
  if (snapshot && Date.now() < snapshotExpiresAt) return { value: snapshot, cacheHit: true, buildMs: nowMs() - startedAt };
  snapshot = createSnapshot(await buildAssets());
  snapshotExpiresAt = Date.now() + CACHE_TTL_MS;
  queryCache.clear();
  return { value: snapshot, cacheHit: false, buildMs: nowMs() - startedAt };
}

function excerptFor(value: string, term: string) {
  const normalizedValue = normalize(value);
  const index = normalizedValue.indexOf(term);
  if (index < 0) return value.slice(0, 140);
  return normalizedValue.slice(Math.max(0, index - 45), Math.min(normalizedValue.length, index + term.length + 85));
}

function rankDocument(document: IndexedAsset, rawQuery: string, terms: Set<string>): IndexedCatalogSearchResult | null {
  const evidence: SearchEvidence[] = [];
  const matchedTerms = new Set<string>();
  let weightedMatches = 0;
  for (const indexedField of document.fields) {
    for (const term of terms) {
      if (![...indexedField.tokens].some((candidate) => tokenMatches(term, candidate))) continue;
      matchedTerms.add(term);
      weightedMatches += indexedField.weight;
      if (evidence.length < 8) evidence.push({ field: indexedField.field, term, excerpt: excerptFor(indexedField.value, term), weight: indexedField.weight });
    }
  }
  if (matchedTerms.size === 0) return null;
  const normalizedName = normalize(document.asset.name);
  const normalizedQuery = normalize(rawQuery);
  const coverage = matchedTerms.size / Math.max(terms.size, 1);
  const exactName = normalizedName === normalizedQuery ? 0.35 : 0;
  const namePhrase = normalizedName.includes(normalizedQuery) ? 0.2 : 0;
  const weighted = weightedMatches / Math.max(terms.size * 2.5, 1);
  const governance = document.asset.certified ? 0.04 : 0;
  const score = Math.min(0.99, exactName + namePhrase + coverage * 0.34 + weighted * 0.25 + TYPE_WEIGHT[document.asset.type] + governance);
  return { ...document.asset, score, matchedTerms: [...matchedTerms], evidence: evidence.sort((left, right) => right.weight - left.weight) };
}

function health(index: IndexSnapshot): CatalogIndexHealth {
  return {
    scope: "process",
    authoritative: false,
    builtAt: index.builtAt,
    assetCount: index.assets.length,
    countsByType: index.countsByType,
    status: index.assets.length > 0 ? "healthy" : "empty",
    notice: VIRTUAL_NOTICE,
  };
}

export async function searchIndex(
  query: string,
  types: AssetType[] | undefined,
  limit: number,
  buildAssets: () => Promise<CatalogAsset[]>,
): Promise<SearchExecution> {
  const totalStartedAt = nowMs();
  const indexed = await getSnapshot(buildAssets);
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const key = `${normalize(query)}|${(types ?? []).slice().sort().join(",")}|${safeLimit}`;
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { results: cached.results, cacheHit: true, timing: { indexBuildMs: indexed.buildMs, retrievalMs: 0, totalMs: nowMs() - totalStartedAt }, index: health(indexed.value) };
  }
  const retrievalStartedAt = nowMs();
  const terms = expandTerms(query);
  const results = indexed.value.documents
    .filter((document) => !types?.length || types.includes(document.asset.type))
    .map((document) => rankDocument(document, query, terms))
    .filter((result): result is IndexedCatalogSearchResult => result !== null)
    .sort((left, right) => right.score - left.score || Number(right.certified) - Number(left.certified) || left.name.localeCompare(right.name))
    .slice(0, safeLimit);
  queryCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
  if (queryCache.size > MAX_QUERY_CACHE) queryCache.delete(queryCache.keys().next().value!);
  return {
    results,
    cacheHit: indexed.cacheHit,
    timing: { indexBuildMs: indexed.buildMs, retrievalMs: nowMs() - retrievalStartedAt, totalMs: nowMs() - totalStartedAt },
    index: health(indexed.value),
  };
}

export async function getSearchIndexHealth(buildAssets: () => Promise<CatalogAsset[]>): Promise<CatalogIndexHealth> {
  return health((await getSnapshot(buildAssets)).value);
}
