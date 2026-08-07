import type { NamedParam } from "@/lib/services/db";

const MAX_FILTERS = 12;
const MAX_FILTER_VALUE_LENGTH = 256;

type FilterMap = Record<string, string>;

export class TableFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableFilterError";
  }
}

export interface TableFilterSql {
  filters: FilterMap;
  whereClause: string;
  params: NamedParam[];
}

export function parseTableFilters(raw: string | null): FilterMap {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TableFilterError("Filters must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TableFilterError("Filters must be a column-to-value object.");
  }

  const entries = Object.entries(parsed);
  if (entries.length > MAX_FILTERS) {
    throw new TableFilterError(`A maximum of ${MAX_FILTERS} column filters is allowed.`);
  }

  const filters: FilterMap = {};
  for (const [column, value] of entries) {
    if (typeof value !== "string") {
      throw new TableFilterError(`Filter value for "${column}" must be text.`);
    }
    if (value.length > MAX_FILTER_VALUE_LENGTH) {
      throw new TableFilterError(
        `Filter value for "${column}" exceeds ${MAX_FILTER_VALUE_LENGTH} characters.`
      );
    }
    if (value.length > 0) filters[column] = value;
  }

  return filters;
}

export function escapeSqlLikeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\[/g, "\\[");
}

export function quoteSqlIdentifier(identifier: string): string {
  return `[${identifier.replaceAll("]", "]]" )}]`;
}

export function buildTableFilterSql(
  filters: FilterMap,
  availableColumns: readonly string[]
): TableFilterSql {
  const canonicalColumns = new Map(availableColumns.map((column) => [column.toLowerCase(), column]));
  const predicates: string[] = [];
  const params: NamedParam[] = [];

  for (const [requestedColumn, value] of Object.entries(filters)) {
    const column = canonicalColumns.get(requestedColumn.toLowerCase());
    if (!column) {
      throw new TableFilterError(`Unknown filter column "${requestedColumn}".`);
    }

    const paramName = `TableFilter${params.length}`;
    const quotedColumn = `[${column.split("]").join("]]".trim())}]`;
    predicates.push(
      `LOWER(TRY_CONVERT(nvarchar(max), ${quotedColumn})) LIKE LOWER(@${paramName}) ESCAPE '\\'`
    );
    params.push({
      name: paramName,
      value: `%${escapeSqlLikeLiteral(value)}%`,
      type: "nvarchar",
    });
  }

  return {
    filters,
    whereClause: predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "",
    params,
  };
}
