// ─────────────────────────────────────────────────────────────────────────────
// Observability Store
//
// Structured event log for all platform activity:
//   - API requests (any route)
//   - Metadata synchronisation
//   - Dataset publish events
//   - Search queries (with zero-result tracking)
//   - Query execution
//   - CSV / JSON export events
//
// All events are:
//   1. Held in an in-memory ring-buffer (fast, always available)
//   2. Mirrored to sessionStorage (survives soft navigations)
//   3. Never sent to a server (client-side diagnostics only)
//
// The store is a singleton — import and call anywhere.  React components
// subscribe via getSnapshot() + the standard useSyncExternalStore pattern,
// or poll via getLogs().
// ─────────────────────────────────────────────────────────────────────────────

// ── Event types ───────────────────────────────────────────────────────────────

export type ObsEventType =
  | "api_request"
  | "metadata_sync"
  | "dataset_publish"
  | "search"
  | "query_execution"
  | "export"
  | "relationship_graph"
  | "search_index";

export type ObsLevel = "info" | "warn" | "error" | "debug";

export interface ObsEvent {
  id:          string;   // nano-id from Date.now() + counter
  ts:          number;   // Unix ms
  type:        ObsEventType;
  level:       ObsLevel;
  message:     string;
  /** Route, table name, dataset id, etc. — context-dependent */
  target?:     string;
  durationMs?: number;
  /** Extra structured payload */
  meta?:       Record<string, unknown>;
}

// ── Domain-specific log-entry builders ───────────────────────────────────────

export interface ApiRequestLog {
  route:      string;
  method:     string;
  statusCode: number;
  durationMs: number;
  source?:    string;   // e.g. "report_builder", "dataset_studio"
  error?:     string;
}

export interface SearchLog {
  query:         string;
  resultCount:   number;
  zeroResults:   boolean;
  topTableId?:   string;
  confidenceScore?: number;
  durationMs:    number;
  synonymsUsed?: string[];
}

export interface QueryExecutionLog {
  sql:           string;
  datasetId?:    string;
  rowCount?:     number;
  durationMs:    number;
  success:       boolean;
  error?:        string;
}

export interface ExportLog {
  format:        "csv" | "json";
  rowCount:      number;
  columnCount:   number;
  fileSizeBytes: number;
  reportName?:   string;
  durationMs?:   number;
  success:       boolean;
  error?:        string;
}

export interface MetadataSyncLog {
  tablesScanned:   number;
  tablesAdded:     number;
  tablesRemoved:   number;
  schemasRefreshed: string[];
  durationMs:      number;
  triggered:       "automatic" | "manual";
}

export interface DatasetPublishLog {
  datasetId:   string;
  datasetName: string;
  tableCount:  number;
  steps: {
    metadataRegistry:  boolean;
    datasetService:    boolean;
    relationshipService: boolean;
    searchIndex:       boolean;
    reportStudio:      boolean;
    biExplorer:        boolean;
  };
  success:     boolean;
  error?:      string;
  durationMs:  number;
}

// ── Ring-buffer settings ──────────────────────────────────────────────────────

const MAX_EVENTS   = 2000;
const STORAGE_KEY  = "acacia_obs_store_v1";

// ── Singleton store ───────────────────────────────────────────────────────────

let _events: ObsEvent[] = [];
let _counter = 0;
let _listeners: (() => void)[] = [];

function _id(): string {
  return `${Date.now()}_${_counter++}`;
}

function _persist() {
  if (typeof window === "undefined") return;
  try {
    // Persist only the last 500 events to avoid quota issues
    const slice = _events.slice(-500);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch { /* quota — skip */ }
}

function _notify() {
  for (const fn of _listeners) fn();
}

function _init() {
  if (typeof window === "undefined") return;
  if (_events.length > 0) return; // already loaded
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) _events = JSON.parse(raw) as ObsEvent[];
  } catch { _events = []; }
}

/** Push a raw event. All typed helpers call this internally. */
export function pushEvent(event: Omit<ObsEvent, "id" | "ts">): void {
  _init();
  const full: ObsEvent = { id: _id(), ts: Date.now(), ...event };
  _events.push(full);
  if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS);
  _persist();
  _notify();
}

// ── Typed log helpers (call these from feature code) ─────────────────────────

export function logApiRequest(entry: ApiRequestLog): void {
  pushEvent({
    type:      "api_request",
    level:     entry.statusCode >= 500 ? "error" : entry.statusCode >= 400 ? "warn" : "info",
    message:   `${entry.method} ${entry.route} → ${entry.statusCode} (${entry.durationMs}ms)`,
    target:    entry.route,
    durationMs: entry.durationMs,
    meta:      entry as unknown as Record<string, unknown>,
  });
}

export function logSearch(entry: SearchLog): void {
  pushEvent({
    type:      "search",
    level:     entry.zeroResults ? "warn" : "info",
    message:   entry.zeroResults
      ? `Zero results for query: "${entry.query}"`
      : `Search "${entry.query}" → ${entry.resultCount} result(s) in ${entry.durationMs}ms`,
    target:    entry.query,
    durationMs: entry.durationMs,
    meta:      entry as unknown as Record<string, unknown>,
  });
}

