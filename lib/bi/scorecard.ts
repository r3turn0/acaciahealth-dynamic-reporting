/**
 * Scorecard-aware workbook parser.
 *
 * Acacia's KPI scorecards are stored in a *wide / pivoted* layout that the
 * generic tabular importer can't read correctly:
 *
 *   | KPI | Definition | Benchmark | Service Line | <period 1> | <period 2> | … |
 *
 * where the period columns are a mix of month markers (real dates) and weekly
 * ranges ("3/2-3/8"), the KPI name in column A acts as a *section header* that
 * spans the rows beneath it, and the bottom of each block holds colour-coded
 * total rows ("Total Hospice", "All Locations", …).
 *
 * Feeding that straight into `sheet_to_json` produces ~90 meaningless "date"
 * columns and loses the KPI → Service Line → Period structure. This module
 * detects the scorecard shape and *unpivots* it into a tidy long-format table
 * plus a per-row report index so the BI tab can break each KPI down correctly,
 * separated by worksheet, with totals flagged.
 */

import * as XLSX from "xlsx";
import type { DataRow, DatasetField } from "./types";

export interface ScorecardPeriod {
  label: string;
  type: "Weekly" | "Monthly";
}

export interface ScorecardValue {
  period: string;
  type: "Weekly" | "Monthly";
  value: number;
}

/** One source row = one possible KPI report (KPI × Service Line). */
export interface ScorecardReport {
  worksheet: string;
  kpi: string;
  definition: string;
  benchmark: number | null;
  serviceLine: string;
  isTotal: boolean;
  values: ScorecardValue[];
  latestPeriod: string | null;
  latestValue: number | null;
}

export interface ScorecardWorksheet {
  name: string;
  periods: ScorecardPeriod[];
  reportCount: number;
}

export interface ScorecardResult {
  isScorecard: boolean;
  worksheets: ScorecardWorksheet[];
  reports: ScorecardReport[];
  /** Tidy long-format table for the BI dataset store. */
  tidy: { name: string; fields: DatasetField[]; rows: DataRow[] };
}

const TIDY_FIELDS: DatasetField[] = [
  { name: "Worksheet", type: "string" },
  { name: "KPI", type: "string" },
  { name: "Service Line", type: "string" },
  { name: "Definition", type: "string" },
  { name: "Benchmark", type: "number" },
  { name: "Period", type: "string" },
  { name: "Period Type", type: "string" },
  { name: "Value", type: "number" },
  { name: "Is Total", type: "boolean" },
];

const TOTAL_RE = /\b(total|all locations|combined|comb\.)\b/i;

function norm(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Classify + label a period column header. */
function periodFromHeader(cell: unknown): ScorecardPeriod | null {
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    const m = cell.getMonth() + 1;
    const d = cell.getDate();
    const label = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // First-of-month markers are the monthly roll-ups; other dates are weekly endings.
    return { label, type: d === 1 ? "Monthly" : "Weekly" };
  }
  const s = norm(cell);
  if (s === "") return null;
  // Weekly ranges like "3/2-3/8" or "12/28-1/3".
  if (/^\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}$/.test(s)) {
    return { label: s, type: "Weekly" };
  }
  // Any other non-empty header still counts as a period column (labelled as-is).
  return { label: s, type: "Weekly" };
}

interface MetaCols {
  kpi: number;
  definition: number;
  benchmark: number;
  serviceLine: number;
}

/** Find the header row + metadata column indices for a sheet, if it is a scorecard. */
function detectHeader(rows: unknown[][]): { headerRow: number; meta: MetaCols } | null {
  const limit = Math.min(rows.length, 6);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    let kpi = -1;
    let serviceLine = -1;
    let definition = -1;
    let benchmark = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]).toLowerCase();
      if (cell === "kpi" && kpi === -1) kpi = c;
      else if (cell.startsWith("definition") && definition === -1) definition = c;
      else if (cell.startsWith("benchmark") && benchmark === -1) benchmark = c;
      else if (cell === "service line" && serviceLine === -1) serviceLine = c;
    }
    if (kpi !== -1 && serviceLine !== -1) {
      return {
        headerRow: r,
        meta: {
          kpi,
          definition: definition === -1 ? kpi + 1 : definition,
          benchmark: benchmark === -1 ? kpi + 2 : benchmark,
          serviceLine,
        },
      };
    }
  }
  return null;
}

