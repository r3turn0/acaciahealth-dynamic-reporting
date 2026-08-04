import { describe, it, expect } from "vitest";
import { validateQuery, validateReadOnlySql } from "@/lib/services/queryGuard";
import { assertReadOnly, ReadOnlyViolationError } from "@/lib/db/readOnlyClient";

const VALID = `SELECT b.branch_name, COUNT(*) AS admissions
FROM CLIENT_EPISODES_ALL epi
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY b.branch_name`;

describe("validateQuery", () => {
  it("accepts a well-formed parameterized query", () => {
    const r = validateQuery(VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects queries without a WHERE clause", () => {
    const r = validateQuery("SELECT branch_name FROM BRANCHES");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/WHERE/i);
  });

  it("requires @StartDate and @EndDate", () => {
    const r = validateQuery(
      "SELECT b.branch_name FROM BRANCHES b WHERE b.branch_code = 'X'"
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/@StartDate/);
    expect(r.errors.join(" ")).toMatch(/@EndDate/);
  });

  it("blocks SELECT *", () => {
    const r = validateQuery(
      "SELECT * FROM CLIENT_EPISODES_ALL epi WHERE epi.d BETWEEN @StartDate AND @EndDate"
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/SELECT \*/);
  });

  it.each([
    ["DROP TABLE BRANCHES", /DROP TABLE/i],
    ["DELETE FROM CLIENT_EPISODES_ALL", /DELETE/i],
    ["INSERT INTO BRANCHES VALUES (1)", /INSERT/i],
    ["EXEC xp_cmdshell 'dir'", /EXEC|xp_cmdshell/i],
  ])("blocks dangerous statement: %s", (stmt, matcher) => {
    const r = validateQuery(
      `${stmt} WHERE x BETWEEN @StartDate AND @EndDate AND CLIENT_EPISODES_ALL = 1`
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(matcher);
  });

  it("rejects CROSS JOINs", () => {
    const r = validateQuery(
      "SELECT a.x FROM CLIENT_EPISODES_ALL a CROSS JOIN BRANCHES b WHERE a.d BETWEEN @StartDate AND @EndDate"
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/CROSS JOIN/i);
  });

  it("requires at least one allowed table", () => {
    const r = validateQuery(
      "SELECT foo FROM SOME_RANDOM_TABLE WHERE foo BETWEEN @StartDate AND @EndDate"
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/allowed/i);
  });
});

describe("validateReadOnlySql", () => {
  it.each([
    "SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
    "WITH episodes AS (SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate) SELECT epi_id FROM episodes;",
    ";WITH episodes AS (SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate) SELECT epi_id FROM episodes;",
    "-- governed query\nSELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate >= @StartDate AND epi_SocDate < @EndDate",
    "SELECT 'update is prose' AS label FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
  ])("allows read-only SQL: %s", (sql) => {
    expect(validateReadOnlySql(sql)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    "INSERT INTO x VALUES (1)",
    "UPDATE x SET value = 1",
    "DELETE FROM x",
    "MERGE x USING y ON 1 = 1 WHEN MATCHED THEN UPDATE SET x.a = y.a;",
    "CREATE TABLE x (id int)",
    "ALTER TABLE x ADD value int",
    "DROP TABLE x",
    "TRUNCATE TABLE x",
    "RENAME OBJECT x TO y",
    "GRANT SELECT ON x TO y",
    "REVOKE SELECT ON x FROM y",
    "DENY SELECT ON x TO y",
    "USE master; SELECT name FROM sys.tables",
    "EXEC dbo.Report",
    "EXECUTE('SELECT 1')",
    "SELECT epi_id INTO archived FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
    "SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate >= @StartDate; DELETE FROM CLIENT_EPISODES_ALL",
    "/* harmless */ UPDATE CLIENT_EPISODES_ALL SET epi_id = 1",
    "SELECT value FROM OPENROWSET('SQLNCLI', 'server=x', 'SELECT 1')",
  ])("blocks write-capable SQL: %s", (sql) => {
    expect(validateReadOnlySql(sql).valid).toBe(false);
  });

  it("uses the same policy at the data-client boundary", () => {
    expect(() => assertReadOnly("select 1; update x set y = 2")).toThrow(ReadOnlyViolationError);
  });
});
