export const VIRTUAL_CACHE_NOTICE =
  "Session-scoped virtual metadata only. Non-authoritative and rehydrated from governed read-only sources.";

export type VirtualAssetKind =
  | "report"
  | "semantic-dataset"
  | "kpi"
  | "validation"
  | "publication"
  | "search-index"
  | "prompt-health"
  | "report-audit";

export interface VirtualCacheMetadata {
  cacheScope: "process";
  virtual: true;
  authoritative: false;
  readOnlySource: true;
  rehydrationSource: string;
  notice: string;
}

export function virtualMetadata(rehydrationSource: string): VirtualCacheMetadata {
  return {
    cacheScope: "process",
    virtual: true,
    authoritative: false,
    readOnlySource: true,
    rehydrationSource,
    notice: VIRTUAL_CACHE_NOTICE,
  };
}

interface CacheEntry<T> {
  value: T;
  touchedAt: number;
}

const MAX_ENTRIES_PER_KIND = 1_000;
const globalCache = globalThis as typeof globalThis & {
  __acaciaVirtualAssets?: Map<VirtualAssetKind, Map<string, CacheEntry<unknown>>>;
};

const stores = globalCache.__acaciaVirtualAssets ?? new Map();
globalCache.__acaciaVirtualAssets = stores;

function storeFor(kind: VirtualAssetKind): Map<string, CacheEntry<unknown>> {
  const existing = stores.get(kind);
  if (existing) return existing;
  const created = new Map<string, CacheEntry<unknown>>();
  stores.set(kind, created);
  return created;
}

function trim(store: Map<string, CacheEntry<unknown>>): void {
  if (store.size <= MAX_ENTRIES_PER_KIND) return;
  const oldest = [...store.entries()]
    .sort(([, left], [, right]) => left.touchedAt - right.touchedAt)
    .slice(0, store.size - MAX_ENTRIES_PER_KIND);
  for (const [id] of oldest) store.delete(id);
}

export function setVirtualAsset<T>(kind: VirtualAssetKind, id: string, value: T): T {
  const store = storeFor(kind);
  store.set(id, { value, touchedAt: Date.now() });
  trim(store);
  return value;
}

export function getVirtualAsset<T>(kind: VirtualAssetKind, id: string): T | null {
  const entry = storeFor(kind).get(id);
  if (!entry) return null;
  entry.touchedAt = Date.now();
  return entry.value as T;
}

export function listVirtualAssets<T>(kind: VirtualAssetKind): T[] {
  return [...storeFor(kind).values()]
    .sort((left, right) => right.touchedAt - left.touchedAt)
    .map((entry) => entry.value as T);
}

export function deleteVirtualAsset(kind: VirtualAssetKind, id: string): boolean {
  return storeFor(kind).delete(id);
}

export function clearVirtualAssetsForTests(): void {
  stores.clear();
}
