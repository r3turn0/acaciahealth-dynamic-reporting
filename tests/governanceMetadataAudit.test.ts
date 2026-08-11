import { describe, expect, it } from "vitest";
import governanceCatalog from "@/lib/config/governanceCatalog.json";

describe("governed schema metadata audit", () => {
  it("records searchable columns and semantic keywords", () => {
    expect(governanceCatalog.metadataAudit.immutableSource).toBe(true);
    expect(governanceCatalog.tables.length).toBeGreaterThan(0);
    for (const table of governanceCatalog.tables) {
      expect(table.columnNames).toEqual(table.columns.map((column) => column.name));
      expect(table.semanticKeywords).toBeInstanceOf(Array);
      for (const column of table.columns) {
        expect(typeof column.primaryKey).toBe("boolean");
        expect(typeof column.foreignKey).toBe("boolean");
        expect(column.semanticKeywords).toBeInstanceOf(Array);
      }
    }
  });

  it("retains declared primary and foreign key metadata", () => {
    const tablesWithPrimaryKeys = governanceCatalog.tables.filter((table) => table.primaryKeys.length > 0);
    const tablesWithForeignKeys = governanceCatalog.tables.filter((table) => table.foreignKeys.length > 0);
    expect(tablesWithPrimaryKeys.length).toBeGreaterThan(0);
    expect(tablesWithForeignKeys.length).toBeGreaterThan(0);
  });
});
