import { describe, it, expect } from "vitest";
import { formatReport } from "@/lib/services/formatter";
import {
  buildCacheKey,
  getCache,
  setCache,
  invalidateCache,
} from "@/lib/services/cache";

describe("formatReport", () => {
  const rows = [
    { branch_name: "North", admissions: 10 },
    { branch_name: "South", admissions: 30 },
  ];

  it("computes row count and columns", () => {
    const out = formatReport("Adm", {}, rows, "admissions", "SELECT ...");
    expect(out.summary.row_count).toBe(2);
    expect(out.summary.columns).toEqual(["branch_name", "admissions"]);
  });

  it("computes numeric aggregates for fully-numeric columns", () => {
    const out = formatReport("Adm", {}, rows, "admissions", "SELECT ...");
    expect(out.summary.aggregates?.total_admissions).toBe(40);
    expect(out.summary.aggregates?.avg_admissions).toBe(20);
    expect(out.summary.aggregates?.max_admissions).toBe(30);
    expect(out.summary.aggregates?.min_admissions).toBe(10);
  });

  it("handles empty data without throwing", () => {
    const out = formatReport("Empty", {}, [], "admissions", "SELECT ...");
    expect(out.summary.row_count).toBe(0);
    expect(out.summary.columns).toEqual([]);
    expect(out.summary.aggregates).toBeUndefined();
  });
});

describe("cache", () => {
  it("produces a stable key regardless of prompt casing/whitespace", () => {
    const a = buildCacheKey("Admissions By Branch ", { x: 1 });
    const b = buildCacheKey("admissions by branch", { x: 1 });
    expect(a).toBe(b);
  });

  it("stores and retrieves values", () => {
    const key = buildCacheKey("k1", {});
    setCache(key, { hello: "world" });
    expect(getCache<{ hello: string }>(key)).toEqual({ hello: "world" });
  });

  it("expires entries past their TTL", () => {
    const key = buildCacheKey("k2", {});
    setCache(key, { n: 1 }, -1); // already expired
    expect(getCache(key)).toBeNull();
  });

  it("invalidates a key", () => {
    const key = buildCacheKey("k3", {});
    setCache(key, { n: 1 });
    invalidateCache(key);
    expect(getCache(key)).toBeNull();
  });
});
