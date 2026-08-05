import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogAsset } from "@/lib/discovery/catalog";
import { invalidateSearchIndex, searchIndex } from "@/lib/discovery/searchIndex";

const assets: CatalogAsset[] = [
  {
    id: "kpi-adc",
    type: "kpi",
    kind: "virtual",
    name: "Average Daily Census",
    description: "Average patient census calculated from patient days.",
    tags: ["adc", "occupancy"],
    location: "KPI Catalog / Census",
    related: ["CLIENT_EPISODES_ALL"],
    owner: "KPI Governance",
    governanceState: "certified",
    certified: true,
    version: 1,
    createdAt: null,
    updatedAt: null,
    source: "KPI formula registry",
    lineage: ["CLIENT_EPISODES_ALL", "patient_days"],
    exportable: true,
    virtualNotice: "Virtual metadata only",
  },
  {
    id: "report-admissions",
    type: "report",
    kind: "virtual",
    name: "Admissions by Branch",
    description: "Published branch admissions report.",
    tags: ["admissions", "CLIENT_EPISODES_ALL"],
    location: "Saved Reports",
    related: ["CLIENT_EPISODES_ALL"],
    owner: "system",
    governanceState: "published",
    certified: true,
    version: 2,
    createdAt: null,
    updatedAt: null,
    source: "Canonical report definitions",
    lineage: ["Admissions", "branch"],
    exportable: true,
    virtualNotice: "Virtual metadata only",
  },
];

beforeEach(() => invalidateSearchIndex());

describe("deterministic catalog search index", () => {
  it("returns weighted, traceable evidence without generative interpretation", async () => {
    const execution = await searchIndex("patient census", ["kpi"], 10, async () => assets);
    expect(execution.results[0]?.id).toBe("kpi-adc");
    expect(execution.results[0]?.evidence.length).toBeGreaterThan(0);
    expect(execution.results[0]?.evidence.some((item) => item.field === "name" || item.field === "description")).toBe(true);
    expect(execution.results[0]?.matchedTerms).toContain("census");
  });

  it("caches repeated queries and bounds topK", async () => {
    let builds = 0;
    const build = async () => { builds += 1; return assets; };
    const first = await searchIndex("admissions", undefined, 1000, build);
    const second = await searchIndex("admissions", undefined, 1000, build);
    expect(first.results.length).toBeLessThanOrEqual(100);
    expect(second.cacheHit).toBe(true);
    expect(second.timing.retrievalMs).toBe(0);
    expect(builds).toBe(1);
  });

  it("coalesces concurrent cold index builds", async () => {
    let builds = 0;
    const build = async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return assets;
    };
    const [left, right] = await Promise.all([
      searchIndex("adc", undefined, 10, build),
      searchIndex("branch admissions", undefined, 10, build),
    ]);
    expect(builds).toBe(1);
    expect(left.results.length).toBeGreaterThan(0);
    expect(right.results.length).toBeGreaterThan(0);
    expect(left.cacheHit || right.cacheHit).toBe(true);
  });

  it("uses deterministic tie-breaking", async () => {
    const first = await searchIndex("CLIENT_EPISODES_ALL", undefined, 10, async () => assets);
    invalidateSearchIndex();
    const second = await searchIndex("CLIENT_EPISODES_ALL", undefined, 10, async () => [...assets].reverse());
    expect(second.results.map((result) => result.id)).toEqual(first.results.map((result) => result.id));
  });
});
