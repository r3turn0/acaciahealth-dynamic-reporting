import { describe, expect, it } from "vitest";
import { getRequestSummary, orchestrate } from "@/lib/orchestration/requestRegistry";

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
});
