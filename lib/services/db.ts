/**
 * /lib/services/db.ts
 *
 * Server-side data access client.
 *
 * ARCHITECTURE (data path):
 *   Browser → Next.js (Vercel API Routes ONLY) → ngrok (server-side) →
 *   VM backend service → Database (private, via connection string on the VM)
 *
 * Next.js NEVER connects to SQL Server directly. Instead these functions make
 * server-side HTTP calls to the VM backend service exposed through an ngrok
 * tunnel. The VM owns the private database connection string; credentials never
 * reach the browser or the Vercel environment.
 *
 * Configuration (all server-side env vars):
 *   BACKEND_URL          Base URL of the VM backend via ngrok
 *                        e.g. https://mollusk-clip-bullion.ngrok-free.dev
 *   BACKEND_QUERY_PATH   Query endpoint path (default: /api/query)
 *   BACKEND_HEALTH_PATH  Health endpoint path (default: /api/health)
 *   BACKEND_API_KEY      Optional shared secret sent as Authorization: Bearer
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryParams {
  StartDate: string;
  EndDate: string;
  BranchCode?: string;
}

/** A single named bind parameter passed to the backend. `type` is an optional
 *  SQL type hint (e.g. "date", "nvarchar", "int") the backend may use for binding. */
export interface NamedParam {
  name: string;
  value: unknown;
  type?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

const DEFAULT_QUERY_PATH = "/api/query";
const DEFAULT_HEALTH_PATH = "/api/health";

// ── Config helpers ──────────────────────────────────────────────────────────────

function getBackendBaseUrl(): string | null {
  const raw = process.env.BACKEND_URL;
  if (!raw) return null;
  // Strip trailing slash for consistent path joining
  return raw.replace(/\/+$/, "");
}

function backendUrl(path: string): string {
  const base = getBackendBaseUrl();
  if (!base) throw new Error("BACKEND_URL is not configured");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // ngrok free tier serves an HTML interstitial for browser-like requests
    // unless this header is present. Required so we receive JSON, not HTML.
    "ngrok-skip-browser-warning": "true",
    Accept: "application/json",
  };
  if (process.env.BACKEND_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.BACKEND_API_KEY}`;
  }
  return headers;
}

/** True when the VM backend service is configured. */
export function isDbConfigured(): boolean {
  return !!getBackendBaseUrl();
}

// ── Retry primitives ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Network-level failures and 5xx responses are safe to retry. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

// ── Normalize backend response into a recordset ─────────────────────────────────

function extractRecordset(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.recordset)) return obj.recordset as Record<string, unknown>[];
    if (Array.isArray(obj.rows)) return obj.rows as Record<string, unknown>[];
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (obj.error) throw new Error(String(obj.error));
  }
  throw new Error("Unexpected backend response shape");
}

// ── Core HTTP call to the VM backend ────────────────────────────────────────────

async function postQuery(
  sqlText: string,
  params: NamedParam[],
  attempt = 1
): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(backendUrl(process.env.BACKEND_QUERY_PATH ?? DEFAULT_QUERY_PATH), {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ sql: sqlText, params }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[db] Backend ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`
        );
        await sleep(delay);
        return postQuery(sqlText, params, attempt + 1);
      }
      // Log server-side detail; callers surface a generic message to clients.
      const detail = await res.text().catch(() => "");
      console.error(`[db] Backend query failed (${res.status}):`, detail.slice(0, 500));
      throw new Error(`Backend query failed with status ${res.status}`);
    }

    const payload = await res.json();
    return extractRecordset(payload);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const isNetwork = err instanceof TypeError; // fetch throws TypeError on network failure

    if ((isAbort || isNetwork) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[db] ${isAbort ? "Timeout" : "Network error"}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`
      );
      await sleep(delay);
      return postQuery(sqlText, params, attempt + 1);
    }
    console.error(`[db] Backend query error after ${attempt} attempt(s):`, (err as Error).message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API (unchanged signatures for existing callers) ──────────────────────

/**
 * Execute a parameterized query. @StartDate and @EndDate are always bound.
 * @BranchCode is bound only when provided — never interpolated into the string.
 */
export async function executeQuery(
  query: string,
  params: QueryParams
): Promise<Record<string, unknown>[]> {
  const named: NamedParam[] = [
    { name: "StartDate", value: params.StartDate, type: "date" },
    { name: "EndDate", value: params.EndDate, type: "date" },
  ];
  if (params.BranchCode !== undefined) {
    named.push({ name: "BranchCode", value: params.BranchCode, type: "nvarchar" });
  }
  return postQuery(query, named);
}

/**
 * Execute a query with arbitrary named parameters beyond the standard date range.
 * All values are bound by the backend — never interpolated into the SQL string.
 */
export async function executeQueryWithParams(
  query: string,
  inputs: NamedParam[]
): Promise<Record<string, unknown>[]> {
  return postQuery(query, inputs);
}

/**
 * Execute an introspection-only query with no user parameters.
 * NEVER pass user-supplied input to this function.
 */
export async function executeRawQuery(
  query: string
): Promise<Record<string, unknown>[]> {
  return postQuery(query, []);
}

/**
 * Health check — returns true if the VM backend responds successfully.
 */
export async function checkConnection(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(backendUrl(process.env.BACKEND_HEALTH_PATH ?? DEFAULT_HEALTH_PATH), {
      method: "GET",
      headers: buildHeaders(),
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch (err) {
    console.error("[db] Health check failed:", (err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
