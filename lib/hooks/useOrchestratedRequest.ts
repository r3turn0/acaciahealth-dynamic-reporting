"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cancelScope, getRequestSnapshots, getRequestVersion, orchestrate, subscribeRequests, type RequestContext } from "@/lib/orchestration/requestRegistry";

export function useOrchestratedRequest<TArgs extends unknown[], TResult>(
  context: RequestContext,
  task: (signal: AbortSignal, ...args: TArgs) => Promise<TResult>,
) {
  const contextRef = useRef(context);
  const taskRef = useRef(task);
  contextRef.current = context;
  taskRef.current = task;
  const [data, setData] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  useSyncExternalStore(subscribeRequests, getRequestVersion, () => 0);

  const run = useCallback(async (...args: TArgs) => {
    setError(null);
    try {
      const value = await orchestrate(contextRef.current, (signal) => taskRef.current(signal, ...args));
      setData(value);
      setLastUpdatedAt(Date.now());
      return value;
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "StaleRequestError")) return undefined;
      setError(cause instanceof Error ? cause.message : "Request failed");
      return undefined;
    }
  }, []);

  useEffect(() => () => cancelScope(context.scope), [context.scope]);
  const isLoading = getRequestSnapshots().some((item) => item.scope === context.scope && item.operation === context.operation && item.status === "pending");
  return { data, error, isLoading, lastUpdatedAt, run, cancel: () => cancelScope(context.scope), setData };
}