function parseSheet(
  name: string,
  rows: unknown[][]
): { worksheet: ScorecardWorksheet; reports: ScorecardReport[] } | null {
  const detected = detectHeader(rows);
  if (!detected) return null;
  const { headerRow, meta } = detected;
  const header = rows[headerRow] ?? [];

  // Period columns = everything to the right of the Service Line column that
  // has a header value.
  const periodCols: { index: number; period: ScorecardPeriod }[] = [];
  for (let c = meta.serviceLine + 1; c < header.length; c++) {
    const period = periodFromHeader(header[c]);
    if (period) periodCols.push({ index: c, period });
  }
  if (periodCols.length === 0) return null;

  const reports: ScorecardReport[] = [];
  let currentKpi = "";

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const kpiCell = norm(row[meta.kpi]);
    if (kpiCell) currentKpi = kpiCell;

    const serviceLine = norm(row[meta.serviceLine]);
    const definition = norm(row[meta.definition]);
    const benchmark = toNum(row[meta.benchmark]);

    const values: ScorecardValue[] = [];
    for (const { index, period } of periodCols) {
      const n = toNum(row[index]);
      if (n !== null) values.push({ period: period.label, type: period.type, value: n });
    }

    // A row is a report only if it carries a service line or at least one value.
    // Pure section-title rows (KPI name only) just set the current KPI context.
    if (!serviceLine && values.length === 0) continue;
    if (!currentKpi && !serviceLine) continue;

    const isTotal =
      TOTAL_RE.test(serviceLine) ||
      (!serviceLine && (TOTAL_RE.test(definition) || TOTAL_RE.test(kpiCell)));

    const latest = values.length ? values[values.length - 1] : null;

    reports.push({
      worksheet: name,
      kpi: currentKpi || "(unlabeled)",
      definition,
      benchmark,
      serviceLine,
      isTotal,
      values,
      latestPeriod: latest ? latest.period : null,
      latestValue: latest ? latest.value : null,
    });
  }

  if (reports.length === 0) return null;

  return {
    worksheet: { name, periods: periodCols.map((p) => p.period), reportCount: reports.length },
    reports,
  };
}

/**
 * Detect + parse a scorecard workbook from a raw buffer. Returns
 * `{ isScorecard: false }` when the workbook is an ordinary flat table so the
 * caller can fall back to the generic importer.
 */
export function parseScorecard(buf: ArrayBuffer, datasetName: string): ScorecardResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const worksheets: ScorecardWorksheet[] = [];
  const reports: ScorecardReport[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    const parsed = parseSheet(name, rows);
    if (parsed) {
      worksheets.push(parsed.worksheet);
      reports.push(...parsed.reports);
    }
  }

  // Require at least one scorecard-shaped sheet to claim this is a scorecard.
  if (worksheets.length === 0) {
    return {
      isScorecard: false,
      worksheets: [],
      reports: [],
      tidy: { name: datasetName, fields: TIDY_FIELDS, rows: [] },
    };
  }

  // Unpivot into tidy long-format rows for the BI dataset store.
  const rows: DataRow[] = [];
  for (const rep of reports) {
    for (const v of rep.values) {
      rows.push({
        Worksheet: rep.worksheet,
        KPI: rep.kpi,
        "Service Line": rep.serviceLine || "(overall)",
        Definition: rep.definition,
        Benchmark: rep.benchmark,
        Period: v.period,
        "Period Type": v.type,
        Value: v.value,
        "Is Total": rep.isTotal,
      });
    }
  }

  return {
    isScorecard: true,
    worksheets,
    reports,
    tidy: { name: datasetName, fields: TIDY_FIELDS, rows },
  };
}
