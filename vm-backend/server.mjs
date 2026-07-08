/**
 * VM Backend Service
 *
 * ARCHITECTURE:
 *   Browser → Next.js (Vercel API routes) → ngrok → [THIS SERVICE] → SQL Server
 *
 * This process runs on the VM/host that has private network access to SQL Server.
 * It owns the database connection string. Next.js reaches it through an ngrok
 * HTTP tunnel and authenticates with a shared bearer key. The database
 * credentials never leave this machine.
 *
 * Endpoints (must match lib/services/db.ts in the Next.js app):
 *   GET  /api/health  → { status, database }            (200 when DB reachable)
 *   POST /api/query   → { sql, params:[{name,value,type}] } → { recordset:[...] }
 *
 * Auth: every request must send  Authorization: Bearer <API_KEY>
 *
 * Run:
 *   1. cp .env.example .env  and fill in values
 *   2. npm install
 *   3. node --env-file=.env server.mjs
 *   4. ngrok http <PORT>   (point the tunnel at THIS service, not at 1433)
 */

import http from "node:http";
import sql from "mssql";

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const API_KEY = process.env.API_KEY ?? process.env.BACKEND_API_KEY ?? "";
const MAX_ROWS = parseInt(process.env.MAX_ROWS ?? "1000", 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS ?? "30000", 10);

if (!API_KEY) {
  console.error("[backend] FATAL: API_KEY (or BACKEND_API_KEY) is not set. Refusing to start.");
  process.exit(1);
}

// ── Database config ───────────────────────────────────────────────────────────

function buildDbConfig() {
  // Preferred: a single DATABASE_URL / connection string
  const connStr = process.env.DATABASE_URL || process.env.SQL_CONNECTION_STRING;
  if (connStr && !/^mssql:\/\/(user|host)[:/]/i.test(connStr)) {
    // mssql accepts either a config object or a connection string passed to sql.connect().
    // A URL form (mssql://user:pass@host:port/db) is parsed here into a config so we can
    // enforce options like encrypt / trustServerCertificate.
    if (/^mssql:\/\//i.test(connStr)) {
      const u = new URL(connStr);
      return {
        server: u.hostname,
        port: u.port ? parseInt(u.port, 10) : 1433,
        database: u.pathname.replace(/^\//, ""),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        options: {
          encrypt: (u.searchParams.get("encrypt") ?? "true") !== "false",
          trustServerCertificate:
            (u.searchParams.get("trustServerCertificate") ?? "true") !== "false",
          enableArithAbort: true,
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
        requestTimeout: QUERY_TIMEOUT_MS,
        connectionTimeout: 15000,
      };
    }
    // Classic "Server=...;Database=...;" ADO string — hand straight to mssql.
    return connStr;
  }

  // Fallback: individual DB_* variables
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  if (host && database && user && password) {
    return {
      server: host,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
      database,
      user,
      password,
      options: {
        encrypt: process.env.DB_ENCRYPT !== "false",
        trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
        enableArithAbort: true,
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: QUERY_TIMEOUT_MS,
      connectionTimeout: 15000,
    };
  }

  console.error(
    "[backend] FATAL: no database config. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASS."
  );
  process.exit(1);
}

const DB_CONFIG = buildDbConfig();

// ── Connection pool (singleton) ─────────────────────────────────────────────────

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(DB_CONFIG).catch((err) => {
      poolPromise = null; // allow retry on next request
      throw err;
    });
  }
  return poolPromise;
}

// ── Read-only SQL guard ───────────────────────────────────────────────────────

// Only single SELECT / WITH...SELECT statements are permitted. Anything that
// mutates data or schema, or chains multiple statements, is rejected.
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|BACKUP|RESTORE|SHUTDOWN|xp_|sp_)\b/i;

