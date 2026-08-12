export class QueryCapacityError extends Error {
  constructor() {
    super("Query capacity is temporarily full");
    this.name = "QueryCapacityError";
  }
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const state = globalThis as typeof globalThis & {
  __queryConcurrency?: { active: number; queue: Waiter[] };
};
const shared = state.__queryConcurrency ??= { active: 0, queue: [] };

const MAX_CONCURRENT = 6;
const MAX_QUEUE = 18;

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function dispatch() {
  while (shared.active < MAX_CONCURRENT && shared.queue.length > 0) {
    const waiter = shared.queue.shift()!;
    if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal?.aborted) {
      waiter.reject(abortReason(waiter.signal));
      continue;
    }
    shared.active += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      shared.active -= 1;
      dispatch();
    });
  }
}

export function acquireQuerySlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (shared.active < MAX_CONCURRENT) {
    shared.active += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      shared.active -= 1;
      dispatch();
    });
  }
  if (shared.queue.length >= MAX_QUEUE) return Promise.reject(new QueryCapacityError());

  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = shared.queue.indexOf(waiter);
      if (index >= 0) shared.queue.splice(index, 1);
      reject(signal ? abortReason(signal) : new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    shared.queue.push(waiter);
  });
}

export function getQueryConcurrencySnapshot() {
  return { active: shared.active, queued: shared.queue.length, maxConcurrent: MAX_CONCURRENT, maxQueue: MAX_QUEUE };
}
