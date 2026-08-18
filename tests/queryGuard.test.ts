import { describe, it, expect } from "vitest";
import { validateQuery, validateReadOnlySql } from "@/lib/services/queryGuard";
import { assertReadOnly, ReadOnlyViolationError } from "@/lib/db/readOnlyClient";
import { analyzeSqlCompatibility, bindUnresolvedParameters } from "@/lib/services/sqlCompatibility";

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

  it.each([
    "SELECT * FROM CLIENT_EPISODES_ALL epi WHERE epi.d BETWEEN @StartDate AND @EndDate",
    "SELECT TOP 10000 * FROM CLIENT_EPISODES_ALL epi WHERE epi.d BETWEEN @StartDate AND @EndDate",
    "SELECT DISTINCT TOP (10000) * FROM CLIENT_EPISODES_ALL epi WHERE epi.d BETWEEN @StartDate AND @EndDate",
  ])("blocks wildcard projections: %s", (query) => {
    const r = validateQuery(query);
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

  it.each([
    "[CLIENT_EPISODES_ALL]",
    "[dbo].[CLIENT_EPISODES_ALL]",
    "dbo.CLIENT_EPISODES_ALL",
    "[DbO].[client_episodes_all]",
  ])("accepts Dataset Studio Publish preview table notation: %s", (tableReference) => {
    const sql = `SELECT TOP (100)
      ${tableReference}.[epi_id] AS [CLIENT_EPISODES_ALL_epi_id]
      FROM ${tableReference}
      WHERE @StartDate <= @EndDate`;

    expect(validateQuery(sql)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    "SELECT SOME_RANDOM_TABLE.foo AS CLIENT_EPISODES_ALL FROM SOME_RANDOM_TABLE WHERE foo BETWEEN @StartDate AND @EndDate",
    "SELECT foo FROM SOME_RANDOM_TABLE WHERE 'CLIENT_EPISODES_ALL' = 'CLIENT_EPISODES_ALL' AND foo BETWEEN @StartDate AND @EndDate",
    "SELECT foo FROM SOME_RANDOM_TABLE -- FROM CLIENT_EPISODES_ALL\nWHERE foo BETWEEN @StartDate AND @EndDate",
  ])("rejects allowed table names outside physical FROM/JOIN references", (sql) => {
    const result = validateQuery(sql);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/allowed table/i);
  });

  it("accepts the governed hospice daily census view used by canonical WAAR reports", () => {
    const sql = `;WITH DailyCensus AS (
      SELECT ServiceDate AS CensusDate, [Client Brnch] AS branch_name, COUNT(DISTINCT epi_paid) AS current_census
      FROM dbo.V_AL_HOSPICEDAILYCENSUSINFO
      WHERE ServiceDate BETWEEN @StartDate AND @EndDate
      GROUP BY ServiceDate, [Client Brnch]
    )
    SELECT CensusDate, branch_name, current_census
    FROM DailyCensus
    ORDER BY branch_name, CensusDate`;

    expect(validateQuery(sql)).toEqual({ valid: true, errors: [] });
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

  it("allows leading DECLARE statements when the executable body remains read-only", () => {
    const sql = `DECLARE @ReportStart date = '2026-01-01';
DECLARE @ReportEnd date = '2026-01-31';
WITH episodes AS (SELECT epi_id, epi_SocDate FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @ReportStart AND @ReportEnd)
SELECT epi_id FROM episodes`;
    expect(validateReadOnlySql(sql)).toEqual({ valid: true, errors: [] });
  });

  it("still blocks write operations following declarations", () => {
    expect(validateReadOnlySql("DECLARE @id int = 1; UPDATE x SET value = @id").valid).toBe(false);
  });

  it("allows multiple independently read-only result statements", () => {
    const sql = [
      "SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate",
      "SELECT branch_name FROM BRANCHES WHERE branch_code BETWEEN @StartDate AND @EndDate",
    ].join(";\n");
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

describe("SQL compatibility", () => {
  const candidates = [
    { name: "StartDate", value: "2026-01-01", type: "date" as const },
    { name: "EndDate", value: "2026-01-31", type: "date" as const },
  ];

  it("does not bind values already declared inside saved SQL", () => {
    const sql = "DECLARE @StartDate date = '2020-01-01'; SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate >= @StartDate";
    expect(bindUnresolvedParameters(sql, candidates)).toEqual([]);
  });

  it("binds only unresolved external values without rewriting SQL", () => {
    const sql = "SELECT epi_id FROM CLIENT_EPISODES_ALL WHERE epi_SocDate BETWEEN @StartDate AND @EndDate";
    expect(bindUnresolvedParameters(sql, candidates).map((item) => item.name)).toEqual(["StartDate", "EndDate"]);
    expect(sql).toContain("@StartDate");
  });

  it("reports advanced read-only features and missing parameters", () => {
    const report = analyzeSqlCompatibility("WITH x AS (SELECT ROW_NUMBER() OVER (ORDER BY epi_id) AS n FROM CLIENT_EPISODES_ALL WHERE epi_SocDate >= @StartDate) SELECT n FROM x", ["EndDate"]);
    expect(report.features).toEqual(expect.arrayContaining(["CTEs", "Window functions"]));
    expect(report.unresolvedParameters).toEqual(["startdate"]);
    expect(report.compatible).toBe(false);
  });
});
