export type RequestStatus = "pending" | "success" | "error" | "cancelled" | "stale";

export interface RequestContext {
  scope: string;
  operation: string;
  resource?: string;
  params?: unknown;
  refreshGroup?: string;
  policy?: "latest" | "dedupe" | "parallel";
  timeoutMs?: number;
}

export interface RequestSnapshot {
  id: string;
  key: string;
  scope: string;
  operation: string;
  resource?: string;
  refreshGroup?: string;
  requestGroup: string;
  status: RequestStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  savedCall?: boolean;
}

export class StaleRequestError extends Error {
  constructor() { super("A newer request replaced this response"); this.name = "StaleRequestError"; }
}

export class RequestCancelledError extends Error {
  constructor(message = "Request cancelled") { super(message); this.name = "AbortError"; }
}

const active = new Map<string, { id: string; controller: AbortController; promise: Promise<unknown> }>();
const snapshots: RequestSnapshot[] = [];
const listeners = new Set<() => void>();
let version = 0;
let sequence = 0;

function stable(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

export function requestKey(context: RequestContext): string {
  return [context.scope, context.operation, context.resource ?? "", stable(context.params)].join("::");
}

function requestGroup(context: RequestContext): string {
  return context.refreshGroup ?? [context.scope, context.operation, context.resource ?? ""].join("::");
}

function identityKey(context: RequestContext): string {
  return context.policy === "dedupe" ? requestKey(context) : requestGroup(context);
}

function emit() { version += 1; listeners.forEach((listener) => listener()); }
function record(snapshot: RequestSnapshot) { snapshots.unshift(snapshot); if (snapshots.length > 250) snapshots.length = 250; emit(); }

function finish(id: string, status: RequestStatus) {
  const snapshot = snapshots.find((item) => item.id === id);
  if (!snapshot || snapshot.endedAt) return;
  snapshot.status = status;
  snapshot.endedAt = Date.now();
  snapshot.durationMs = snapshot.endedAt - snapshot.startedAt;
  emit();
}

export async function orchestrate<T>(context: RequestContext, task: (signal: AbortSignal, requestId: string) => Promise<T>): Promise<T> {
  const key = identityKey(context);
  const policy = context.policy ?? "latest";
  const prior = active.get(key);
  if (prior && policy === "dedupe") {
    const existing = snapshots.find((item) => item.id === prior.id);
    if (existing) existing.savedCall = true;
    emit();
    return prior.promise as Promise<T>;
  }
  if (prior && policy === "latest") {
    prior.controller.abort(new RequestCancelledError("Superseded by newer intent"));
    finish(prior.id, "stale");
  }

  const controller = new AbortController();
  const id = `req_${Date.now()}_${++sequence}`;
  const snapshot: RequestSnapshot = { id, key, scope: context.scope, operation: context.operation, resource: context.resource, refreshGroup: context.refreshGroup, requestGroup: requestGroup(context), status: "pending", startedAt: Date.now() };
  record(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (context.timeoutMs) timer = setTimeout(() => controller.abort(new RequestCancelledError("Request timed out")), context.timeoutMs);

  const promise = task(controller.signal, id)
    .then((value) => {
      if (active.get(key)?.id !== id && policy !== "parallel") { finish(id, "stale"); throw new StaleRequestError(); }
      finish(id, "success");
      return value;
    })
    .catch((error: unknown) => {
      const existing = snapshots.find((item) => item.id === id);
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (existing?.status !== "stale") finish(id, aborted ? "cancelled" : "error");
      throw error;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      if (active.get(key)?.id === id) active.delete(key);
      emit();
    });
  active.set(key, { id, controller, promise });
  emit();
  return promise;
}

export function cancelScope(scope: string) {
  active.forEach((entry) => {
    const snapshot = snapshots.find((item) => item.id === entry.id);
    if (snapshot?.scope === scope) entry.controller.abort(new RequestCancelledError());
  });
}

export function cancelRequestGroup(group: string) {
  active.forEach((entry) => {
    const snapshot = snapshots.find((item) => item.id === entry.id);
    if (snapshot?.requestGroup === group) entry.controller.abort(new RequestCancelledError(`Request group ${group} cancelled`));
  });
}

export function getRequestSnapshots(): RequestSnapshot[] { return snapshots.slice(); }
export function subscribeRequests(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function getRequestVersion() { return version; }
export function getRequestSummary() {
  const completed = snapshots.filter((item) => item.durationMs !== undefined);
  const durations = completed.map((item) => item.durationMs!).sort((a, b) => a - b);
  const percentile = (ratio: number) => durations.length ? durations[Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * ratio) - 1))] : null;
  const cancelled = snapshots.filter((item) => item.status === "cancelled").length;
  const stale = snapshots.filter((item) => item.status === "stale").length;
  return {
    active: snapshots.filter((item) => item.status === "pending").length,
    completed: completed.length,
    cancelled,
    stale,
    savedCalls: snapshots.filter((item) => item.savedCall).length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    cancellationRate: completed.length ? (cancelled + stale) / completed.length : 0,
  };
}
