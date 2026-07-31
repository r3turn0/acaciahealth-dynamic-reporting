import { createHash } from "crypto";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  bytes: number;
  namespace: string;
  tags: string[];
  lastAccessedAt: number;
}

export interface CacheOptions {
  ttlMs?: number;
  namespace?: string;
  tags?: string[];
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  expirations: number;
  coalesced: number;
  hitRatio: number | null;
  namespaces: Record<string, number>;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;
const MAX_ESTIMATED_BYTES = 32 * 1024 * 1024;

const globalForCache = globalThis as unknown as {
  __acaciaCache?: Map<string, CacheEntry<unknown>>;
  __acaciaCacheInflight?: Map<string, Promise<unknown>>;
  __acaciaCacheCounters?: Omit<CacheStats, "size" | "maxEntries" | "estimatedBytes" | "hitRatio" | "namespaces">;
};

const cache = globalForCache.__acaciaCache ?? new Map<string, CacheEntry<unknown>>();
const inflight = globalForCache.__acaciaCacheInflight ?? new Map<string, Promise<unknown>>();
const counters = globalForCache.__acaciaCacheCounters ?? {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
  expirations: 0,
  coalesced: 0,
};

globalForCache.__acaciaCache = cache;
globalForCache.__acaciaCacheInflight = inflight;
globalForCache.__acaciaCacheCounters = counters;

function estimateBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 1024;
  }
}

function purgeExpired(now = Date.now()): void {
  for (const [key, entry] of cache.entries()) {
    if (now >= entry.expiresAt) {
      cache.delete(key);
      counters.expirations++;
    }
  }
}

function currentBytes(): number {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  return total;
}

function enforceBounds(): void {
  purgeExpired();
  let bytes = currentBytes();
  while (cache.size > MAX_ENTRIES || bytes > MAX_ESTIMATED_BYTES) {
    let oldestKey: string | undefined;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    bytes -= cache.get(oldestKey)?.bytes ?? 0;
    cache.delete(oldestKey);
    counters.evictions++;
  }
}

export function buildCacheKey(
  prompt: string,
  filters: Record<string, unknown>,
  scope: { tenantId?: string; role?: string; userId?: string } = {}
): string {
  const raw = JSON.stringify({
    tenantId: scope.tenantId ?? "default",
    role: scope.role ?? "viewer",
    userId: scope.userId ?? "shared",
    prompt: prompt.toLowerCase().trim(),
    filters,
  });
  return createHash("sha256").update(raw).digest("hex");
}

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    counters.misses++;
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    counters.expirations++;
    counters.misses++;
    return null;
  }
  entry.lastAccessedAt = Date.now();
  cache.delete(key);
  cache.set(key, entry);
  counters.hits++;
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, options: number | CacheOptions = {}): void {
  const normalized = typeof options === "number" ? { ttlMs: options } : options;
  const ttlMs = Math.max(1_000, normalized.ttlMs ?? DEFAULT_TTL_MS);
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    bytes: estimateBytes(value),
    namespace: normalized.namespace ?? "default",
    tags: normalized.tags ?? [],
    lastAccessedAt: Date.now(),
  });
  counters.sets++;
  enforceBounds();
}

export async function withCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheOptions = {}
): Promise<{ value: T; cacheStatus: "HIT" | "MISS" | "COALESCED" }> {
  const cached = getCache<T>(key);
  if (cached !== null) return { value: cached, cacheStatus: "HIT" };

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    counters.coalesced++;
    return { value: await pending, cacheStatus: "COALESCED" };
  }

  const promise = loader();
  inflight.set(key, promise);
  try {
    const value = await promise;
    setCache(key, value, options);
    return { value, cacheStatus: "MISS" };
  } finally {
    inflight.delete(key);
  }
}

export function invalidateCache(key: string): void {
  cache.delete(key);
}

export function invalidateCacheByTag(tag: string): number {
  let removed = 0;
  for (const [key, entry] of cache.entries()) {
    if (entry.tags.includes(tag)) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function invalidateCacheNamespace(namespace: string): number {
  let removed = 0;
  for (const [key, entry] of cache.entries()) {
    if (entry.namespace === namespace) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function clearCache(): void {
  cache.clear();
  inflight.clear();
}

export function getCacheStats(): CacheStats {
  purgeExpired();
  const namespaces: Record<string, number> = {};
  for (const entry of cache.values()) {
    namespaces[entry.namespace] = (namespaces[entry.namespace] ?? 0) + 1;
  }
  const lookups = counters.hits + counters.misses;
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    estimatedBytes: currentBytes(),
    ...counters,
    hitRatio: lookups > 0 ? counters.hits / lookups : null,
    namespaces,
  };
}
