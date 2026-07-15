/**
 * useQueryFeedbackLog
 *
 * In-memory store (with localStorage persistence) for query repair events.
 * Each entry captures the original SQL, fixed SQL, error context, user intent,
 * and a metadata snapshot for future prompt-tuning or embeddings.
 *
 * Usage:
 *   const { log, addEntry, clearLog } = useQueryFeedbackLog();
 */

"use client";

import { useCallback, useEffect, useState } from "react";

export interface QueryFeedbackEntry {
  id: string;
  timestamp: string;
  userIntent: string;         // original natural-language query
  originalSQL: string;
  fixedSQL: string;
  error: string;              // combined apiError + dbErrorLogs
  userFeedback: string;
  confidence: number;
  changes: { type: string; from: string; to: string }[];
  metadataSnapshot?: unknown; // partial schema used at repair time
  retrySucceeded?: boolean;
}

const STORAGE_KEY = "acacia_query_feedback_log";
const MAX_ENTRIES = 200;

function load(): QueryFeedbackEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueryFeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(entries: QueryFeedbackEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // storage quota exceeded — silently ignore
  }
}

export function useQueryFeedbackLog() {
  const [log, setLog] = useState<QueryFeedbackEntry[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setLog(load());
  }, []);

  const addEntry = useCallback(
    (entry: Omit<QueryFeedbackEntry, "id" | "timestamp">) => {
      const full: QueryFeedbackEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      setLog((prev) => {
        const next = [...prev, full].slice(-MAX_ENTRIES);
        persist(next);
        return next;
      });
      return full;
    },
    []
  );

  const markRetryResult = useCallback((id: string, succeeded: boolean) => {
    setLog((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, retrySucceeded: succeeded } : e));
      persist(next);
      return next;
    });
  }, []);

  const clearLog = useCallback(() => {
    setLog([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { log, addEntry, markRetryResult, clearLog };
}
