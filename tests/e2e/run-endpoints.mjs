/**
 * End-to-end API smoke tests.
 *
 * Exercises every JSON API endpoint against a RUNNING dev server and asserts
 * the response shape. Designed to pass in "demo mode" (no database / no AI key)
 * as well as against a live backend — endpoints must degrade gracefully.
 *
 * Usage:
 *   1. Start the app:   npm run dev
 *   2. In another shell: npm run test:e2e
 *
 * Override the base URL with BASE_URL=http://localhost:3001 npm run test:e2e
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}
function bad(name, detail) {
  failed++;
  failures.push({ name, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`);
}

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { res, json };
}

async function expectStatus(name, path, init, statuses) {
  try {
    const { res, json } = await req(path, init);
    if (statuses.includes(res.status)) {
      ok(`${name} → ${res.status}`);
      return json;
    }
    bad(name, `expected status in [${statuses}], got ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
  } catch (e) {
    bad(name, `request threw: ${e.message}`);
  }
  return null;
}

async function main() {
  console.log(`\nRunning API E2E smoke tests against ${BASE}\n`);

  // Health check — server reachable?
  try {
    await fetch(BASE);
  } catch {
    console.error(`\n\x1b[31mCannot reach ${BASE}. Start the dev server with 'npm run dev' first.\x1b[0m\n`);
    process.exit(1);
  }

  console.log("Schema");
  const schema = await expectStatus("GET /api/schema", "/api/schema", { method: "GET" }, [200]);
  if (schema && !Array.isArray(schema.tables)) {
    bad("schema.tables is an array", `got ${typeof schema.tables}`);
  } else if (schema) {
    ok("schema.tables is an array");
  }

  console.log("\nData preview (Discover Data)");
  await expectStatus(
    // 200 in demo mode or with a reachable DB; 503 if a configured DB is down.
    "GET /api/data/BRANCHES",
    "/api/data/BRANCHES?page=1&pageSize=5",
    { method: "GET" },
    [200, 503]
  );
  await expectStatus(
    "GET /api/data/<invalid> is rejected",
    "/api/data/NOT_A_REAL_TABLE",
    { method: "GET" },
    [400]
  );

  console.log("\nGenerate query (AI with rule-based fallback)");
  const gen = await expectStatus(
    "POST /api/generate-query",
    "/api/generate-query",
    {
      method: "POST",
      body: JSON.stringify({
        prompt: "admissions by branch",
        start_date: "2024-01-01",
        end_date: "2024-01-31",
      }),
    },
    [200]
  );
  if (gen) {
    if (typeof gen.sql === "string" && gen.sql.includes("@StartDate")) ok("generate-query returns parameterized SQL");
    else bad("generate-query returns parameterized SQL", `sql=${JSON.stringify(gen.sql)?.slice(0, 120)}`);
  }
  await expectStatus(
    "POST /api/generate-query without dates → 400",
    "/api/generate-query",
    { method: "POST", body: JSON.stringify({ prompt: "admissions" }) },
    [400]
  );

  console.log("\nRun SQL (demo mode or live)");
  const run = await expectStatus(
    "POST /api/run-sql",
    "/api/run-sql",
    {
      method: "POST",
      body: JSON.stringify({
        sql: "SELECT b.branch_name, COUNT(*) AS admissions FROM CLIENT_EPISODES_ALL epi JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code) WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate GROUP BY b.branch_name",
        start_date: "2024-01-01",
        end_date: "2024-01-31",
        report_name: "Admissions by Branch",
      }),
    },
    [200, 503]
  );
  if (run && run.data) ok("run-sql returns a data array");
  await expectStatus(
    "POST /api/run-sql rejects DELETE → 422",
    "/api/run-sql",
    {
      method: "POST",
      body: JSON.stringify({
        sql: "DELETE FROM CLIENT_EPISODES_ALL WHERE 1=1 AND x BETWEEN @StartDate AND @EndDate",
        start_date: "2024-01-01",
        end_date: "2024-01-31",
      }),
    },
    [422]
  );

  console.log("\nKPI interpret + follow-up");
  const insights = await expectStatus(
    "POST /api/kpi/interpret (empty data falls back)",
    "/api/kpi/interpret",
    {
      method: "POST",
      body: JSON.stringify({
        report_name: "Admissions",
        kpi: "admissions",
        start_date: "2024-01-01",
        end_date: "2024-01-31",
        data: [],
        columns: [],
      }),
    },
    [200]
  );
  if (insights && insights.insights) ok("interpret returns an insights object");
  else if (insights) bad("interpret returns an insights object", JSON.stringify(insights).slice(0, 150));

  await expectStatus(
    "POST /api/kpi/followup",
    "/api/kpi/followup",
    {
      method: "POST",
      body: JSON.stringify({
        question: "What is driving this trend?",
        insights: insights?.insights ?? { summary: "n/a" },
        report_name: "Admissions",
        kpi: "admissions",
        start_date: "2024-01-01",
        end_date: "2024-01-31",
      }),
    },
    [200]
  );

  console.log(`\n${"─".repeat(48)}`);
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("All endpoint smoke tests passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
