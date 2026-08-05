import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  RequestTimeoutError,
  requestErrorMessage,
} from "@/lib/client/fetchWithTimeout";
import {
  QueryGatewayTimeoutError,
  withAbortTimeout,
} from "@/lib/gateway/QueryGateway";

describe("request deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects a hanging browser request at its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        })
      )
    );

    const request = fetchWithTimeout("/api/run-sql", { timeoutMs: 50 });
    const rejection = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("propagates parent cancellation without reporting a timeout", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        })
      )
    );

    const request = fetchWithTimeout("/api/generate-query", {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("settles a gateway operation even when the operation ignores cancellation", async () => {
    vi.useFakeTimers();
    const operation = withAbortTimeout(
      () => new Promise<string>(() => undefined),
      undefined,
      75,
      "SQL execution"
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: "QueryGatewayTimeoutError",
      operation: "SQL execution",
      timeoutMs: 75,
    });

    await vi.advanceTimersByTimeAsync(75);
    await rejection;
  });

  it("returns actionable timeout copy", () => {
    expect(
      requestErrorMessage(
        new RequestTimeoutError(1_000),
        "Query execution took too long."
      )
    ).toBe("Query execution took too long.");
    expect(new QueryGatewayTimeoutError("AI generation", 20_000).code).toBe(
      "GATEWAY_TIMEOUT"
    );
  });
});
