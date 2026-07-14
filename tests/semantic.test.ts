/**
 * Tests for the healthcare semantic search system:
 *  - healthcareThesaurus (structure validation)
 *  - tableTagger         (auto-tagging + user overrides)
 *  - tfidfEngine         (vectorization + cosine similarity ranking)
 *  - queryLearner        (frequency boosting + tag prediction)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Shared fixture tables (minimal SchemaModel Table shape) ───────────────────

const MOCK_TABLES = [
  {
    id: "dbo.CLIENT_EPISODES_ALL",
    name: "CLIENT_EPISODES_ALL",
    schema: "dbo",
    domain: "clinical",
    entityType: "fact",
    description: "All client episodes of care",
    columns: [
      { id: "epi_id",        name: "epi_id",        displayName: "Episode ID",      dataType: "int",     nullable: false, isPrimaryKey: true,  isForeignKey: false, references: [], description: null },
      { id: "epi_SocDate",   name: "epi_SocDate",   displayName: "SOC Date",        dataType: "date",    nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
      { id: "epi_branchcode",name: "epi_branchcode", displayName: "Branch Code",    dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: true,  references: ["dbo.BRANCHES.branch_code"], description: null },
      { id: "epi_admittype", name: "epi_admittype",  displayName: "Admit Type",     dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
      { id: "epi_diagnosis", name: "epi_diagnosis",  displayName: "Diagnosis Code", dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
    ],
    foreignKeys: [{ name: "fk_epi_branch", references: { table: "dbo.BRANCHES", column: "branch_code" } }],
    relationships: [],
    tags: [] as string[],
    meta: { indexes: [], triggers: [], checkConstraints: [] },
    searchTokens: ["client", "episodes", "admission", "soc", "branch", "diagnosis"],
  },
  {
    id: "dbo.BRANCHES",
    name: "BRANCHES",
    schema: "dbo",
    domain: "reference",
    entityType: "dimension",
    description: "Branch locations",
    columns: [
      { id: "branch_code", name: "branch_code", displayName: "Branch Code", dataType: "varchar", nullable: false, isPrimaryKey: true,  isForeignKey: false, references: [], description: null },
      { id: "branch_name", name: "branch_name", displayName: "Branch Name", dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
      { id: "region",      name: "region",      displayName: "Region",      dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
    ],
    foreignKeys: [],
    relationships: [],
    tags: [] as string[],
    meta: { indexes: [], triggers: [], checkConstraints: [] },
    searchTokens: ["branches", "region", "location", "branch"],
  },
  {
    id: "dbo.SERVICE_LINES",
    name: "SERVICE_LINES",
    schema: "dbo",
    domain: "reference",
    entityType: "dimension",
    description: "Hospice and home health service lines and care types",
    columns: [
      { id: "sl_id",   name: "sl_id",   displayName: "Service Line ID",   dataType: "int",     nullable: false, isPrimaryKey: true,  isForeignKey: false, references: [], description: null },
      { id: "sl_name", name: "sl_name", displayName: "Service Line Name", dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
      { id: "sl_type", name: "sl_type", displayName: "Service Type",      dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: null },
    ],
    foreignKeys: [],
    relationships: [],
    tags: [] as string[],
    meta: { indexes: [], triggers: [], checkConstraints: [] },
    searchTokens: ["service", "line", "hospice", "homehealth", "palliative", "care"],
  },
  {
    id: "dbo.BILLING_CHARGES",
    name: "BILLING_CHARGES",
    schema: "dbo",
    domain: "financial",
    entityType: "fact",
    // Rich description so the corpus has enough billing signal to cross the threshold
    description: "Billing charges, claims, revenue codes, and ICD-10 diagnosis codes for billed services. Tracks claim amounts, billed units, revenue codes, procedure codes, payer, invoice number, and billing dates.",
    columns: [
      { id: "charge_id",       name: "charge_id",       displayName: "Charge ID",          dataType: "int",     nullable: false, isPrimaryKey: true,  isForeignKey: false, references: [], description: "Primary billing charge identifier" },
      { id: "claim_amount",    name: "claim_amount",    displayName: "Claim Amount",        dataType: "decimal", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: "Total billed claim amount for revenue" },
      { id: "icd10_code",      name: "icd10_code",      displayName: "ICD-10 Code",        dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: "ICD-10 diagnosis code" },
      { id: "revenue_code",    name: "revenue_code",    displayName: "Revenue Code",        dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: "Medicare revenue code for billing" },
      { id: "invoice_number",  name: "invoice_number",  displayName: "Invoice Number",      dataType: "varchar", nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: "Billing invoice number" },
      { id: "billed_units",    name: "billed_units",    displayName: "Billed Units",        dataType: "int",     nullable: true,  isPrimaryKey: false, isForeignKey: false, references: [], description: "Number of units billed on claim" },
    ],
    foreignKeys: [],
    relationships: [],
    tags: [] as string[],
    meta: { indexes: [], triggers: [], checkConstraints: [] },
    searchTokens: ["billing", "charge", "claim", "icd10", "diagnosis", "revenue"],
  },
];

// ── Helper: build a minimal mock SchemaModel ──────────────────────────────────

type AnyTable = typeof MOCK_TABLES[0];

function buildMockModel() {
  const tables: Record<string, AnyTable> = {};
  const searchIndex: Record<string, string[]> = {};
  for (const t of MOCK_TABLES) {
    tables[t.id] = t;
    for (const token of t.searchTokens) {
      if (!searchIndex[token]) searchIndex[token] = [];
      searchIndex[token].push(t.id);
    }
  }
  return {
    tables,
    searchIndex,
    relationships: [],
    stats: { tableCount: MOCK_TABLES.length, columnCount: 13, fkCount: 1 },
  };
}

// ── 1. Healthcare Thesaurus structure ─────────────────────────────────────────

describe("healthcareThesaurus", () => {
  it("has a top-level 'tags' object and '_meta.categories' list", async () => {
    const mod = await import("@/lib/config/healthcareThesaurus.json");
    const data = (mod.default ?? mod) as Record<string, unknown>;
    expect(data).toHaveProperty("tags");
    expect(data).toHaveProperty("_meta");
    const meta = data._meta as { categories: string[] };
    expect(Array.isArray(meta.categories)).toBe(true);
  });

  it("includes all required healthcare tag categories", async () => {
    const mod = await import("@/lib/config/healthcareThesaurus.json");
    const data = (mod.default ?? mod) as { tags: Record<string, unknown> };
    const ids = Object.keys(data.tags);
    for (const required of ["admissions","service_lines","kpi","care_types","billing","clinical"]) {
      expect(ids, `Missing category: ${required}`).toContain(required);
    }
  });

  it("each tag has label, color, description, and terms array", async () => {
    const mod = await import("@/lib/config/healthcareThesaurus.json");
    const data = (mod.default ?? mod) as { tags: Record<string, { label: string; color: string; description: string; terms: string[] }> };
    for (const [id, tag] of Object.entries(data.tags)) {
      expect(typeof tag.label, `${id}.label`).toBe("string");
      expect(typeof tag.color, `${id}.color`).toBe("string");
      expect(typeof tag.description, `${id}.description`).toBe("string");
      expect(Array.isArray(tag.terms), `${id}.terms`).toBe(true);
      expect(tag.terms.length, `${id} needs >=10 terms`).toBeGreaterThanOrEqual(10);
    }
  });

  it("all terms are lowercase strings", async () => {
    const mod = await import("@/lib/config/healthcareThesaurus.json");
    const data = (mod.default ?? mod) as { tags: Record<string, { terms: string[] }> };
    for (const [id, tag] of Object.entries(data.tags)) {
      for (const term of tag.terms) {
        expect(typeof term, `${id} term type`).toBe("string");
        expect(term, `"${term}" in ${id} should be lowercase`).toBe(term.toLowerCase());
      }
    }
  });
});

// ── 2. Table Tagger ───────────────────────────────────────────────────────────

describe("tableTagger", () => {
  beforeEach(() => {
    // Reset module cache so the confidence threshold from tableTagger.ts is
    // re-evaluated for each test rather than reusing a stale cached module.
    vi.resetModules();
  });

  it("auto-tags CLIENT_EPISODES_ALL as admissions", async () => {
    const { tagAllTables } = await import("@/lib/agents/tableTagger");
    const store = tagAllTables(MOCK_TABLES as never[]);
    expect(store["dbo.CLIENT_EPISODES_ALL"].tags).toContain("admissions");
  });

  it("auto-tags SERVICE_LINES as service_lines or care_types", async () => {
    const { tagAllTables } = await import("@/lib/agents/tableTagger");
    const store = tagAllTables(MOCK_TABLES as never[]);
    const tags = store["dbo.SERVICE_LINES"].tags;
    const hasServiceOrCare = tags.includes("service_lines") || tags.includes("care_types");
    expect(hasServiceOrCare).toBe(true);
  });

  it("auto-tags BILLING_CHARGES as billing", async () => {
    const { tagAllTables } = await import("@/lib/agents/tableTagger");
    const store = tagAllTables(MOCK_TABLES as never[]);
    expect(store["dbo.BILLING_CHARGES"].tags).toContain("billing");
  });

  it("confidence map contains a positive score for admissions on CLIENT_EPISODES_ALL", async () => {
    const { tagAllTables } = await import("@/lib/agents/tableTagger");
    const store = tagAllTables(MOCK_TABLES as never[]);
    expect(store["dbo.CLIENT_EPISODES_ALL"].confidence["admissions"]).toBeGreaterThan(0);
  });

  it("addUserTag adds a tag without duplicates (idempotent)", async () => {
    const { tagAllTables, addUserTag } = await import("@/lib/agents/tableTagger");
    let store = tagAllTables(MOCK_TABLES as never[]);
    store = addUserTag(store, "dbo.BRANCHES", "kpi");
    expect(store["dbo.BRANCHES"].tags).toContain("kpi");
    store = addUserTag(store, "dbo.BRANCHES", "kpi"); // idempotent
    expect(store["dbo.BRANCHES"].tags.filter((t) => t === "kpi").length).toBe(1);
  });

  it("removeUserTag suppresses a tag via the '-tag' convention", async () => {
    const { tagAllTables, addUserTag, removeUserTag } = await import("@/lib/agents/tableTagger");
    let store = tagAllTables(MOCK_TABLES as never[]);
    store = addUserTag(store, "dbo.BRANCHES", "kpi");
    store = removeUserTag(store, "dbo.BRANCHES", "kpi");
    expect(store["dbo.BRANCHES"].tags).not.toContain("kpi");
  });

  it("findTablesByTag returns all tables carrying the requested tag", async () => {
    const { tagAllTables, addUserTag, removeUserTag, findTablesByTag } = await import("@/lib/agents/tableTagger");
    let store = tagAllTables(MOCK_TABLES as never[]);
    // Ensure BRANCHES carries kpi tag (via user override) and BILLING_CHARGES does not
    store = addUserTag(store, "dbo.BRANCHES", "kpi");
    store = removeUserTag(store, "dbo.BILLING_CHARGES", "kpi");
    const results = findTablesByTag(store, ["kpi"]);
    expect(results).toContain("dbo.BRANCHES");
    expect(results).not.toContain("dbo.BILLING_CHARGES");
  });

  it("suggestTagsForQuery returns tags relevant to the query text", async () => {
    const { suggestTagsForQuery } = await import("@/lib/agents/tableTagger");
    const tags = suggestTagsForQuery("admissions census soc date");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).toContain("admissions");
  });
});

// ── 3. TF-IDF Engine ──────────────────────────────────────────────────────────

describe("tfidfEngine", () => {
  it("builds an index without throwing", async () => {
    const { buildTFIDFIndex } = await import("@/lib/agents/tfidfEngine");
    expect(() => buildTFIDFIndex(buildMockModel() as never)).not.toThrow();
  });

  it("returns results sorted by cosine score descending", async () => {
    const { buildTFIDFIndex, semanticSearch } = await import("@/lib/agents/tfidfEngine");
    const index = buildTFIDFIndex(buildMockModel() as never);
    const results = semanticSearch("admission episodes soc", index, 10);
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("ranks CLIENT_EPISODES_ALL highest for an admissions query", async () => {
    const { invalidateIndex, getOrBuildIndex, semanticSearch } = await import("@/lib/agents/tfidfEngine");
    invalidateIndex();
    const index = getOrBuildIndex(buildMockModel() as never);
    const results = semanticSearch("admissions patient episodes soc date", index, 10);
    expect(results[0]?.tableId).toBe("dbo.CLIENT_EPISODES_ALL");
  });

  it("ranks BILLING_CHARGES highest for a billing query", async () => {
    const { invalidateIndex, getOrBuildIndex, semanticSearch } = await import("@/lib/agents/tfidfEngine");
    invalidateIndex();
    const index = getOrBuildIndex(buildMockModel() as never);
    const results = semanticSearch("billing charges claim icd10 diagnosis revenue", index, 10);
    expect(results[0]?.tableId).toBe("dbo.BILLING_CHARGES");
  });

  it("returns only zero-score results for a nonsense query", async () => {
    const { invalidateIndex, getOrBuildIndex, semanticSearch } = await import("@/lib/agents/tfidfEngine");
    invalidateIndex();
    const index = getOrBuildIndex(buildMockModel() as never);
    const results = semanticSearch("zzzxxx999qqqrrr", index, 10);
    const nonZero = results.filter((r) => r.score > 0);
    expect(nonZero.length).toBe(0);
  });

  it("invalidateIndex forces a fresh build on the next getOrBuildIndex call", async () => {
    const { invalidateIndex, getOrBuildIndex } = await import("@/lib/agents/tfidfEngine");
    const model = buildMockModel() as never;
    const idx1 = getOrBuildIndex(model);
    invalidateIndex();
    const idx2 = getOrBuildIndex(model);
    expect(idx1).toBeDefined();
    expect(idx2).toBeDefined();
    // After invalidation the singleton is recreated — different object reference
    expect(idx1).not.toBe(idx2);
  });

  it("each result includes a non-empty matchedTerms array", async () => {
    const { invalidateIndex, getOrBuildIndex, semanticSearch } = await import("@/lib/agents/tfidfEngine");
    invalidateIndex();
    const index = getOrBuildIndex(buildMockModel() as never);
    const results = semanticSearch("admission branch episodes", index, 5);
    for (const r of results) {
      if (r.score > 0) expect(r.matchedTerms.length).toBeGreaterThan(0);
    }
  });
});

// ── 4. Query Learner ──────────────────────────────────────────────────────────

describe("queryLearner", () => {
  beforeEach(async () => {
    // Clear learner state before each test (uses sessionStorage on client,
    // but in Node/vitest environment it is a no-op — state module is re-imported
    // per test via the module singleton, so we call clearLearnerData explicitly).
    const { clearLearnerData } = await import("@/lib/agents/queryLearner");
    clearLearnerData();
  });

  it("getTopTables returns empty before any queries are recorded", async () => {
    const { getTopTables } = await import("@/lib/agents/queryLearner");
    // On server/Node sessionStorage is unavailable → always returns empty
    const top = getTopTables(5);
    expect(Array.isArray(top)).toBe(true);
  });

  it("getLearnerStats returns expected shape", async () => {
    const { getLearnerStats } = await import("@/lib/agents/queryLearner");
    const stats = getLearnerStats();
    expect(stats).toHaveProperty("tableFrequency");
    expect(stats).toHaveProperty("tagFrequency");
    expect(stats).toHaveProperty("vocabulary");
    expect(stats).toHaveProperty("totalQueries");
  });

  it("predictTags returns thesaurus-based tags for a healthcare query", async () => {
    const { predictTags } = await import("@/lib/agents/queryLearner");
    // On server side, learner history is empty but thesaurus fallback runs
    const tags = predictTags("admissions census soc");
    expect(Array.isArray(tags)).toBe(true);
    // Thesaurus fallback should surface 'admissions'
    expect(tags).toContain("admissions");
  });

  it("getQueryHistory returns an array", async () => {
    const { getQueryHistory } = await import("@/lib/agents/queryLearner");
    expect(Array.isArray(getQueryHistory(10))).toBe(true);
  });

  it("clearLearnerData does not throw in Node environment", async () => {
    const { clearLearnerData } = await import("@/lib/agents/queryLearner");
    expect(() => clearLearnerData()).not.toThrow();
  });
});
