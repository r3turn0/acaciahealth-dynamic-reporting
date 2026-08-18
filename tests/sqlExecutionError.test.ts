import { describe, expect, it } from "vitest";
import { isSqlExecutionError, sqlErrorMessage, type SqlExecutionErrorPayload } from "@/lib/sql/executionError";

describe("SQL execution error contract", () => {
  const validationFailure: SqlExecutionErrorPayload = {
    error: "Query failed read-only security validation.",
    code: "SECURITY_VALIDATION_FAILED",
    category: "validation",
    retryable: false,
    recovery: ["edit_sql", "fix_query"],
    details: ["UPDATE is not allowed (read-only database)"],
    diagnostics: { requestId: "req-1", validationErrors: ["UPDATE is not allowed"] },
  };

  it("recognizes structured failures and preserves recovery actions", () => {
    expect(isSqlExecutionError(validationFailure)).toBe(true);
    expect(validationFailure.recovery).toEqual(["edit_sql", "fix_query"]);
  });

  it("formats array and field-level validation details", () => {
    expect(sqlErrorMessage(validationFailure, "Failed")).toContain("UPDATE is not allowed");
    expect(sqlErrorMessage({ error: "Invalid request", details: { sql: ["SQL is required"] } }, "Failed"))
      .toBe("Invalid request: SQL is required");
  });

  it("falls back safely for non-contract responses", () => {
    expect(isSqlExecutionError({ error: "legacy" })).toBe(false);
    expect(sqlErrorMessage(null, "Execution failed")).toBe("Execution failed");
  });
});
