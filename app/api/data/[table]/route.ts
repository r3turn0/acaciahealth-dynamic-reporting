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

import { NextRequest, NextResponse } from "next/server";
import schemaConfig from "@/lib/config/schemaConfig.json";

const ALLOWED_TABLES = Object.keys(schemaConfig);

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
  if (!ALLOWED_TABLES.includes(decodedTable)) {
    return NextResponse.json(
      { error: `Table "${decodedTable}" is not in the allowed list.` },
      { status: 400 }
    );
  }

  const { searchParams } = req.nextUrl;
  const page      = Math.max(1, parseInt(searchParams.get("page")     ?? "1"));
  const pageSize  = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));
  const sortCol   = searchParams.get("sort") ?? null;
  const sortDir   = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const filtersRaw = searchParams.get("filters");

  let filters: Record<string, string> = {};
  try {
    if (filtersRaw) filters = JSON.parse(filtersRaw);
  } catch {
    // ignore invalid JSON
  }

  // Demo mode — generate deterministic-ish mock data
  if (!process.env.SQL_CONNECTION_STRING) {
    const TOTAL_DEMO = decodedTable === "BRANCHES"     ? BRANCH_CODES.length
                     : decodedTable === "SERVICE_LINES" ? SERVICE_LINES.length
                     : decodedTable === "CARE_TYPES"    ? CARE_TYPES.length
                     : 500;

    let rows = generateRows(decodedTable, TOTAL_DEMO);

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
    const cols   = slice.length > 0 ? Object.keys(slice[0]) : [];

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

  // Live mode — query SQL Server
  try {
    const { executeRawQuery } = await import("@/lib/services/db");

    // Build a safe parameterised-style TOP + ORDER BY query (columns are from allowlist)
    const safeTable = decodedTable.replace(/[^a-zA-Z0-9_.]/g, "");
    const countRows = await executeRawQuery(
      `SELECT COUNT(*) AS total FROM [${safeTable.replace(".", "].[").replace(/\[/g, "[")}]`
    );
    const total = (countRows[0]?.total as number) ?? 0;

    const orderClause = sortCol
      ? `ORDER BY [${sortCol.replace(/[^a-zA-Z0-9_]/g, "")}] ${sortDir.toUpperCase()}`
      : "ORDER BY (SELECT NULL)";

    const offset = (page - 1) * pageSize;
    const query  = `
      SELECT *
      FROM   [${safeTable.replace(".", "].[").replace(/\[/g, "[")}]
      ${orderClause}
      OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
    `;

    const rows = await executeRawQuery(query);
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

    return NextResponse.json({
      table:      decodedTable,
      columns:    cols,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      source:     "live_db",
    });
  } catch (err) {
    console.error("[v0] /api/data error:", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
