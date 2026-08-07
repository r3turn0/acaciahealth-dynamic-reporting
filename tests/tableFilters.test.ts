import { describe, expect, it } from "vitest";
import {
  buildTableFilterSql,
  escapeSqlLikeLiteral,
  parseTableFilters,
  quoteSqlIdentifier,
  TableFilterError,
} from "@/lib/services/tableFilters";

describe("parseTableFilters", () => {
  it("normalizes a bounded string map and drops empty values", () => {
    expect(parseTableFilters('{"branch_name":"Dallas","status":""}')).toEqual({
      branch_name: "Dallas",
    });
  });

  it("rejects malformed and non-string filter payloads", () => {
    expect(() => parseTableFilters("not-json")).toThrow(TableFilterError);
    expect(() => parseTableFilters('["branch_name"]')).toThrow(TableFilterError);
    expect(() => parseTableFilters('{"branch_name":42}')).toThrow(TableFilterError);
  });

  it("rejects excessive filters and oversized values", () => {
    const excessive = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`c${index}`, "x"]));
    expect(() => parseTableFilters(JSON.stringify(excessive))).toThrow(/maximum of 12/i);
    expect(() => parseTableFilters(JSON.stringify({ name: "x".repeat(257) }))).toThrow(/256/);
  });
});

describe("buildTableFilterSql", () => {
  it("allowlists columns case-insensitively and binds escaped LIKE values", () => {
    const result = buildTableFilterSql(
      { BRANCH_NAME: "50%_care[west]\\" },
      ["branch_name", "branch_code"]
    );

    expect(result.whereClause).toContain("[branch_name]");
    expect(result.whereClause).toContain("@TableFilter0");
    expect(result.whereClause).toContain("ESCAPE '\\'");
    expect(result.params).toEqual([
      {
        name: "TableFilter0",
        value: "%50\\%\\_care\\[west]\\\\%",
        type: "nvarchar",
      },
    ]);
  });

  it("composes multiple filters with AND", () => {
    const result = buildTableFilterSql(
      { branch_name: "Dallas", branch_code: "DAL" },
      ["branch_name", "branch_code"]
    );
    expect(result.whereClause.match(/ LIKE /g)).toHaveLength(2);
    expect(result.whereClause).toContain(" AND ");
    expect(result.params).toHaveLength(2);
  });

  it("rejects unknown columns instead of interpolating identifiers", () => {
    expect(() => buildTableFilterSql({ "name] OR 1=1 --": "x" }, ["name"]))
      .toThrow(/unknown filter column/i);
  });
});

describe("escapeSqlLikeLiteral", () => {
  it("treats SQL LIKE wildcard characters as literal text", () => {
    expect(escapeSqlLikeLiteral("a%b_c[d\\e")).toBe("a\\%b\\_c\\[d\\\\e");
  });
});

describe("quoteSqlIdentifier", () => {
  it("escapes closing brackets in allowlisted SQL Server identifiers", () => {
    expect(quoteSqlIdentifier("branch]name")).toBe("[branch]]name]");
  });
});
