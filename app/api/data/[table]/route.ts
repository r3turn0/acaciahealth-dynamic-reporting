/**
 * GET /api/data/[table]
 * Returns paginated, filtered rows from a known table.
 * In demo mode returns generated mock data shaped from schemaConfig.
 *
 * Query params:
 *   page        (default 1)
 *   pageSize    (default 50, max 200)
 *   sort        column name
 *   dir         asc | desc
 *   filters     JSON-encoded { column: value } map (substring match)
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import schemaConfig from "@/lib/config/schemaConfig.json";
import { isDbConfigured, BackendUnreachableError } from "@/lib/services/db";
import { buildCacheKey, withCache } from "@/lib/services/cache";
import { recordPerformanceSample } from "@/lib/services/performanceTelemetry";
import { buildStaticCatalog } from "@/lib/services/metadataRegistry";
import {
  getLiveTableCatalog,
  isTableInCatalog,
  normalizeTableIdentifier,
} from "@/lib/services/tableCatalog";
import {
  buildTableFilterSql,
  parseTableFilters,
  TableFilterError,
} from "@/lib/services/tableFilters";

const DEMO_TABLES = Object.keys(schemaConfig);
const STATIC_TABLE_CATALOG = buildStaticCatalog();

function isKnownStaticTable(tableName: string): boolean {
  const canonicalName = normalizeTableIdentifier(tableName);
  return canonicalName !== null && STATIC_TABLE_CATALOG.has(canonicalName.toLowerCase());
}

// Only low-change, non-PHI reference tables are eligible for shared caching.
const REFERENCE_TABLE_TTLS = new Map<string, number>([
  ["BRANCHES", 60 * 60_000],
  ["SERVICE_LINES", 24 * 60 * 60_000],
  ["CARE_TYPES", 24 * 60 * 60_000],
  ["FACILITIES", 60 * 60_000],
  ["PROVIDERS", 60 * 60_000],
  ["INSURANCE_PLANS", 60 * 60_000],
  ["LOOKUP_VALUES", 24 * 60 * 60_000],
]);

// ── Demo data generators ──────────────────────────────────────────────────────

const BRANCH_CODES = ["ATL01", "DAL02", "HOU03", "LAX04", "NYC05", "PHX06", "SEA07", "CHI08"];
const CARE_TYPES   = ["Hospice", "Home Health", "Palliative", "Private Duty"];
const SERVICE_LINES = ["SL-HH", "SL-HPC", "SL-PD", "SL-PAL"];

function randomDate(start: Date, end: Date): string {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split("T")[0];
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRows(tableName: string, count: number): Record<string, unknown>[] {
  const now   = new Date();
  const yr    = new Date(now.getFullYear() - 1, 0, 1);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i <= count; i++) {
    const socDate  = randomDate(yr, now);
    const discDate = Math.random() > 0.4 ? randomDate(new Date(socDate), now) : null;

    if (tableName === "CLIENT_EPISODES_ALL") {
      rows.push({
        epi_id:           i,
        epi_branchcode:   pick(BRANCH_CODES),
        epi_care_type_id: Math.floor(Math.random() * 4) + 1,
        epi_sl_id:        Math.floor(Math.random() * 4) + 1,
        epi_SocDate:      socDate,
        epi_DischargeDate: discDate,
        epi_status:       discDate ? "Discharged" : "Active",
      });
    } else if (tableName === "BRANCHES") {
      if (i > BRANCH_CODES.length) break;
      rows.push({
        branch_code: BRANCH_CODES[i - 1],
        branch_name: `${BRANCH_CODES[i - 1]} Branch`,
        branch_region: pick(["Southwest", "Southeast", "Northeast", "West", "Midwest"]),
        branch_active: true,
      });
    } else if (tableName === "SERVICE_LINES") {
      if (i > SERVICE_LINES.length) break;
      rows.push({
        sl_id:   i,
        sl_code: SERVICE_LINES[i - 1],
        sl_name: SERVICE_LINES[i - 1].replace("SL-", ""),
      });
    } else if (tableName === "CARE_TYPES") {
      if (i > CARE_TYPES.length) break;
      rows.push({
        ct_id:   i,
        ct_name: CARE_TYPES[i - 1],
        ct_code: CARE_TYPES[i - 1].toUpperCase().replace(" ", "_").slice(0, 8),
      });
    } else if (tableName === "Billing.LINE_ITEMS") {
      rows.push({
        li_id:           i,
        li_epi_id:       Math.floor(Math.random() * 500) + 1,
        li_service_date: randomDate(yr, now),
        li_amount:       +(Math.random() * 4800 + 200).toFixed(2),
        li_code:         `CPT${String(Math.floor(Math.random() * 90000) + 10000)}`,
        li_status:       pick(["Billed", "Paid", "Pending", "Denied"]),
      });
    } else if (tableName === "PDGM.PDGM_PERIOD") {
      rows.push({
        pp_id:        i,
        pp_epi_id:    Math.floor(Math.random() * 500) + 1,
        pp_period_no: Math.floor(Math.random() * 4) + 1,
        pp_lupa:      Math.random() > 0.8,
        pp_hipps:     `H${String(Math.floor(Math.random() * 9000) + 1000)}`,
        pp_start_date: randomDate(yr, now),
      });
    } else {
      rows.push({ id: i, name: `Row ${i}`, table: tableName });
    }
  }
  return rows;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;

  const decodedTable = decodeURIComponent(table);

  // Reject malformed identifiers before any database access. Catalog
  // membership is checked against the active static/live source below.
  const normalizedTable = normalizeTableIdentifier(decodedTable);
  if (!normalizedTable) {
    return NextResponse.json(
      { error: `Table identifier "${decodedTable}" is invalid.` },
      { status: 400 }
    );
  }

  const dbConfigured = isDbConfigured();
  if (!dbConfigured && !isKnownStaticTable(decodedTable)) {
    return NextResponse.json(
      { error: `Table "${decodedTable}" is not available in the metadata catalog.` },
      { status: 400 }
    );
  }

  const { searchParams } = req.nextUrl;
  const page      = Math.max(1, parseInt(searchParams.get("page")     ?? "1"));
  const pageSize  = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));
  const sortCol   = searchParams.get("sort") ?? null;
  const sortDir   = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const filtersRaw = searchParams.get("filters");

  let filters: Record<string, string>;
  try {
    filters = parseTableFilters(filtersRaw);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid filters." },
      { status: 400 }
    );
  }

  // Demo mode — no DB configured
  if (!dbConfigured) {
    const TOTAL_DEMO = decodedTable === "BRANCHES"     ? BRANCH_CODES.length
                     : decodedTable === "SERVICE_LINES" ? SERVICE_LINES.length
                     : decodedTable === "CARE_TYPES"    ? CARE_TYPES.length
                     : 500;

    let rows = generateRows(decodedTable, TOTAL_DEMO);
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    const knownColumns = new Set(cols.map((column) => column.toLowerCase()));
    const unknownFilter = Object.keys(filters).find((column) => !knownColumns.has(column.toLowerCase()));
    if (unknownFilter) {
      return NextResponse.json({ error: `Unknown filter column "${unknownFilter}".` }, { status: 400 });
    }

    // Apply column filters (case-insensitive substring)
    for (const [col, val] of Object.entries(filters)) {
      if (!val) continue;
      const lower = val.toLowerCase();
      rows = rows.filter((r) =>
        String(r[col] ?? "").toLowerCase().includes(lower)
      );
    }

    // Sort
    if (sortCol) {
      rows.sort((a, b) => {
        const av = a[sortCol]; const bv = b[sortCol];
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    const total  = rows.length;
    const offset = (page - 1) * pageSize;
    const slice  = rows.slice(offset, offset + pageSize);

    return NextResponse.json({
      table:      decodedTable,
      columns:    cols,
      rows:       slice,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      source:     "demo",
    });
  }

  // Live mode — authorize and query against the same catalog exposed by
  // /api/schema/tables, including tables that are not in static metadata.
  try {
    const liveCatalog = await getLiveTableCatalog();
    if (!isTableInCatalog(normalizedTable, liveCatalog)) {
      return NextResponse.json(
        { error: `Table "${decodedTable}" is not available in the metadata catalog.` },
        { status: 400 }
      );
    }

    const { executeMultiQueryWithParams, executeQueryWithParams } = await import("@/lib/services/db");

    // Resolve column identifiers from SQL Server metadata before using them in
    // ORDER BY or filter predicates. Values remain bound parameters.
    const safeTable = normalizedTable;
    const columnRows = await executeQueryWithParams(
      `SELECT c.name AS column_name
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@TableName)
       ORDER BY c.column_id`,
      [{ name: "TableName", value: safeTable, type: "nvarchar" }]
    );
    const cols = columnRows
      .map((row) => String(row.column_name ?? ""))
      .filter(Boolean);
    if (cols.length === 0) {
      return NextResponse.json({ error: `No columns are available for table "${decodedTable}".` }, { status: 400 });
    }

    const canonicalColumns = new Map(cols.map((column) => [column.toLowerCase(), column]));
    const resolvedSort = sortCol ? canonicalColumns.get(sortCol.toLowerCase()) : null;
    if (sortCol && !resolvedSort) {
      return NextResponse.json({ error: `Unknown sort column "${sortCol}".` }, { status: 400 });
    }

    const filterSql = buildTableFilterSql(filters, cols);
    const orderClause = resolvedSort
      ? `ORDER BY [${resolvedSort.replace(/]/g, "]]" )}] ${sortDir.toUpperCase()}`
      : "ORDER BY (SELECT NULL)";
    const offset = (page - 1) * pageSize;
    const qualifiedTable = `[${safeTable.split(".").join("].[")}]`;
    const query = `
      SELECT *
      FROM ${qualifiedTable}
      ${filterSql.whereClause}
      ${orderClause}
      OFFSET @PageOffset ROWS FETCH NEXT @PageSize ROWS ONLY;

      SELECT COUNT_BIG(*) AS total
      FROM ${qualifiedTable}
      ${filterSql.whereClause};
    `;
    const queryParams = [
      ...filterSql.params,
      { name: "PageOffset", value: offset, type: "int" },
      { name: "PageSize", value: pageSize, type: "int" },
    ];

    const loadPage = async () => {
      const sqlStart = Date.now();
      const result = await executeMultiQueryWithParams(query, queryParams);
      const rows = result.resultSets[0]?.rows ?? [];
      const countRows = result.resultSets[1]?.rows ?? [];
      return {
        total: Number(countRows[0]?.total ?? 0),
        rows,
        sqlDurationMs: Date.now() - sqlStart,
      };
    };

    const ttlMs = REFERENCE_TABLE_TTLS.get(safeTable.toUpperCase());
    const requestStart = Date.now();
    const scopedKey = buildCacheKey(`table:${safeTable}`, { page, pageSize, sortCol, sortDir, filters }, {
      tenantId: req.headers.get("x-tenant-id") ?? "default",
      role: req.headers.get("x-user-role") ?? "viewer",
    });
    const loaded = ttlMs
      ? await withCache(scopedKey, loadPage, {
          ttlMs,
          namespace: "reference",
          tags: [`table:${safeTable.toUpperCase()}`],
        })
      : { value: await loadPage(), cacheStatus: "BYPASS" as const };
    const { total, rows, sqlDurationMs } = loaded.value;
    const durationMs = Date.now() - requestStart;

    recordPerformanceSample({
      route: "/api/data/[table]",
      method: "GET",
      statusCode: 200,
      durationMs,
      sqlDurationMs: loaded.cacheStatus === "HIT" ? undefined : sqlDurationMs,
      cacheStatus: loaded.cacheStatus,
      workload: ttlMs ? "reference" : "patient",
    });

    const response = NextResponse.json({
      table: decodedTable,
      columns: cols,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      source: "live_db",
      cacheStatus: loaded.cacheStatus,
    });
    response.headers.set("X-Cache", loaded.cacheStatus);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    if (err instanceof TableFilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    // If the DB is configured but unreachable (VPN/firewall/wrong host), don't
    // hard-fail with a blank 500. Only the statically-known tables can be
    // reconstructed as demo data; unknown live-only tables return 503.
    const unreachable =
      err instanceof BackendUnreachableError ||
      ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "EAI_AGAIN"].includes(
        (err as { code?: string })?.code ?? ""
      );

    if (unreachable && DEMO_TABLES.includes(decodedTable)) {
      console.warn(`[db] /api/data: DB unreachable, serving demo data for ${decodedTable}`);
      const TOTAL_DEMO =
        decodedTable === "BRANCHES" ? BRANCH_CODES.length
        : decodedTable === "SERVICE_LINES" ? SERVICE_LINES.length
        : decodedTable === "CARE_TYPES" ? CARE_TYPES.length
        : 500;
      let rows = generateRows(decodedTable, TOTAL_DEMO);
      const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
      const knownColumns = new Set(cols.map((column) => column.toLowerCase()));
      const unknownFilter = Object.keys(filters).find((column) => !knownColumns.has(column.toLowerCase()));
      if (unknownFilter) {
        return NextResponse.json({ error: `Unknown filter column "${unknownFilter}".` }, { status: 400 });
      }
      for (const [col, val] of Object.entries(filters)) {
        if (!val) continue;
        const lower = val.toLowerCase();
        rows = rows.filter((r) => String(r[col] ?? "").toLowerCase().includes(lower));
      }
      if (sortCol) {
        rows.sort((a, b) => {
          const av = a[sortCol]; const bv = b[sortCol];
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
      const total = rows.length;
      const offset = (page - 1) * pageSize;
      const slice = rows.slice(offset, offset + pageSize);
      return NextResponse.json({
        table: decodedTable,
        columns: cols,
        rows: slice,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        source: "demo_fallback",
        warning: "Database unreachable — showing sample data.",
      });
    }

    console.error("[db] /api/data error:", err);
    if (unreachable) {
      return NextResponse.json(
        { error: "Database is currently unreachable. Please try again shortly." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
