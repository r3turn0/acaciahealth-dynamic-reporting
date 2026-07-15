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

// ── Relationship inference ────────────────────────────────────────────────────

export interface SuggestedRelationship {
  fromField: string;
  toDataset: string;
  toField: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Infer likely join relationships between `currentFields` and a list of other
 * datasets.  Uses three signals in priority order:
 *
 *  1. Exact name match across datasets with the same field type.
 *  2. FK suffix convention: a field ending in `_id` / `Id` / `_key` in the
 *     current dataset matches a field with the same stem in another dataset
 *     (e.g. `patient_id` → `patients.id`).
 *  3. Shared semantic prefixes: fields that start with the same first two
 *     tokens and share a numeric type (common for integer surrogate keys).
 */
export function inferRelationships(
  currentFields: DatasetField[],
  otherDatasets: Array<{ id: string; name: string; fields: DatasetField[] }>
): SuggestedRelationship[] {
  const suggestions: SuggestedRelationship[] = [];
  const seen = new Set<string>();

  for (const ds of otherDatasets) {
    for (const myField of currentFields) {
      if (!myField.name.trim()) continue;
      const myName = myField.name.trim().toLowerCase();

      for (const theirField of ds.fields) {
        if (!theirField.name.trim()) continue;
        const theirName = theirField.name.trim().toLowerCase();
        const key = `${myName}→${ds.name}:${theirName}`;
        if (seen.has(key)) continue;

        // Signal 1 — exact field name match with same type
        if (myName === theirName && myField.type === theirField.type) {
          seen.add(key);
          suggestions.push({
            fromField: myField.name,
            toDataset: ds.name,
            toField: theirField.name,
            confidence: "high",
            reason: `Exact name + type match (${myField.type})`,
          });
          continue;
        }

        // Signal 2 — FK suffix convention
        // e.g. my field = "patient_id"  →  their field = "id"  in "patients"
        // e.g. my field = "branch_code" →  their field = "code" in "branches"
        const fkSuffixes = ["_id", "id", "_key", "key", "_code", "code", "_num", "num"];
        for (const suffix of fkSuffixes) {
          if (myName.endsWith(suffix)) {
            const stem = myName.slice(0, myName.length - suffix.length).replace(/_$/, "");
            // Their field is the bare key (id / code / key) in a dataset whose
            // name starts with the stem, OR their field name equals the full myName.
            const dsNameLower = ds.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            const stemLower = stem.replace(/[^a-z0-9]/g, "");

            if (
              (theirName === "id" || theirName === suffix.replace("_", "") || theirName === myName) &&
              (dsNameLower.startsWith(stemLower) || dsNameLower.includes(stemLower))
            ) {
              seen.add(key);
              suggestions.push({
                fromField: myField.name,
                toDataset: ds.name,
                toField: theirField.name,
                confidence: "high",
                reason: `FK pattern: "${myField.name}" references "${ds.name}.${theirField.name}"`,
              });
              break;
            }

            // Looser: their field name === stem (e.g. "patient_id" → "patient")
            if (theirName === stem && (myField.type === theirField.type || theirField.type === "string")) {
              seen.add(key);
              suggestions.push({
                fromField: myField.name,
                toDataset: ds.name,
                toField: theirField.name,
                confidence: "medium",
                reason: `FK stem match: "${myField.name}" may reference "${ds.name}.${theirField.name}"`,
              });
              break;
            }
          }
        }

        if (seen.has(key)) continue;

        // Signal 3 — shared semantic prefix (first token match) with numeric type
        if (myField.type === "number" && theirField.type === "number") {
          const myTokens = myName.split(/[_\s-]+/);
          const theirTokens = theirName.split(/[_\s-]+/);
          if (
            myTokens.length >= 2 &&
            theirTokens.length >= 2 &&
            myTokens[0] === theirTokens[0] &&
            myTokens[1] === theirTokens[1]
          ) {
            seen.add(key);
            suggestions.push({
              fromField: myField.name,
              toDataset: ds.name,
              toField: theirField.name,
              confidence: "low",
              reason: `Shared prefix "${myTokens.slice(0, 2).join("_")}" with matching numeric type`,
            });
          }
        }
      }
    }
  }

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  return suggestions.sort((a, b) => order[a.confidence] - order[b.confidence]);
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
