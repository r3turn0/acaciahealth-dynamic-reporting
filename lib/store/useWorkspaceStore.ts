/**
 * useWorkspaceStore
 *
 * In-memory multi-tab workspace state using Zustand.
 * Each tab holds its own query, SQL, results, error and UI state so switching
 * tabs never loses work and never triggers a refetch.
 *
 * Tabs survive component remounts because the store is module-level singleton.
 */

"use client";

import { create } from "zustand/react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TabStatus = "idle" | "generating" | "running" | "success" | "error" | "fixing";

export interface WorkspaceTab {
  id: string;
  title: string;
  type: "query" | "report";
  // Query state
  userQuery: string;
  generatedSQL: string;
  status: TabStatus;
  // Results
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs?: number;
  lastRun?: string; // ISO timestamp
  // Error
  apiError: string;
  dbErrorLogs: string;
  // AI fix
  fixedSQL?: string;
  fixExplanation?: string;
  fixConfidence?: number;
  fixChanges?: { type: string; from: string; to: string; reason?: string }[];
  autoRetried?: boolean;
  // Vector context used for last generation
  vectorSources?: string[];
  // Report ref (if tab was loaded from a saved report)
  reportId?: string;
  reportName?: string;
  // UI state
  showFeedbackModal: boolean;
  showFixPanel: boolean;
  showHistory: boolean;
}

function defaultTab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    title: "New Query",
    type: "query",
    userQuery: "",
    generatedSQL: "",
    status: "idle",
    rows: [],
    rowCount: 0,
    apiError: "",
    dbErrorLogs: "",
    showFeedbackModal: false,
    showFixPanel: false,
    showHistory: false,
    ...overrides,
  };
}

// ── History entry (per-workspace, not per-tab) ────────────────────────────────

export interface WorkspaceHistoryEntry {
  id: string;
  tabId: string;
  userQuery: string;
  generatedSQL: string;
  status: "success" | "error" | "fixed";
  durationMs?: number;
  timestamp: string;
}

// ── Saved report (lightweight reference) ─────────────────────────────────────

export interface SavedQueryReport {
  id: string;
  name: string;
  userQuery: string;
  sql: string;
  columns: string[];
  rowCount: number;
  createdAt: string;
  vectorSources?: string[];
}

// ── Store interface ───────────────────────────────────────────────────────────

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  history: WorkspaceHistoryEntry[];
  savedReports: SavedQueryReport[];

  // Tab management
  addTab: (overrides?: Partial<WorkspaceTab>) => string; // returns new id
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  getActiveTab: () => WorkspaceTab | undefined;

  // Execution helpers (set loading + clear previous results)
  startGenerating: (id: string) => void;
  startRunning: (id: string) => void;
  startFixing: (id: string) => void;
  setSuccess: (id: string, rows: Record<string, unknown>[], durationMs: number) => void;
  setError: (id: string, apiError: string, dbErrorLogs: string) => void;
  setFix: (
    id: string,
    fix: {
      fixedSQL: string;
      explanation: string;
      confidence: number;
      changes: { type: string; from: string; to: string; reason?: string }[];
      autoRetry: boolean;
    }
  ) => void;

  // History
  pushHistory: (entry: Omit<WorkspaceHistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;

  // Saved reports
  saveReport: (report: Omit<SavedQueryReport, "id" | "createdAt">) => SavedQueryReport;
  removeReport: (id: string) => void;
  openReportAsTab: (report: SavedQueryReport) => string;

  // Refresh
  refreshTab: (id: string, runFn: (sql: string) => Promise<void>) => Promise<void>;
  refreshAllTabs: (runFn: (tabId: string, sql: string) => Promise<void>) => Promise<void>;
}

// ── Store implementation ──────────────────────────────────────────────────────

const initialTab = defaultTab({ title: "Query 1" });

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  history: [],
  savedReports: [],

  // ── Tab management ──────────────────────────────────────────────────────────

  addTab(overrides = {}) {
    const n = get().tabs.length + 1;
    const tab = defaultTab({ title: `Query ${n}`, ...overrides });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },

  closeTab(id) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) {
        const fresh = defaultTab({ title: "Query 1" });
        return { tabs: [fresh], activeTabId: fresh.id };
      }
      const activeTabId =
        s.activeTabId === id ? tabs[Math.max(0, tabs.findIndex((t) => t.id === id) - 1)].id : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  switchTab(id) {
    set({ activeTabId: id });
  },

  updateTab(id, patch) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  getActiveTab() {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId);
  },

  // ── Execution helpers ───────────────────────────────────────────────────────

  startGenerating(id) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, status: "generating", rows: [], rowCount: 0, apiError: "", dbErrorLogs: "", showFixPanel: false }
          : t
      ),
    }));
  },

  startRunning(id) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, status: "running", rows: [], rowCount: 0, apiError: "", dbErrorLogs: "", showFixPanel: false }
          : t
      ),
    }));
  },

  startFixing(id) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, status: "fixing" } : t)),
    }));
  },

  setSuccess(id, rows, durationMs) {
    const now = new Date().toISOString();
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "success",
              rows,
              rowCount: rows.length,
              durationMs,
              lastRun: now,
              apiError: "",
              dbErrorLogs: "",
              showFeedbackModal: false,
              showFixPanel: false,
            }
          : t
      ),
    }));
  },

  setError(id, apiError, dbErrorLogs) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, status: "error", apiError, dbErrorLogs, rows: [], rowCount: 0 } : t
      ),
    }));
  },

  setFix(id, fix) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "idle",
              fixedSQL: fix.fixedSQL,
              fixExplanation: fix.explanation,
              fixConfidence: fix.confidence,
              fixChanges: fix.changes,
              showFixPanel: true,
              showFeedbackModal: false,
            }
          : t
      ),
    }));
  },

  // ── History ─────────────────────────────────────────────────────────────────

  pushHistory(entry) {
    const full: WorkspaceHistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ history: [full, ...s.history].slice(0, 100) }));
  },

  clearHistory() {
    set({ history: [] });
  },

  // ── Saved reports ───────────────────────────────────────────────────────────

  saveReport(report) {
    const full: SavedQueryReport = {
      ...report,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ savedReports: [full, ...s.savedReports] }));
    return full;
  },

  removeReport(id) {
    set((s) => ({ savedReports: s.savedReports.filter((r) => r.id !== id) }));
  },

  openReportAsTab(report) {
    const tabId = get().addTab({
      title: report.name,
      type: "report",
      userQuery: report.userQuery,
      generatedSQL: report.sql,
      reportId: report.id,
      reportName: report.name,
      vectorSources: report.vectorSources,
    });
    return tabId;
  },

  // ── Refresh ─────────────────────────────────────────────────────────────────

  async refreshTab(id, runFn) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !tab.generatedSQL.trim()) return;
    await runFn(tab.generatedSQL);
  },

  async refreshAllTabs(runFn) {
    const tabs = get().tabs.filter((t) => t.generatedSQL.trim());
    for (const tab of tabs) {
      await runFn(tab.id, tab.generatedSQL);
    }
  },
}));
