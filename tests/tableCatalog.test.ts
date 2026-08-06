import { describe, expect, it } from "vitest";
import {
  buildLiveTableCatalog,
  isTableInCatalog,
  normalizeTableIdentifier,
} from "@/lib/services/tableCatalog";

const catalog = buildLiveTableCatalog([
  {
    table_schema: "dbo",
    table_name: "PAYOR_TYPES",
    table_type: "BASE TABLE",
  },
  {
    table_schema: "clinical",
    table_name: "CLIENT_CONTACTS",
    table_type: "VIEW",
  },
]);

describe("live table catalog", () => {
  it("normalizes unqualified dbo and qualified identifiers", () => {
    expect(normalizeTableIdentifier("PAYOR_TYPES")).toBe("dbo.PAYOR_TYPES");
    expect(normalizeTableIdentifier("clinical.CLIENT_CONTACTS")).toBe(
      "clinical.CLIENT_CONTACTS"
    );
  });

  it("rejects malformed or multipart identifiers", () => {
    expect(normalizeTableIdentifier("dbo.PAYOR_TYPES; DROP TABLE x")).toBeNull();
    expect(normalizeTableIdentifier("server.db.dbo.PAYOR_TYPES")).toBeNull();
    expect(normalizeTableIdentifier("[dbo].[PAYOR_TYPES]")).toBeNull();
  });

  it("allows live-only dbo tables exposed by discovery", () => {
    expect(isTableInCatalog("PAYOR_TYPES", catalog)).toBe(true);
    expect(isTableInCatalog("dbo.PAYOR_TYPES", catalog)).toBe(true);
  });

  it("requires schema qualification for non-dbo tables", () => {
    expect(isTableInCatalog("clinical.CLIENT_CONTACTS", catalog)).toBe(true);
    expect(isTableInCatalog("CLIENT_CONTACTS", catalog)).toBe(false);
  });

  it("rejects valid-looking tables absent from the live catalog", () => {
    expect(isTableInCatalog("UNKNOWN_TABLE", catalog)).toBe(false);
  });

  it("returns discovery-compatible qualified names", () => {
    expect(catalog.tables.map((table) => table.qualified_name)).toEqual([
      "PAYOR_TYPES",
      "clinical.CLIENT_CONTACTS",
    ]);
  });
});
