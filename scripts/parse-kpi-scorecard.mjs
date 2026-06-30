/**
 * Build-time script: parses KPI-Scorecard Excel into data/kpi-schemas.json
 * Run: node scripts/parse-kpi-scorecard.mjs
 */
import { read, utils } from "xlsx";
import { readFileSync, writeFileSync } from "fs";

const FILE = "data/KPI-Scorecard-67-61f8f1.xlsx";
const OUT  = "data/kpi-schemas.json";

const buf = readFileSync(FILE);
const wb  = read(buf, { cellDates: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMonthLabel(s) {
  return /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/i.test(s);
}

function isWeekLabel(s) {
  return /^\d{1,2}\/\d{1,2}-\d{1,2}\/\d{1,2}$/.test(s);
}

function isDateKey(s) {
  return isMonthLabel(s) || isWeekLabel(s);
}

function formatDate(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return d.toISOString().slice(0, 7); // YYYY-MM
  }
  return String(d);
}

function toSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Sheet 1: Company Scorecard ────────────────────────────────────────────────
// Columns: KPI (category header), Definition, Benchmark, Service Line, <date cols>
function parseCompanyScorecard(ws) {
  const rows = utils.sheet_to_json(ws, { defval: null });
  const dateKeys = Object.keys(rows[0] || {}).filter(isMonthLabel);

  let currentKpi = null;
  const kpis = [];

  for (const row of rows) {
    const kpiName = row["KPI"];
    const definition = row["Definition "];
    const benchmark = row["Benchmark"];
    const serviceLine = String(row["Service Line"] || "").trim();

    if (kpiName && !definition && !serviceLine) {
      // section header row
      currentKpi = { name: String(kpiName).trim(), id: toSlug(String(kpiName).trim()), rows: [] };
      kpis.push(currentKpi);
      continue;
    }

    if (currentKpi && (definition || serviceLine)) {
      const series = {};
      for (const dk of dateKeys) {
        const v = row[dk];
        if (v !== null && v !== undefined && v !== "") series[dk] = Number(v) || 0;
      }
      currentKpi.rows.push({
        definition: String(definition || "").trim() || null,
        benchmark: benchmark !== null ? String(benchmark) : null,
        serviceLine: serviceLine || null,
        series,
      });
    }
  }

  return {
    id: "company_scorecard",
    sheetName: "Company Scorecard",
    title: "Company Scorecard",
    description: "High-level KPIs across all service lines with weekly and monthly actuals",
    domain: "executive",
    frequency: "monthly",
    serviceLines: ["HH", "Palliative", "Hospice"],
    kpis: kpis.map((k) => ({
      id: k.id,
      name: k.name,
      rows: k.rows,
      periods: dateKeys,
    })),
    columns: [
      { name: "kpi_name",      displayName: "KPI",           type: "VARCHAR", role: "dimension" },
      { name: "service_line",  displayName: "Service Line",  type: "VARCHAR", role: "dimension" },
      { name: "period",        displayName: "Period",        type: "DATE",    role: "time_dimension" },
      { name: "value",         displayName: "Value",         type: "DECIMAL", role: "measure", aggregation: "sum" },
      { name: "benchmark",     displayName: "Benchmark",     type: "VARCHAR", role: "dimension" },
      { name: "definition",    displayName: "Definition",    type: "VARCHAR", role: "dimension" },
    ],
  };
}

// ── Sheet 2: Financial ────────────────────────────────────────────────────────
function parseFinancial(ws) {
  const rows = utils.sheet_to_json(ws, { defval: null });
  const allKeys = Object.keys(rows[0] || {});
  const dateKeys = allKeys.filter(
    (k) => isMonthLabel(k) || isWeekLabel(k)
  );

  let currentKpi = null;
  const kpis = [];

  for (const row of rows) {
    const kpiName = row["KPI"];
    const definition = row["Definition "];
    const serviceLine = String(row["Service Line"] || "").trim().replace(/\s+/g, " ");

    if (kpiName && !serviceLine) {
      currentKpi = { name: String(kpiName).trim(), id: toSlug(String(kpiName).trim()), rows: [] };
      kpis.push(currentKpi);
      continue;
    }

    if (currentKpi && (serviceLine || definition)) {
      const series = {};
      for (const dk of dateKeys) {
        const v = row[dk];
        if (v !== null && v !== undefined) series[dk] = Number(v) || 0;
      }
      currentKpi.rows.push({
        definition: String(definition || "").trim() || null,
        benchmark: row["Benchmark"] !== null ? String(row["Benchmark"] || "") : null,
        serviceLine: serviceLine || null,
        series,
      });
    }
  }

  return {
    id: "financial",
    sheetName: "Financial",
    title: "Financial KPIs",
    description: "AR aging, revenue cycle, collections, and billing metrics by service line",
    domain: "finance",
    frequency: "monthly",
    serviceLines: ["HH", "PAL", "Hospice"],
    kpis: kpis.map((k) => ({ id: k.id, name: k.name, rows: k.rows })),
    columns: [
      { name: "kpi_name",     displayName: "KPI",          type: "VARCHAR", role: "dimension" },
      { name: "service_line", displayName: "Service Line", type: "VARCHAR", role: "dimension" },
      { name: "period",       displayName: "Period",       type: "DATE",    role: "time_dimension" },
      { name: "value",        displayName: "Value",        type: "DECIMAL", role: "measure", aggregation: "sum" },
      { name: "benchmark",    displayName: "Benchmark",    type: "VARCHAR", role: "dimension" },
      { name: "definition",   displayName: "Definition",   type: "VARCHAR", role: "dimension" },
    ],
  };
}

// ── Sheet 3: HR ───────────────────────────────────────────────────────────────
function parseHR(ws) {
  const rows = utils.sheet_to_json(ws, { defval: null });
  const dateKeys = Object.keys(rows[0] || {}).filter(isMonthLabel);

  let currentKpi = null;
  const kpis = [];

  for (const row of rows) {
    const kpiName = row["KPI"];
    const definition = row["Definition "];
    const serviceLine = String(row["Service Line"] || "").trim();

    if (kpiName && !serviceLine && !definition) {
      currentKpi = { name: String(kpiName).trim(), id: toSlug(String(kpiName).trim()), rows: [] };
      kpis.push(currentKpi);
      continue;
    }

    if (serviceLine || definition) {
      if (!currentKpi) {
        currentKpi = { name: "HR Metrics", id: "hr_metrics", rows: [] };
        kpis.push(currentKpi);
      }
      const series = {};
      for (const dk of dateKeys) {
        const v = row[dk];
        if (v !== null && v !== undefined) series[dk] = Number(v) || 0;
      }
      currentKpi.rows.push({
        definition: String(definition || "").trim() || null,
        benchmark: row["Benchmark"] !== null ? String(row["Benchmark"] || "") : null,
        serviceLine: serviceLine || null,
        series,
      });
    }
  }

  return {
    id: "hr",
    sheetName: "HR",
    title: "HR / Recruitment KPIs",
    description: "Headcount, open positions, turnover, and recruitment metrics by service line",
    domain: "hr",
    frequency: "monthly",
    serviceLines: ["Home Health", "Palliative", "Hospice"],
    kpis: kpis.map((k) => ({ id: k.id, name: k.name, rows: k.rows })),
    columns: [
      { name: "kpi_name",     displayName: "KPI",          type: "VARCHAR", role: "dimension" },
      { name: "service_line", displayName: "Service Line", type: "VARCHAR", role: "dimension" },
      { name: "period",       displayName: "Period",       type: "DATE",    role: "time_dimension" },
      { name: "value",        displayName: "Count",        type: "INTEGER", role: "measure", aggregation: "sum" },
      { name: "benchmark",    displayName: "Benchmark",    type: "VARCHAR", role: "dimension" },
    ],
  };
}

// ── Sheet 4: Avg Salary by Position ──────────────────────────────────────────
function parseAvgSalary(ws) {
  const rows = utils.sheet_to_json(ws, { defval: null });
  const clean = rows.filter((r) => r["Position"] && r["Average Annual Pay"]);

  return {
    id: "avg_salary",
    sheetName: "Avg Salary by Position",
    title: "Average Salary by Position",
    description: "FTE count, total pay, and average annual compensation by company, location, and role",
    domain: "hr",
    frequency: "snapshot",
    serviceLines: ["Palliative", "Home Health", "Hospice"],
    kpis: [
      {
        id: "avg_annual_pay",
        name: "Average Annual Pay",
        rows: clean.map((r) => ({
          company:   String(r["Company"] || "").trim(),
          location:  String(r["Location"] || "").trim(),
          position:  String(r["Position"] || "").trim(),
          totalPay:  Number(r["Total Pay 05/09/25"]) || 0,
          fteCount:  Number(r["FTE Count"]) || 0,
          avgAnnualPay: Number(r["Average Annual Pay"]) || 0,
          notes:     r["Notes"] ? String(r["Notes"]).trim() : null,
          series: {},
        })),
      },
    ],
    columns: [
      { name: "company",         displayName: "Company",            type: "VARCHAR", role: "dimension" },
      { name: "location",        displayName: "Location",           type: "VARCHAR", role: "dimension" },
      { name: "position",        displayName: "Position",           type: "VARCHAR", role: "dimension" },
      { name: "fte_count",       displayName: "FTE Count",          type: "DECIMAL", role: "measure", aggregation: "sum" },
      { name: "total_pay",       displayName: "Total Pay",          type: "DECIMAL", role: "measure", aggregation: "sum" },
      { name: "avg_annual_pay",  displayName: "Avg Annual Pay",     type: "DECIMAL", role: "measure", aggregation: "avg" },
    ],
  };
}

// ── Sheet 5 & 6 & 7: Scorecard sheets (Hospice Admin, HH Admin, Central) ─────
// These sheets have a shifted header — row[0] is the real header row
function parseScorecardSheet(ws, sheetName, id, title, description, domain, serviceLines) {
  const rawRows = utils.sheet_to_json(ws, { defval: null, header: 1 });

  // Find the actual header row (contains "KPI" or the sheet title)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rawRows.length); i++) {
    const r = rawRows[i];
    if (r && r.some((v) => v === "KPI" || (typeof v === "string" && v.includes("KPI")))) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = rawRows[headerRowIdx];
  // Columns: [KPI/title, ?, Benchmark, ServiceLine, ...date cols]
  // Find which column indices correspond to monthly date labels
  const dateCols = [];
  for (let ci = 0; ci < headerRow.length; ci++) {
    const v = headerRow[ci];
    if (v instanceof Date) {
      dateCols.push({ idx: ci, label: formatDate(v) });
    } else if (typeof v === "string" && isWeekLabel(v)) {
      dateCols.push({ idx: ci, label: v });
    }
  }

  // KPI col is index 0, benchmark ~index 1, service line ~index 2 or 3
  const kpiCol = 0;
  const benchmarkCol = headerRow.findIndex((v) => v === "Benchmark" || (typeof v === "string" && v.toLowerCase().includes("bench")));
  const serviceLineCol = headerRow.findIndex((v) => typeof v === "string" && v.toLowerCase().includes("service"));

  let currentKpi = null;
  const kpis = [];

  for (let ri = headerRowIdx + 1; ri < rawRows.length; ri++) {
    const row = rawRows[ri];
    if (!row || row.every((v) => v === null)) continue;

    const kpiVal = row[kpiCol];
    const serviceLineVal = serviceLineCol >= 0 ? String(row[serviceLineCol] || "").trim() : "";
    const benchmarkVal = benchmarkCol >= 0 ? row[benchmarkCol] : null;

    if (kpiVal && !serviceLineVal) {
      // section/category header
      currentKpi = { name: String(kpiVal).trim(), id: toSlug(String(kpiVal).trim()), rows: [] };
      kpis.push(currentKpi);
      continue;
    }

    if (serviceLineVal || (kpiVal && currentKpi)) {
      if (!currentKpi) {
        currentKpi = { name: title, id: toSlug(title), rows: [] };
        kpis.push(currentKpi);
      }
      const series = {};
      for (const { idx, label } of dateCols) {
        const v = row[idx];
        if (v !== null && v !== undefined) series[label] = Number(v) || 0;
      }
      currentKpi.rows.push({
        definition: null,
        benchmark: benchmarkVal !== null && benchmarkVal !== undefined ? String(benchmarkVal) : null,
        serviceLine: serviceLineVal || (kpiVal ? String(kpiVal).trim() : null),
        series,
      });
    }
  }

  const periods = dateCols.map((d) => d.label);

  return {
    id,
    sheetName,
    title,
    description,
    domain,
    frequency: "weekly",
    serviceLines,
    kpis: kpis.map((k) => ({ id: k.id, name: k.name, rows: k.rows, periods })),
    columns: [
      { name: "kpi_name",     displayName: "KPI",          type: "VARCHAR", role: "dimension" },
      { name: "service_line", displayName: "Service Line", type: "VARCHAR", role: "dimension" },
      { name: "week",         displayName: "Week",         type: "DATE",    role: "time_dimension" },
      { name: "value",        displayName: "Value",        type: "DECIMAL", role: "measure", aggregation: "avg" },
      { name: "benchmark",    displayName: "Benchmark",    type: "VARCHAR", role: "dimension" },
    ],
  };
}

// ── Parse all sheets ──────────────────────────────────────────────────────────
const schemas = [
  parseCompanyScorecard(wb.Sheets["Company Scorecard"]),
  parseFinancial(wb.Sheets["Financial"]),
  parseHR(wb.Sheets["HR"]),
  parseAvgSalary(wb.Sheets["Avg Salary by Position"]),
  parseScorecardSheet(
    wb.Sheets["Hospice Administrator Scorecard"],
    "Hospice Administrator Scorecard",
    "hospice_admin_scorecard",
    "Hospice Administrator Scorecard",
    "Weekly census, clinical, and operational KPIs for the Hospice service line",
    "clinical",
    ["Hospice OC", "Hospice Admin"]
  ),
  parseScorecardSheet(
    wb.Sheets["HH Admin Scorecard"],
    "HH Admin Scorecard",
    "hh_admin_scorecard",
    "HH & Palliative Admin Scorecard",
    "Weekly census, visit, and compliance KPIs for Home Health and Palliative service lines",
    "clinical",
    ["HH", "Palliative"]
  ),
  parseScorecardSheet(
    wb.Sheets["Central Support HH&P"],
    "Central Support HH&P",
    "central_support",
    "Central Support HH&P Scorecard",
    "Central support team KPIs for Home Health and Palliative operations",
    "operations",
    ["HH", "Palliative"]
  ),
];

const output = {
  generated_at: new Date().toISOString(),
  source_file: FILE,
  sheet_count: schemas.length,
  schemas,
};

writeFileSync(OUT, JSON.stringify(output, null, 2));
console.log(`Wrote ${OUT} — ${schemas.length} schemas, ${schemas.reduce((a, s) => a + s.kpis.length, 0)} KPI groups`);
