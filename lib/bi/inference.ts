/**
 * Tabular parsing + schema inference for the Dataset Builder.
 *
 * Parses CSV/XLSX into rows (via SheetJS) and infers a typed field list from
 * the values. Pure/browser-safe — SheetJS runs fine on the client, so files
 * never need to be uploaded just to build a schema.
 */

import * as XLSX from "xlsx";
import type { DataRow, DatasetField, FieldType } from "./types";
import { parseScorecard, type ScorecardResult } from "./scorecard";

export interface ParsedSheet {
  name: string;
  fields: DatasetField[];
  rows: DataRow[];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  /** Present when the workbook is a pivoted KPI scorecard (see scorecard.ts). */
  scorecard?: ScorecardResult;
}

const BOOL_TRUE = new Set(["true", "yes", "y", "1"]);
const BOOL_FALSE = new Set(["false", "no", "n", "0"]);

function looksBoolean(v: string): boolean {
  const s = v.trim().toLowerCase();
  return BOOL_TRUE.has(s) || BOOL_FALSE.has(s);
}

function looksNumber(v: string): boolean {
  if (v.trim() === "") return false;
  // Strip common currency/thousands formatting before testing.
  const cleaned = v.replace(/[$,%\s]/g, "");
  return cleaned !== "" && !Number.isNaN(Number(cleaned));
}

function looksDate(v: string): boolean {
  const s = v.trim();
  if (s === "" || looksNumber(s)) return false;
  // Require date-ish separators so plain numbers aren't misread as dates.
  if (!/[-/:]/.test(s) && !/\d{4}/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

/** Infer a field type from a column of raw string values. */
export function inferType(values: string[]): FieldType {
  const sample = values.map((v) => (v ?? "").toString().trim()).filter((v) => v !== "");
  if (sample.length === 0) return "string";

  if (sample.every(looksBoolean)) return "boolean";
  if (sample.every(looksNumber)) return "number";
  if (sample.every(looksDate)) return "date";
  return "string";
}

/** Coerce a raw cell value to the inferred field type. */
export function coerce(value: unknown, type: FieldType): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  const s = value.toString().trim();
  switch (type) {
    case "number": {
      const n = Number(s.replace(/[$,%\s]/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    case "boolean":
      return BOOL_TRUE.has(s.toLowerCase());
    case "date": {
      const t = Date.parse(s);
      return Number.isNaN(t) ? s : new Date(t).toISOString().slice(0, 10);
    }
    default:
      return s;
  }
}

/** Build a typed field list + coerced rows from an array of raw records. */
export function inferSchemaFromRecords(records: Record<string, unknown>[]): {
  fields: DatasetField[];
  rows: DataRow[];
} {
  if (records.length === 0) return { fields: [], rows: [] };

  const columns = Array.from(
    records.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const fields: DatasetField[] = columns.map((name) => ({
    name,
    type: inferType(records.map((r) => (r[name] ?? "").toString())),
  }));

  const rows: DataRow[] = records.map((r) => {
    const row: DataRow = {};
    for (const f of fields) row[f.name] = coerce(r[f.name], f.type);
    return row;
  });

  return { fields, rows };
}

/** Parse a CSV or XLSX file into one or more typed sheets. */
export async function parseFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();

  // First try the scorecard shape (wide/pivoted KPI layout). If it matches we
  // return a single tidy long-format sheet plus the structured report index.
  const isSpreadsheet = /\.xlsx?$/i.test(file.name);
  if (isSpreadsheet) {
    const datasetBase = file.name.replace(/\.[^.]+$/, "").trim() || "Scorecard";
    const scorecard = parseScorecard(buf, datasetBase);
    if (scorecard.isScorecard) {
      return { sheets: [scorecard.tidy], scorecard };
    }
  }

  const wb = XLSX.read(buf, { type: "array", cellDates: false });

  const sheets: ParsedSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: false,
    });
    const { fields, rows } = inferSchemaFromRecords(records);
    return { name, fields, rows };
  }).filter((s) => s.fields.length > 0);

  return { sheets };
}
