export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { normalizeResultSet } from "@/lib/services/kpiSourceNormalizer";
import type { AnalysisSource, FileIngestionResult } from "@/lib/services/kpiAnalysisTypes";
import type { QueryResultSet } from "@/lib/db/readOnlyClient";
import { checkRateLimit } from "@/lib/middleware/rateLimiter";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 5_000;
const ALLOWED = new Set(["csv", "json", "txt", "md", "xlsx", "docx", "pdf"]);

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function toResultSet(rows: Record<string, unknown>[]): QueryResultSet {
  const safeRows = rows.slice(0, MAX_ROWS);
  return { rows: safeRows, columns: safeRows.length ? Object.keys(safeRows[0]) : [], rowCount: safeRows.length };
}

function textRows(text: string): Record<string, unknown>[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_ROWS).map((line, index) => ({ line: index + 1, text: line.slice(0, 1_000) }));
}

async function parseFile(file: File): Promise<FileIngestionResult> {
  const ext = extension(file.name);
  const fileId = `upload:${crypto.randomUUID()}`;
  const diagnostics: string[] = [];
  if (!ALLOWED.has(ext)) return { fileId, fileName: file.name, mediaType: file.type, size: file.size, stage: "failed", source: null, diagnostics: [`Unsupported extension .${ext || "unknown"}.`] };
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return { fileId, fileName: file.name, mediaType: file.type, size: file.size, stage: "failed", source: null, diagnostics: [file.size === 0 ? "File is empty." : "File exceeds the 10 MB per-file limit."] };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sets: Array<{ name: string; result: QueryResultSet }> = [];
    if (ext === "xlsx" || ext === "csv") {
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
      for (const sheetName of workbook.SheetNames.slice(0, 20)) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null }).slice(0, MAX_ROWS);
        sets.push({ name: sheetName, result: toResultSet(rows) });
      }
      if (workbook.SheetNames.length > 20) diagnostics.push("Only the first 20 worksheets were parsed.");
    } else if (ext === "json") {
      const value: unknown = JSON.parse(buffer.toString("utf8"));
      const rows = Array.isArray(value) ? value : [value];
      sets.push({ name: "JSON", result: toResultSet(rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))) });
    } else if (ext === "docx") {
      const parsed = await mammoth.extractRawText({ buffer });
      diagnostics.push(...parsed.messages.map((message) => message.message));
      sets.push({ name: "Document text", result: toResultSet(textRows(parsed.value)) });
    } else if (ext === "pdf") {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const parsed = await parser.getText();
        sets.push({ name: "PDF text", result: toResultSet(textRows(parsed.text)) });
      } finally {
        await parser.destroy();
      }
    } else {
      sets.push({ name: "Text", result: toResultSet(textRows(buffer.toString("utf8"))) });
    }

    const resultSets = sets.filter(({ result }) => result.rowCount > 0).map(({ name, result }, index) => normalizeResultSet(result, `${fileId}:${index + 1}`, name));
    if (!resultSets.length) throw new Error("No tabular rows or extractable text were found.");
    const executedAt = new Date().toISOString();
    const source: AnalysisSource = {
      id: fileId, name: file.name, type: ext === "xlsx" ? "scorecard" : "uploaded-file",
      executionMode: "upload", validationStatus: "validated", executedAt, dataAgeMs: 0, dateRange: null,
      resultSetCount: resultSets.length, resultSets, fallbackReason: null, diagnostics,
    };
    return { fileId, fileName: file.name, mediaType: file.type, size: file.size, stage: "normalized", source, diagnostics };
  } catch (error) {
    return { fileId, fileName: file.name, mediaType: file.type, size: file.size, stage: "failed", source: null, diagnostics: [error instanceof Error ? error.message : "File parsing failed."] };
  }
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, { limit: 10, window: 60, prefix: "kpi-files" });
  if (!rl.success) return rl.response;
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length || files.length > MAX_FILES) return NextResponse.json({ error: `Upload between 1 and ${MAX_FILES} files.` }, { status: 400 });
    if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) return NextResponse.json({ error: "Combined upload exceeds 30 MB." }, { status: 413 });
    const results = await Promise.all(files.map(parseFile));
    return NextResponse.json({ results, accepted: results.filter((result) => result.source).length, failed: results.filter((result) => !result.source).length });
  } catch {
    return NextResponse.json({ error: "Invalid multipart upload." }, { status: 400 });
  }
}
