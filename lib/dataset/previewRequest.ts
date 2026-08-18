const DAY_IN_MS = 86_400_000;
const PREVIEW_WINDOW_DAYS = 90;

export interface DatasetPreviewRequest {
  sql: string;
  report_name: string;
  start_date: string;
  end_date: string;
}

export type RequestValidationDetails = Record<string, string[] | undefined> | string[];

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getDatasetPreviewDateRange(now = new Date()): {
  start_date: string;
  end_date: string;
} {
  const end = new Date(now);
  const start = new Date(end.getTime() - PREVIEW_WINDOW_DAYS * DAY_IN_MS);

  return {
    start_date: toIsoDate(start),
    end_date: toIsoDate(end),
  };
}

export function buildDatasetPreviewRequest(
  sql: string,
  datasetName: string,
  now = new Date(),
): DatasetPreviewRequest {
  return {
    sql,
    report_name: `${datasetName} preview`,
    ...getDatasetPreviewDateRange(now),
  };
}

export function formatRequestError(
  fallback: string,
  details?: RequestValidationDetails,
): string {
  if (!details) return fallback;
  if (Array.isArray(details)) {
    return details[0] ? `${fallback}: ${details[0]}` : fallback;
  }

  const fieldMessage = Object.entries(details).find(([, messages]) => messages?.length);
  if (!fieldMessage) return fallback;
  const [field, messages] = fieldMessage;
  return `${fallback}: ${field} ${messages?.[0]}`;
}