export function logQueryExecution(entry: QueryExecutionLog): void {
  pushEvent({
    type:      "query_execution",
    level:     entry.success ? "info" : "error",
    message:   entry.success
      ? `Query executed — ${entry.rowCount ?? "?"} rows in ${entry.durationMs}ms`
      : `Query failed: ${entry.error}`,
    target:    entry.datasetId,
    durationMs: entry.durationMs,
    meta:      { ...entry, sql: entry.sql.slice(0, 400) }, // truncate SQL for storage
  });
}

export function logExport(entry: ExportLog): void {
  pushEvent({
    type:      "export",
    level:     entry.success ? "info" : "error",
    message:   entry.success
      ? `Exported ${entry.rowCount} rows as ${entry.format.toUpperCase()} (${(entry.fileSizeBytes / 1024).toFixed(1)} KB)`
      : `Export failed: ${entry.error}`,
    target:    entry.reportName,
    durationMs: entry.durationMs,
    meta:      entry as unknown as Record<string, unknown>,
  });
}

export function logMetadataSync(entry: MetadataSyncLog): void {
  pushEvent({
    type:      "metadata_sync",
    level:     "info",
    message:   `Metadata sync (${entry.triggered}) — ${entry.tablesAdded} added, ${entry.tablesRemoved} removed in ${entry.durationMs}ms`,
    durationMs: entry.durationMs,
    meta:      entry as unknown as Record<string, unknown>,
  });
}

export function logDatasetPublish(entry: DatasetPublishLog): void {
  const failedSteps = Object.entries(entry.steps)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  pushEvent({
    type:      "dataset_publish",
    level:     entry.success ? "info" : "error",
    message:   entry.success
      ? `Dataset "${entry.datasetName}" published (${entry.tableCount} tables, ${entry.durationMs}ms)`
      : `Dataset "${entry.datasetName}" publish failed at: ${failedSteps.join(", ")}`,
    target:    entry.datasetId,
    durationMs: entry.durationMs,
    meta:      entry as unknown as Record<string, unknown>,
  });
}

export function logSearchIndexEvent(action: "build" | "invalidate" | "patch", durationMs?: number): void {
  pushEvent({
    type:      "search_index",
    level:     "info",
    message:   action === "build"
      ? `Search index built${durationMs != null ? ` in ${durationMs}ms` : ""}`
      : action === "patch"
      ? "Search index patched (incremental)"
      : "Search index invalidated",
    durationMs,
  });
}

export function logRelationshipGraph(action: "built" | "updated" | "error", detail?: string): void {
  pushEvent({
    type:    "relationship_graph",
    level:   action === "error" ? "error" : "info",
    message: action === "error"
      ? `Relationship graph error: ${detail}`
      : `Relationship graph ${action}${detail ? ` — ${detail}` : ""}`,
  });
}

// ── Query API ─────────────────────────────────────────────────────────────────

export function getLogs(options?: {
  type?:   ObsEventType;
  level?:  ObsLevel;
  limit?:  number;
  since?:  number; // unix ms
}): ObsEvent[] {
  _init();
  let results = [..._events].reverse(); // newest first

  if (options?.type)    results = results.filter((e) => e.type  === options.type);
  if (options?.level)   results = results.filter((e) => e.level === options.level);
  if (options?.since)   results = results.filter((e) => e.ts   >= (options.since ?? 0));
  if (options?.limit)   results = results.slice(0, options.limit);

  return results;
}

export function getZeroResultQueries(limit = 20): SearchLog[] {
  return getLogs({ type: "search", limit: 500 })
    .filter((e) => (e.meta as SearchLog | undefined)?.zeroResults)
    .slice(0, limit)
    .map((e) => e.meta as SearchLog);
}

export function getHealthSummary(): {
  searchIndexHealthy:      boolean;
  relationshipGraphHealthy: boolean;
  datasetRegistryHealthy:  boolean;
  reportingEngineHealthy:  boolean;
  totalEvents:             number;
  recentErrors:            number;
} {
  _init();
  const recent = _events.filter((e) => e.ts > Date.now() - 5 * 60_000);
  const errors  = recent.filter((e) => e.level === "error").length;

  const indexError   = recent.some((e) => e.type === "search_index"     && e.level === "error");
  const graphError   = recent.some((e) => e.type === "relationship_graph" && e.level === "error");
  const publishError = recent.some((e) => e.type === "dataset_publish"  && e.level === "error");
  const queryError   = recent.some((e) => e.type === "query_execution"  && e.level === "error");

  return {
    searchIndexHealthy:       !indexError,
    relationshipGraphHealthy: !graphError,
    datasetRegistryHealthy:   !publishError,
    reportingEngineHealthy:   !queryError,
    totalEvents:              _events.length,
    recentErrors:             errors,
  };
}

// ── React subscription helpers (useSyncExternalStore) ─────────────────────────

export function subscribeToObs(fn: () => void): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((l) => l !== fn); };
}

export function getObsSnapshot(): ObsEvent[] {
  _init();
  return _events;
}

/** Clear all log data. */
export function clearObsLog(): void {
  _events = [];
  _counter = 0;
  if (typeof window !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
  _notify();
}
