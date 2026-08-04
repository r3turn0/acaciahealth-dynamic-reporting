# Consolidated Result-Set Mapping

## Runtime contract

| Position | Runtime DTO | Legacy alias | UI binding |
|---|---|---|---|
| Result Set 1 | `QueryResultSet` in `MultiQueryResult.resultSets[0]` | `rows`, `columns`, `rowCount` | `ReportResult.data`, primary `ResultsTable`, chart, CSV/XLSX export |
| Result Set 2 | `MultiQueryResult.resultSets[1]` | None | Report-specific secondary section; paged table route maps it to `total` |
| Result Set 3 | `MultiQueryResult.resultSets[2]` | None | Report-specific summary metrics when declared by report metadata |
| Result Set 4 | `MultiQueryResult.resultSets[3]` | None | Report-specific export dataset when declared by report metadata |

`QueryResultSet` contains `columns`, `rows`, and `rowCount`. `ExecutionResult` adds `executionMs`, `truncated`, and governance/audit identity. The API serializes all datasets as `resultSets` while preserving Result Set 1 at the top level.

## Implemented mappings

### `/api/data/[table]` paginated table batch

| Result set | Meaning | Model/DTO | Binding target |
|---|---|---|---|
| 1 | Ordered page data | `QueryResultSet` | API `rows` and `columns`; table browser grid |
| 2 | Full filtered table count | `QueryResultSet<{ total }>` conceptually | API `total`, `totalPages`, pagination controls |

The batch preserves the previous order clause, offset, page size, cache key, and API response.

### Report Studio / SQL Editor batch

| Result set | Meaning | Model/DTO | Binding target |
|---|---|---|---|
| 1 | Primary report dataset | `ExecutionResult.rows`; `ReportResult.data` | Primary table/chart and current exports |
| 2+ | Additional SQL-defined datasets | `ExecutionResult.resultSets`; `ReportResult.result_sets` | Consumed and retained; dataset count is displayed; report-specific sections may bind explicitly |

Because arbitrary SQL does not carry semantic section names, Result Sets 2+ are positional until a canonical report declares a mapping. The runtime never guesses that an arbitrary second dataset is a header or summary.

## Canonical report mapping template

Every newly consolidated canonical report must document this table beside its report metadata:

| Position | Required semantic role | DTO/model | UI/report target |
|---|---|---|---|
| 1 | Detail Grid or legacy primary output | Report-specific row DTO | Existing grid/chart binding |
| 2 | Report Header (when present) | Header DTO | Header/filter context section |
| 3 | Summary Metrics (when present) | Summary DTO | KPI cards/summary footer |
| 4 | Export Dataset (when different from detail) | Export DTO | CSV/XLSX pipeline |

If the legacy report's primary output is a header rather than detail, keep it in Result Set 1. Backward compatibility takes precedence over this preferred ordering.

## Promotion checklist

- Compare Result Set 1 row count, columns, values, aliases, and order against the prior report.
- Compare each aggregate exactly, including null and divide-by-zero behavior.
- Verify date, facility/branch, patient, status, tenant, role, and security filters in every dataset.
- Verify paging and grouping boundaries.
- Verify Result Sets 2+ are consumed even when empty.
- Verify truncation is applied independently to each dataset while original `rowCount` is retained.
- Verify exports continue using Result Set 1 unless report metadata explicitly binds an export dataset.
