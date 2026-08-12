import { afterEach, describe, expect, it } from "vitest";
import {
  acquireQuerySlot,
  getQueryConcurrencySnapshot,
  QueryCapacityError,
} from "@/lib/server/queryConcurrency";

const releases: Array<() => void> = [];

afterEach(() => {
  while (releases.length) releases.pop()?.();
});

describe("query concurrency", () => {
  it("bounds active execution and rejects work beyond queue capacity", async () => {
    for (let index = 0; index < 6; index += 1) releases.push(await acquireQuerySlot());
    const controllers = Array.from({ length: 18 }, () => new AbortController());
    const queued = controllers.map((controller) => acquireQuerySlot(controller.signal));

    await expect(acquireQuerySlot()).rejects.toBeInstanceOf(QueryCapacityError);
    expect(getQueryConcurrencySnapshot()).toMatchObject({ active: 6, queued: 18 });

    controllers.forEach((controller) => controller.abort(new DOMException("Test cleanup", "AbortError")));
    await Promise.allSettled(queued);
    expect(getQueryConcurrencySnapshot().queued).toBe(0);
  });

  it("removes cancelled requests from the queue", async () => {
    for (let index = 0; index < 6; index += 1) releases.push(await acquireQuerySlot());
    const controller = new AbortController();
    const queued = acquireQuerySlot(controller.signal);
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(getQueryConcurrencySnapshot().queued).toBe(0);
  });
});
