import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/run-sql/route";

describe("POST /api/run-sql request contract", () => {
  it("returns a structured 400 for malformed JSON", async () => {
    const request = new NextRequest("http://localhost/api/run-sql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: "INVALID_REQUEST",
      category: "request",
      retryable: false,
      recovery: ["edit_sql"],
    });
  });

  it("returns field diagnostics for an invalid execution body", async () => {
    const request = new NextRequest("http://localhost/api/run-sql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "", start_date: "not-a-date" }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(payload.details.sql).toBeDefined();
  });
});
