import { describe, expect, it } from "vitest";
import { cancelRequestGroup, getRequestSnapshots, getRequestSummary, orchestrate } from "@/lib/orchestration/requestRegistry";

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

describe("request registry", () => {
  it("deduplicates identical in-flight work", async () => {
    let calls = 0;
    const context = { scope: "test-dedupe", operation: "load", params: { id: 1 }, policy: "dedupe" as const };
    const task = async () => { calls += 1; await wait(5); return calls; };
    const [first, second] = await Promise.all([orchestrate(context, task), orchestrate(context, task)]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
    expect(getRequestSummary().savedCalls).toBeGreaterThan(0);
  });

  it("coalesces 100 rapid identical clicks into one request", async () => {
    let calls = 0;
    const context = {
      scope: "report-studio",
      operation: "execute",
      params: { sql: "SELECT 1", startDate: "2026-01-01", endDate: "2026-01-31" },
      policy: "dedupe" as const,
    };
    const task = async () => { calls += 1; await wait(10); return "complete"; };

    const results = await Promise.all(Array.from({ length: 100 }, () => orchestrate(context, task)));

    expect(new Set(results)).toEqual(new Set(["complete"]));
    expect(calls).toBe(1);
  });

  it("cancels an older request when newer intent arrives", async () => {
    const context = { scope: "test-latest", operation: "search", policy: "latest" as const };
    const older = orchestrate(context, async (signal) => { await wait(30, signal); return "old"; });
    const newer = orchestrate(context, async () => "new");
    await expect(older).rejects.toMatchObject({ name: "AbortError" });
    await expect(newer).resolves.toBe("new");
  });

  it("keeps unrelated widget scopes independent", async () => {
    const [left, right] = await Promise.all([
      orchestrate({ scope: "widget-left", operation: "load" }, async () => "left"),
      orchestrate({ scope: "widget-right", operation: "load" }, async () => "right"),
    ]);
    expect([left, right]).toEqual(["left", "right"]);
  });

  it("isolates latest intent and cancellation by refresh group", async () => {
    const left = orchestrate({ scope: "dashboard", operation: "load", refreshGroup: "widget:left" }, async (signal) => { await wait(25, signal); return "left"; });
    const right = orchestrate({ scope: "dashboard", operation: "load", refreshGroup: "widget:right" }, async (signal) => { await wait(25, signal); return "right"; });
    cancelRequestGroup("widget:left");
    await expect(left).rejects.toMatchObject({ name: "AbortError" });
    await expect(right).resolves.toBe("right");
    const cancelled = getRequestSnapshots().find((item) => item.requestGroup === "widget:left" && item.status === "cancelled");
    expect(cancelled?.cancellationReason).toContain("widget:left");
  });

  it("exposes P50, P95, and P99 telemetry", () => {
    const summary = getRequestSummary();
    expect(summary).toHaveProperty("p50Ms");
    expect(summary).toHaveProperty("p95Ms");
    expect(summary).toHaveProperty("p99Ms");
    expect(summary.cancellationRate).toBeGreaterThanOrEqual(0);
  });
});
