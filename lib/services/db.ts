import sql from "mssql";

let pool: sql.ConnectionPool | null = null;

// Supports both a full SQL_CONNECTION_STRING and individual DB_HOST/DB_NAME/DB_USER/DB_PASS vars.
// Individual vars take precedence when all four are present, matching the deployment spec.
function buildConfig(): sql.config {
  const host = process.env.DB_HOST;
  const db   = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASS;

  if (host && db && user && pass) {
    return {
      server: host,
      database: db,
      user,
      password: pass,
      options: {
        encrypt: true,               // required for Azure SQL
        trustServerCertificate: false,
        enableArithAbort: true,
        readOnlyIntent: true,        // enforce read-only at driver level
      },
      requestTimeout: 30000,
      connectionTimeout: 15000,
    };
  }

  // Fallback: full connection string (e.g. SQL_CONNECTION_STRING) or localhost defaults
  return {
    server: process.env.SQL_SERVER ?? "localhost",
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
      readOnlyIntent: true,
    },
    requestTimeout: 30000,
    connectionTimeout: 15000,
  };
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  if (pool) {
    try { await pool.close(); } catch { /* ignore close errors */ }
  }
  // Allow a raw connection string override for legacy deployments
  const connArg: string | sql.config =
    process.env.SQL_CONNECTION_STRING ?? buildConfig();
  pool = await sql.connect(connArg as sql.config);
  return pool;
}

export interface QueryParams {
  StartDate: string;
  EndDate: string;
}

export async function executeQuery(
  query: string,
  params: QueryParams
): Promise<Record<string, unknown>[]> {
  const connectionPool = await getPool();
  const request = connectionPool.request();

  request.input("StartDate", sql.Date, params.StartDate);
  request.input("EndDate", sql.Date, params.EndDate);

  console.log("[v0] Executing parameterized query");
  console.log("[v0] Params:", JSON.stringify(params));
  console.log("[v0] SQL:", query);

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Executes a raw SQL string with no user parameters (schema introspection only).
 * NEVER call this with user-supplied input.
 */
export async function executeRawQuery(
  query: string
): Promise<Record<string, unknown>[]> {
  const connectionPool = await getPool();
  const request = connectionPool.request();
  const result = await request.query(query);
  return result.recordset;
}

export async function checkConnection(): Promise<boolean> {
  try {
    const connectionPool = await getPool();
    const request = connectionPool.request();
    await request.query("SELECT 1 AS health_check");
    return true;
  } catch (err) {
    console.error("[v0] DB health check failed:", err);
    return false;
  }
}
