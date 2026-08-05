"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { cancelRequestGroup, getRequestGroup, getRequestSnapshots, getRequestVersion, orchestrate, subscribeRequests, type RequestContext } from "@/lib/orchestration/requestRegistry";

export function useOrchestratedRequest<TArgs extends unknown[], TResult>(
  context: RequestContext,
  task: (signal: AbortSignal, ...args: TArgs) => Promise<TResult>,
) {
  const [data, setData] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  useSyncExternalStore(subscribeRequests, getRequestVersion, () => 0);

  const run = useCallback(async (...args: TArgs) => {
    setError(null);
    try {
      const value = await orchestrate(context, (signal) => task(signal, ...args));
      setData(value);
      setLastUpdatedAt(Date.now());
      return value;
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "StaleRequestError")) return undefined;
      setError(cause instanceof Error ? cause.message : "Request failed");
      return undefined;
    }
  }, [context, task]);

  const group = getRequestGroup(context);
  useEffect(() => () => cancelRequestGroup(group), [group]);
  const isLoading = getRequestSnapshots().some((item) => item.requestGroup === group && item.status === "pending");
  return { data, error, isLoading, lastUpdatedAt, run, cancel: () => cancelRequestGroup(group), setData };
}
