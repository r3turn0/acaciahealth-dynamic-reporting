export type SqlExecutionErrorCode =
  | "INVALID_REQUEST"
  | "SECURITY_VALIDATION_FAILED"
  | "EXECUTION_FAILED"
  | "QUERY_CAPACITY_FULL"
  | "QUERY_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "BACKEND_UNREACHABLE";

export type SqlRecoveryAction = "edit_sql" | "fix_query" | "narrow_date_range" | "retry";

export interface SqlExecutionErrorPayload {
  error: string;
  code: SqlExecutionErrorCode;
  category: "request" | "validation" | "execution" | "capacity" | "timeout" | "cancelled" | "backend";
  retryable: boolean;
  recovery: SqlRecoveryAction[];
  details?: Record<string, string[] | undefined> | string[];
  diagnostics?: {
    requestId?: string;
    validationErrors?: string[];
    pipeline?: unknown;
  };
}

export function sqlErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = payload as Partial<SqlExecutionErrorPayload>;
  const details = error.details;
  const detail = Array.isArray(details)
    ? details.find(Boolean)
    : details && typeof details === "object"
      ? Object.values(details).flat().find(Boolean)
      : undefined;
  return [error.error || fallback, detail].filter(Boolean).join(": ");
}

export function isSqlExecutionError(payload: unknown): payload is SqlExecutionErrorPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return typeof value.error === "string" && typeof value.code === "string" && Array.isArray(value.recovery);
}