function assertReadOnly(sqlText) {
  const trimmed = sqlText.trim();
  if (!trimmed) throw new Error("Empty SQL");

  // Strip a single trailing semicolon, then reject any remaining statement separator.
  const withoutTrailing = trimmed.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Multiple statements are not allowed");
  }
  if (!/^(SELECT|WITH)\b/i.test(withoutTrailing)) {
    throw new Error("Only SELECT queries are allowed");
  }
  if (FORBIDDEN.test(withoutTrailing)) {
    throw new Error("Query contains a forbidden keyword");
  }
  return withoutTrailing;
}

// ── Param type mapping ──────────────────────────────────────────────────────────

function sqlTypeFor(hint, value) {
  switch ((hint ?? "").toLowerCase()) {
    case "date":
      return sql.Date;
    case "datetime":
      return sql.DateTime;
    case "int":
    case "integer":
      return sql.Int;
    case "bigint":
      return sql.BigInt;
    case "float":
    case "decimal":
    case "money":
      return sql.Float;
    case "bit":
    case "boolean":
      return sql.Bit;
    case "nvarchar":
    case "varchar":
    case "string":
      return sql.NVarChar;
    default:
      // Infer from the JS value when no hint is given.
      if (typeof value === "number") return Number.isInteger(value) ? sql.Int : sql.Float;
      if (typeof value === "boolean") return sql.Bit;
      return sql.NVarChar;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isAuthorized(req) {
  const header = req.headers["authorization"] ?? "";
  const expected = `Bearer ${API_KEY}`;
  // Constant-time-ish comparison
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function readBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Route handlers ──────────────────────────────────────────────────────────────

async function handleHealth(res) {
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok");
    sendJson(res, 200, { status: "ok", database: "connected" });
  } catch (err) {
    console.error("[backend] Health check DB error:", err.message);
    sendJson(res, 503, { status: "degraded", database: "unreachable" });
  }
}

async function handleQuery(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const { sql: sqlText, params } = body ?? {};
  if (typeof sqlText !== "string") {
    return sendJson(res, 400, { error: "Missing 'sql' string" });
  }

  let safeSql;
  try {
    safeSql = assertReadOnly(sqlText);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    if (Array.isArray(params)) {
      for (const p of params) {
        if (!p || typeof p.name !== "string") continue;
        request.input(p.name, sqlTypeFor(p.type, p.value), p.value ?? null);
      }
    }

    // Enforce a hard row cap defensively (in addition to any TOP/OFFSET in the SQL).
    request.arrayRowMode = false;
    const result = await request.query(safeSql);
    const recordset = Array.isArray(result.recordset) ? result.recordset : [];
    const capped = recordset.slice(0, MAX_ROWS);

    sendJson(res, 200, {
      recordset: capped,
      rowCount: capped.length,
      truncated: recordset.length > MAX_ROWS,
    });
  } catch (err) {
    console.error("[backend] Query error:", err.message);
    // Generic message to the caller; details stay in server logs.
    sendJson(res, 500, { error: "Query execution failed" });
  }
}

// ── Server ──────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Auth gate for all API routes
  if (path.startsWith("/api/")) {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
  }

  if (req.method === "GET" && path === "/api/health") {
    return handleHealth(res);
  }
  if (req.method === "POST" && path === "/api/query") {
    return handleQuery(req, res);
  }
  if (req.method === "GET" && path === "/") {
    return sendJson(res, 200, { service: "acaciahealth-vm-backend", status: "running" });
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[backend] VM backend service listening on http://0.0.0.0:${PORT}`);
  console.log(`[backend] Endpoints: GET /api/health, POST /api/query`);
  console.log(`[backend] Next: run  ngrok http ${PORT}`);
  // Warm the pool so the first real request is fast; failure is non-fatal.
  getPool()
    .then(() => console.log("[backend] Database pool ready"))
    .catch((err) => console.error("[backend] Initial DB connection failed:", err.message));
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[backend] ${signal} received, closing...`);
    server.close(() => {
      sql.close().finally(() => process.exit(0));
    });
  });
}
