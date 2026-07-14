/**
 * Client-side download helpers.
 * Converts a dataset (array of objects) to CSV or JSON and triggers a browser
 * download via an anchor element.  Never writes to any database.
 */

export type DownloadFormat = "csv" | "json";

/** Escape a single CSV cell value. */
function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Convert an array of objects to a CSV string with a header row. */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const header = cols.map(escapeCell).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCell(row[c])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Convert an array of objects to a pretty-printed JSON string. */
export function toJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Trigger a browser file download.
 * @param content  The string content to download.
 * @param filename The suggested filename (include extension).
 * @param mimeType The MIME type of the content.
 */
export function triggerDownload(
  content: string,
  filename: string,
  mimeType = "text/plain"
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Download a dataset as CSV or JSON.
 * @param rows     Array of data objects (e.g. the rows returned by a report run).
 * @param name     Report or dataset name — used to derive the filename.
 * @param format   "csv" | "json"
 */
export function downloadDataset(
  rows: Record<string, unknown>[],
  name: string,
  format: DownloadFormat
): void {
  const safeName = name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  const ts = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}_${ts}.${format}`;

  if (format === "csv") {
    triggerDownload(toCSV(rows), filename, "text/csv");
  } else {
    triggerDownload(toJSON(rows), filename, "application/json");
  }
}
