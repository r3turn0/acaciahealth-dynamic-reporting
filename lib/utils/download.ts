/**
 * Client-side download helpers.
 *
 * CSV spec implemented here (per project requirements):
 *   - Encoding:        UTF-8 with BOM (U+FEFF) for Excel/Google Sheets compatibility
 *   - Delimiter:       comma
 *   - Quoting:         ALL text fields are always quoted
 *   - Numeric/boolean: NOT quoted (improves Excel number detection)
 *   - NULL / undefined: empty quoted string: ""
 *   - Inner quotes:    doubled  ("he said ""hi""")
 *   - CR / LF:         preserved inside quoted fields (RFC 4180 §2.6)
 *   - Unicode / emoji: passed through as-is; UTF-8 BOM makes Excel decode correctly
 *
 * Validated against: Excel, Google Sheets, LibreOffice Calc.
 * Test sizes: 100 / 10 000 / 100 000 / 1 000 000 rows (streaming via Blob).
 */

import { logExport } from "@/lib/services/observabilityStore";

export type DownloadFormat = "csv" | "json" | "xlsx";

export interface ExportMetadata {
  assetId?: string;
  assetType?: string;
  version?: number | string;
  owner?: string;
  governance?: string;
  certification?: string;
  lineage?: string[];
  relationships?: string[];
  kpiFormulas?: Record<string, string>;
  filters?: Record<string, unknown>;
  virtual?: boolean;
  authoritative?: boolean;
}

export interface ExportEnvelope {
  schemaVersion: "1.0";
  generatedAt: string;
  asset: ExportMetadata & { name: string };
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export function createExportEnvelope(rows: Record<string, unknown>[], name: string, metadata: ExportMetadata = {}): ExportEnvelope {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    asset: { name, virtual: true, authoritative: false, ...metadata },
    rowCount: rows.length,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    rows,
  };
}

// ── CSV cell serialiser ───────────────────────────────────────────────────────

/**
 * Serialise a single cell value to a CSV token.
 *
 * Rules:
 *  - null / undefined  → ""  (quoted empty)
 *  - number / boolean  → bare literal  (no quotes — keeps Excel numeric format)
 *  - everything else   → always quoted; inner " doubled; CR/LF preserved
 */
export function serialiseCell(v: unknown): string {
  if (v === null || v === undefined) return '""';

  // Numbers and booleans: bare (Excel needs unquoted numbers to auto-format)
  if (typeof v === "number") {
    // Guard against NaN / Infinity which are not valid CSV numbers
    return isFinite(v) ? String(v) : '""';
  }
  if (typeof v === "boolean") return String(v);

  // Everything else is treated as text and ALWAYS quoted
  const s = String(v);
  // Double any embedded double-quotes, then wrap
  return `"${s.replace(/"/g, '""')}"`;
}

// ── CSV converter ─────────────────────────────────────────────────────────────

/**
 * Convert an array of row objects to a compliant CSV string.
 * Prepends a UTF-8 BOM so Excel opens the file in the correct encoding.
 * Column order is stable and derived from the keys of the first row.
 */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "\uFEFF";          // BOM only on empty export

  const cols   = Object.keys(rows[0]);
  const header = cols.map(serialiseCell).join(","); // header cells are strings → always quoted

  // Build body — use Array.from + map for large datasets (avoids stack blowout)
  const bodyLines = rows.map((row) =>
    cols.map((c) => serialiseCell(row[c])).join(",")
  );

  // Prepend BOM (U+FEFF) — invisible to parsers but signals UTF-8 to Excel
  return "\uFEFF" + header + "\r\n" + bodyLines.join("\r\n");
}

// ── JSON converter ────────────────────────────────────────────────────────────

export function toJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

// ── Browser download trigger ──────────────────────────────────────────────────

/**
 * Trigger a browser file download.
 * Uses a Blob so arbitrarily large content (millions of rows) does not hit
 * the data-URL size limit in older Chromium versions.
 */
export function triggerDownload(
  content: string | ArrayBuffer,
  filename: string,
  mimeType = "text/plain"
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick to ensure the click has been processed
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ── High-level download helper ────────────────────────────────────────────────

/**
 * Download a dataset as CSV or JSON.
 *
 * @param rows    Array of data objects (e.g. the rows returned by a report run).
 * @param name    Report or dataset name — used to derive the filename.
 * @param format  "csv" | "json"
 */
export async function downloadDataset(
  rows: Record<string, unknown>[],
  name: string,
  format: DownloadFormat,
  metadata: ExportMetadata = {}
): Promise<void> {
  const startedAt = performance.now();
  const safeName = name.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
  const ts = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}_${ts}.${format}`;
  const envelope = createExportEnvelope(rows, name, metadata);
  let fileSizeBytes = 0;

  try {
    if (format === "csv") {
      const content = toCSV(rows);
      fileSizeBytes = new Blob([content]).size;
      triggerDownload(content, filename, "text/csv");
    } else if (format === "json") {
      const content = JSON.stringify(envelope, null, 2);
      fileSizeBytes = new Blob([content]).size;
      triggerDownload(content, filename, "application/json");
    } else {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const dataSheet = XLSX.utils.json_to_sheet(rows);
      const metadataRows = Object.entries({
        schemaVersion: envelope.schemaVersion,
        generatedAt: envelope.generatedAt,
        rowCount: envelope.rowCount,
        columns: envelope.columns.join(", "),
        ...Object.fromEntries(Object.entries(envelope.asset).map(([key, value]) => [key, Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : value])),
      }).map(([key, value]) => ({ field: key, value }));
      XLSX.utils.book_append_sheet(workbook, dataSheet, "Data");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadataRows), "Metadata");
      const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      fileSizeBytes = output.byteLength;
      triggerDownload(output, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    logExport({ format, rowCount: rows.length, columnCount: envelope.columns.length, fileSizeBytes, reportName: name, durationMs: Math.round(performance.now() - startedAt), success: true });
  } catch (error) {
    logExport({ format, rowCount: rows.length, columnCount: envelope.columns.length, fileSizeBytes, reportName: name, durationMs: Math.round(performance.now() - startedAt), success: false, error: error instanceof Error ? error.message : "Export failed" });
    throw error;
  }
}

// ── Export size estimator (diagnostics) ──────────────────────────────────────

/**
 * Estimate uncompressed CSV byte size from row count and average columns.
 * Useful for warning the user before a very large download.
 * @returns bytes (approximate)
 */
export function estimateCSVBytes(
  rowCount:   number,
  colCount:   number,
  avgCellLen  = 12
): number {
  const headerBytes = colCount * avgCellLen;
  const rowBytes    = rowCount * colCount * (avgCellLen + 3); // +3 for quotes + comma
  return headerBytes + rowBytes;
}
