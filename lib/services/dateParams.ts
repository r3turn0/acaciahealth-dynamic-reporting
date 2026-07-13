/**
 * /lib/services/dateParams.ts
 *
 * Normalizes hardcoded date-range literals in a T-SQL query back into the
 * standard @StartDate / @EndDate bind parameters.
 *
 * WHY: AI-generated, hand-edited, pasted, or saved SQL frequently bakes in
 * literal dates (e.g. `BETWEEN CONVERT(date, '2017-03-02') AND
 * CONVERT(date, '2017-09-01')`). When that happens the Report Studio date
 * pickers have no effect, because /api/run-sql binds @StartDate/@EndDate but
 * the query never references them. Rewriting the literals to the named
 * parameters makes the date filters authoritative again.
 *
 * The rewrite is conservative: it only targets date-typed literals
 * (matching YYYY-MM-DD) that appear in range/comparison positions. Columns,
 * numbers, and non-date strings are never touched.
 */

// A single date-literal expression. Matches any of:
//   'YYYY-MM-DD'                         (optionally with a time component)
//   N'YYYY-MM-DD'
//   CONVERT(date|datetime|datetime2, 'YYYY-MM-DD...')
//   CAST('YYYY-MM-DD...' AS date|datetime|datetime2)
const DATE_LITERAL = String.raw`(?:CONVERT\s*\(\s*(?:date|datetime2?|smalldatetime)\s*,\s*N?'[^']*\d{4}-\d{2}-\d{2}[^']*'\s*\)|CAST\s*\(\s*N?'[^']*\d{4}-\d{2}-\d{2}[^']*'\s+AS\s+(?:date|datetime2?|smalldatetime)\s*\)|N?'\d{4}-\d{2}-\d{2}(?:[ T][0-9:.]+)?')`;

export interface DateParamResult {
  /** The query with date literals rewritten to @StartDate / @EndDate. */
  sql: string;
  /** True when at least one literal was rewritten. */
  replaced: boolean;
}

/**
 * Rewrite hardcoded date-range literals to @StartDate / @EndDate.
 * Idempotent: running it on an already-parameterized query is a no-op.
 */
export function parameterizeDates(input: string): DateParamResult {
  if (!input) return { sql: input, replaced: false };

  let sql = input;
  let replaced = false;
  const mark = (r: string) => {
    replaced = true;
    return r;
  };

  // 1. Range form: BETWEEN <startLiteral> AND <endLiteral>
  //    The first literal is the start bound, the second is the end bound.
  sql = sql.replace(
    new RegExp(String.raw`BETWEEN\s+${DATE_LITERAL}\s+AND\s+${DATE_LITERAL}`, "gi"),
    () => mark("BETWEEN @StartDate AND @EndDate")
  );

  // 2. Comparison forms. Lower-bound operators map to @StartDate, upper-bound
  //    operators map to @EndDate. Two-character operators are handled before
  //    their single-character counterparts so ">=" is not clipped to ">".
  sql = sql.replace(new RegExp(String.raw`>=\s*${DATE_LITERAL}`, "gi"), () => mark(">= @StartDate"));
  sql = sql.replace(new RegExp(String.raw`<=\s*${DATE_LITERAL}`, "gi"), () => mark("<= @EndDate"));
  sql = sql.replace(new RegExp(String.raw`<\s*${DATE_LITERAL}`, "gi"), () => mark("< @EndDate"));
  sql = sql.replace(new RegExp(String.raw`>\s*${DATE_LITERAL}`, "gi"), () => mark("> @StartDate"));

  return { sql, replaced };
}
