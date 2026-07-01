import sql from "mssql";

let pool: sql.ConnectionPool | null = null;

// mssql does not accept connectionString inside config — pass it directly to sql.connect()
// server is required by the type but unused when SQL_CONNECTION_STRING is provided
const config: sql.config = {
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

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  if (pool) {
    try {
      await pool.close();
    } catch {
      // ignore close errors
    }
  }
  // When SQL_CONNECTION_STRING is set, pass it directly; otherwise use config object
  const connArg = process.env.SQL_CONNECTION_STRING ?? config;
  pool = await sql.connect(connArg as string);
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
