import { createHash } from "crypto";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function buildCacheKey(prompt: string, filters: Record<string, unknown>): string {
  const raw = JSON.stringify({ prompt: prompt.toLowerCase().trim(), filters });
  return createHash("sha256").update(raw).digest("hex");
}

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number = TTL_MS): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateCache(key: string): void {
  cache.delete(key);
}

export function getCacheStats(): { size: number; keys: string[] } {
  // Purge expired entries first
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now > v.expiresAt) cache.delete(k);
  }
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
