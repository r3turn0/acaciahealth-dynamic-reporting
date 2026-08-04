"use client";

import useSWR from "swr";

export interface HealthData {
  status: string;
  timestamp: string;
  version: string;
  services: {
    database: { connected: boolean; configured: boolean; mode: string };
    ai: { configured: boolean; model: string };
    cache: { active_entries: number };
  };
  environment: string;
}

async function fetchHealth(url: string): Promise<HealthData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Health request failed (${response.status})`);
    return response.json() as Promise<HealthData>;
  } finally {
    clearTimeout(timer);
  }
}

export function useHealth() {
  return useSWR("/api/health", fetchHealth, {
    dedupingInterval: 30_000,
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    shouldRetryOnError: false,
  });
}
