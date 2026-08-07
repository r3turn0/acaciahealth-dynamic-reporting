# SQL Consolidation Audit

**Audit ID:** ACACIA-DYN-SQL-CONSOLIDATION-001

**Database posture:** read-only SQL Server

**Scope:** core reporting SQL execution only. KPI Intelligence Layer and BI Studio enhancements are explicitly excluded.

## Inventory summary

| Asset family | Location | Usage | Parameters | Execution pattern | Consolidation status |
|---|---|---|---|---|---|
| Canonical report catalog | `lib/config/canonicalReports.ts` | Saved/canonical report metadata and SQL file references | `@StartDate`, `@EndDate`; report-specific dimensions | One gateway call per report | Multi-statement SQL is now consumed as one multi-result execution |
| SQL library | `lib/config/sqlLibrary.ts` | Curated report SQL metadata | Date range and report filters | Catalog lookup | Kept as catalog; duplicate definitions should resolve to canonical IDs |
| SQL report files | `sql/*.sql`, `scripts/*.sql` | Canonical and setup/reporting queries | File-specific | Previously only first `mssql.recordset` was consumed | All `recordsets` are now consumed by the data layer |
| Gateway | `lib/gateway/QueryGateway.ts` | Single execution entry point for Report Studio/editor/generated reports | Bound date parameters | One command; first result only | One command; all result sets returned while Result Set 1 remains legacy output |
| Read-only DAL | `lib/db/readOnlyClient.ts` | Guarded analytics access | Standard or arbitrary named parameters | Single-result methods | Adds guarded multi-result methods; write keywords remain rejected |
| Table browser | `app/api/data/[table]/route.ts` | Paged table data and total count | Allowlisted table/column, validated paging | Two concurrent SQL commands | One SQL batch with page dataset plus total dataset |
| Episode data | `lib/data/episodes.ts` | Admissions, discharges, census, care type | Bound dates | Separate report functions | Candidate for call-site batching when a dashboard requests several metrics together |
| Billing data | `lib/data/billing.ts` | Revenue, AR, collections | Bound dates | Separate report functions | Candidate for call-site batching when consumed together |
| API response | `app/api/run-sql/route.ts` | Report Studio and legacy callers | Validated request schema | Result Set 1 only | Exposes `resultSets` and `resultSetCount`; legacy `rows`, `columns`, `rowCount` unchanged |

## Query inventory fields

The repository provides source location, report/catalog use, parameters, tables, and call sites. Runtime execution frequency is not reliably discoverable from static source; query-history/performance stores can supply observed frequency in deployed environments. No frequency claims are inferred where telemetry is absent.

## Confirmed consolidation

### Paged table retrieval

Before:

1. `SELECT COUNT(*) ...`
2. `SELECT ... ORDER BY ... OFFSET ... FETCH ...`

After, one read-only command:

1. Result Set 1: ordered page rows
2. Result Set 2: `COUNT_BIG(*)` total

This reduces two database round trips to one without changing ordering, paging, source labels, cache keys, or response shape.

### Canonical and dynamic reports

The `mssql` request now sets `multiple = true` and consumes every returned recordset. Gateway execution and schema-aware retry both preserve all datasets. Legacy consumers continue binding to Result Set 1 through `rows`, `columns`, and `rowCount`.

## Duplicate and repeated-scan candidates

- Canonical SQL definitions are split between report metadata, SQL library entries, and SQL files. Use canonical report IDs as the ownership key; aliases should reference rather than copy SQL.
- Episode functions repeat overlapping episode/date filtering. Consolidate only at dashboard/report call sites that need multiple metrics in one response; independent APIs should remain independently executable.
- Billing functions repeat date-window scans for revenue, AR, and collections. A shared filtered CTE or temporary staging set is appropriate only when those datasets are requested together.
- Independent aggregate commands over an identical filter context should be emitted as adjacent result sets or conditional aggregates, not separate calls.

## Performance findings

- Multi-result support removes silent loss of Result Sets 2+ and enables header/detail/summary batches.
- The paged browser now avoids connection-pool scheduling and network latency for a second command.
- Keep explicit ordering in every paged result set. `ORDER BY (SELECT NULL)` preserves prior behavior but is nondeterministic; reports requiring stable paging must provide an approved sort column.
- Avoid `SELECT *` in report-owned SQL where a stable schema is known. The generic table browser intentionally retains it because it is an exploration surface.
- CTEs improve filter consistency but do not inherently materialize data. For several expensive scans in a single command, a read-only session-local `#temp` staging set may reduce rescans; use only after measuring plans.
- Do not introduce schema/index changes under this read-only mandate.

## Parameterization and security

- User values remain bound through `mssql.Request.input`; date, integer, numeric, boolean, and string hints are supported.
- The read-only client rejects DML, DDL, grants, and stored procedure execution.
- Dynamic table and sort identifiers in the table browser remain constrained by allowlists and identifier sanitization. Values must never be interpolated.
- Report filters, date windows, facility/branch, patient, status, and security predicates must be duplicated exactly across all statements in a consolidated batch or defined once in a shared filtered source.
- `EXEC` remains prohibited because stored procedure write behavior cannot be proven by the query guard.

## Backward compatibility contract

- Result Set 1 remains the primary/legacy dataset.
- Existing JSON properties `rows`, `columns`, and `rowCount` retain their meanings.
- New properties are additive: `resultSets` and `resultSetCount`.
- Demo/fallback output is represented as one result set.
- Date parameterization, gateway validation, retries, truncation, query history, lineage, and governance remain in the existing execution path.
- Consolidated SQL must preserve filter boundaries, aggregate values, ordering, paging, grouping, null semantics, and column aliases before promotion.

## Remaining measured-work candidates

1. Capture query-history counts by canonical report ID to prioritize high-frequency consolidation.
2. For dashboards that request admissions, discharges, census, and care type together, introduce one purpose-built batch and compare all four outputs.
3. For finance dashboards requesting revenue, AR, and collections together, introduce one purpose-built batch with shared date predicates.
4. Obtain actual SQL Server execution plans and IO/time statistics before selecting CTE versus temp-table staging.

## Reporting governance enhancement v1

All enhancement artifacts share correlation ID `acacia-reporting-enhancement-v1`. The Source Documentation Agent owns deterministic extraction from the metadata export and eight-sheet KPI workbook; the Reporting Engine owns guarded `SELECT`/CTE execution, bound date parameters, named result sets, and result-specific analytics; the Data Governance Agent owns KPI lifecycle metadata, glossary definitions, lineage, and validation semantics.

The SQL Server boundary remains immutable. Multi-result responses add named `{ name, columns, rows, rowCount }` datasets while retaining Result Set 1 compatibility. KPI confidence from SQL structure or metadata matching is evidence only: `validated` requires a matching read-only verification result, `partial` identifies variance or incomplete coverage, and `unverified` is used when no safe aggregate comparison is available.

Compact artifacts are versioned at `lib/config/governanceCatalog.json`, `lib/config/scorecardDiscovery.json`, and `lib/config/businessGlossary.json`; the full metadata export is excluded from runtime and client bundles. Regenerate scorecard discoveries with `node scripts/generate-scorecard-catalog.mjs` after replacing the governed workbook source, then review every new discovery as Draft before promotion.
