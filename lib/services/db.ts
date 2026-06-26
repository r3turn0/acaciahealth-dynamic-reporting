import sql from "mssql";

let pool: sql.ConnectionPool | null = null;

const config: sql.config = {
  connectionString: process.env.SQL_CONNECTION_STRING,
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
  pool = await sql.connect(config);
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
