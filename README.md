# AcaciaHealth Dynamic Reporting

Enterprise healthcare reporting and analytics built around an immutable source-data model. The platform combines governed data discovery, natural-language query generation, read-only SQL execution, report authoring, KPI intelligence, schema metadata, and operational administration in one Next.js application.

> [!IMPORTANT]
> **AI assistants and contributors: read [Mandatory engineering constraints](#mandatory-engineering-constraints) before changing code.** The connected healthcare database is read-only. Never generate or execute database mutations or schema changes.

## Purpose

AcaciaHealth Dynamic Reporting gives executives, analysts, and operations teams self-service access to approved healthcare data without granting direct database access or requiring SQL expertise.

The platform is designed to:

- shorten reporting turnaround time;
- expose operational, clinical, workforce, and financial trends;
- translate plain-English questions into governed SQL;
- centralize report, KPI, schema, lineage, and audit workflows;
- preserve source-system integrity through defense-in-depth read-only controls.

## Mandatory engineering constraints

These rules apply to humans, coding assistants, autonomous agents, generated SQL, tests, scripts, and documentation.

### 1. The source database is immutable

Allowed database operations:

- `SELECT` and read-only CTEs;
- filtering, sorting, grouping, joins, and aggregations;
- metadata inspection and data-quality checks;
- parameterized reporting and analytical queries.

Forbidden database operations:

- `INSERT`, `UPDATE`, `DELETE`, or `MERGE`;
- `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, or `RENAME`;
- `GRANT`, `REVOKE`, `DENY`, `USE`, or stored-procedure execution;
- `SELECT INTO`, multiple SQL statements, or privileged external data access;
- migrations, seed scripts, or schema modifications against the source database.

If a feature appears to require a source-data mutation, stop and design a read-only alternative. Application metadata may be virtual or process-local, but it must never be written back to the healthcare source database.

### 2. Preserve the query safety boundary

All execution paths must use the shared guards and server-side data layer:

- `lib/services/queryGuard.ts` enforces read-only SQL and governed query rules;
- `lib/services/db.ts` owns SQL Server connectivity and parameter binding;
- `lib/db/readOnlyClient.ts` provides read-only execution helpers;
- user-provided values must be bound parameters, never interpolated into SQL;
- dynamic table or column identifiers must be resolved from trusted metadata and safely quoted;
- database credentials must remain server-only.

Do not add a bypass around these modules. New query routes require validation, bounded execution, error handling, and tests proving mutation attempts are rejected.

### 3. Protect healthcare data

- Do not commit credentials, connection strings, tokens, PHI, or production result sets.
- Do not log raw query results or sensitive user inputs.
- Return only the fields required by the calling experience.
- Maintain authentication, authorization, audit, and session boundaries.
- Use synthetic or explicitly approved data in tests and examples.

### 4. Follow the project architecture

- Next.js App Router, React, TypeScript, and Tailwind CSS.
- Server-only database and AI calls through route handlers or server modules.
- Strong typing, Zod validation where applicable, reusable components, and accessible UI.
- SWR for client data that needs caching or synchronization; do not fetch in `useEffect` when SWR or a server component is the correct fit.
- Keep changes focused and preserve local development as well as Vercel deployment.
- Maintain the npm lockfile and verify with the repository scripts before completion.

## Product capabilities

### Discover Data

- Browse approved SQL Server tables and records.
- Search tables, columns, datasets, reports, KPIs, glossary terms, and lineage.
- Use semantic search to find assets by business meaning.
- Apply validated, parameterized column filters with filtered counts and pagination.
- Export governed result sets without modifying source data.

### Dataset Studio

- Discover source assets and construct virtual datasets.
- Validate fields, relationships, and compatibility before publication.
- Track virtual dataset versions and lineage.
- Keep published definitions non-authoritative and separate from source data.

### Reports

- Generate reporting SQL from natural-language requests.
- Edit, validate, execute, and repair read-only SQL.
- Route queries through the governed Query Gateway.
- Build chart and KPI views in BI Studio.
- Maintain a virtual report catalog and execution history.

### KPI Intelligence

- Interpret report output with AI-generated business context.
- Manage KPI definitions, evidence, formulas, governance, and follow-up questions.
- Surface trends, anomalies, and actionable explanations with source evidence.

### Schema Hub

- Explore schema metadata and relationships.
- Maintain a virtual schema registry, business glossary, tags, and lineage views.
- Ground query planning in known tables, columns, and join paths.

### Intelligence and Administration

- Review alerts, activity, performance, and operational health.
- Inspect audit records, security configuration, sessions, agents, pipelines, and query history.
- Analyze retry behavior and learned term mappings without changing source data.

## Architecture

```text
Browser
  |
  v
Next.js 16 App Router
  |-- React application hubs
  |-- Next.js route handlers
  |-- NextAuth / Microsoft Entra ID
  |-- Vercel AI SDK and AI Gateway
  |
  v
Validation and orchestration
  |-- Query Gateway
  |-- Read-only SQL guard
  |-- Schema-aware planning and retry
  |-- Metadata, KPI, report, and export services
  |
  v
Parameterized mssql data layer
  |
  v
Read-only SQL Server / Azure SQL source
```

The browser never connects directly to SQL Server. Credentials remain in server-side environment variables, and live SQL is executed through the `mssql` driver. When a usable database connection is absent, supported surfaces can operate with synthetic demo data.

## Technology stack

| Layer | Technology |
| --- | --- |
| Runtime | Next.js 16 App Router, Node.js |
| UI | React 19, TypeScript, Tailwind CSS 4, shadcn, Base UI |
| Data fetching | SWR |
| Charts | Recharts |
| AI | Vercel AI SDK 6, Vercel AI Gateway, optional Azure OpenAI |
| Authentication | NextAuth 4, Microsoft Entra ID, development-only credentials provider |
| Source data | SQL Server / Azure SQL through `mssql` |
| Validation | Zod and shared query guards |
| Testing | Vitest and endpoint smoke tests |
| Deployment | Vercel or a compatible Node.js environment |

## Repository map

```text
app/
  api/                    Route handlers for queries, reports, metadata, KPI,
                          discovery, auth, administration, and health
  page.tsx                Application shell and hub navigation
components/
  admin/                  Administration workspace
  bi/                     BI Studio
  dashboard/              Executive overview and navigation
  data/                   Table Explorer and discovery UI
  dataset/                Dataset Studio
  intelligence/           Intelligence Center
  kpi/                    KPI Intelligence
  schema/                 Schema Hub
  studio/                 Report Studio
lib/
  agents/                 Schema-aware and metadata agents
  ai/                     AI Gateway configuration and prompts
  db/                     Read-only database client
  discovery/              Catalog, search, and navigation
  gateway/                Governed query orchestration
  services/               Database, report, KPI, metadata, and validation services
  validation/             Dataset validation
  utils/                  Formatting and governed exports
tests/                    Unit, architecture, security, and behavior tests
scripts/                  Local support scripts; never use these to mutate source data
```

## Core API surface

The repository contains additional internal routes; these are the principal integration surfaces.

| Area | Routes |
| --- | --- |
| Health | `GET /api/health` |
| Data discovery | `GET /api/tables`, `GET /api/data`, `GET /api/data/[table]`, `POST /api/discover/search` |
| Query generation | `POST /api/generate-query`, `POST /api/generate-query/validate`, `POST /api/generate-query/correct` |
| Governed execution | `POST /api/gateway/query`, `POST /api/run-sql`, `POST /api/analytics/query` |
| Reports | `GET/POST /api/reports`, `GET/PATCH/DELETE /api/reports/[id]`, `POST /api/report/run` |
| Schema | `GET /api/schema`, `GET /api/schema/tables`, `GET /api/schema/metadata` |
| KPI | `GET /api/kpis/catalog`, `POST /api/kpi/interpret`, `POST /api/kpi/compute` |
| Intelligence | `GET /api/intelligence`, `GET /api/intelligence/stream`, `GET /api/alerts` |
| Administration | `GET /api/audit/logs`, `GET /api/auth/sessions`, `GET /api/query-history` |

Route methods such as `POST`, `PATCH`, or `DELETE` may manage virtual, in-memory, or application-level definitions. They do not authorize mutation of the connected healthcare source database.

## Local development

### Prerequisites

- Node.js compatible with Next.js 16
- npm
- Optional access to a read-only SQL Server instance
- Optional Vercel AI Gateway or Azure OpenAI credentials
- Optional Microsoft Entra ID application credentials

### Install and run

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Development and preview environments expose a credentials-based demo sign-in only when Microsoft Entra ID is not configured. The production authentication path uses Entra ID.

### Environment variables

Create `.env.development.local` for local development. Never commit real values.

Database configuration uses one of these options, in precedence order:

```bash
# Option 1: URL
DATABASE_URL=mssql://USER:PASSWORD@HOST:1433/DATABASE

# Option 2: individual SQL Server fields
DB_HOST=HOST
DB_PORT=1433
DB_NAME=DATABASE
DB_USER=READ_ONLY_USER
DB_PASS=PASSWORD
DB_ENCRYPT=true
DB_TRUST_CERT=false

# Option 3: raw connection string
SQL_CONNECTION_STRING=Server=HOST;Database=DATABASE;User Id=USER;Password=PASSWORD
```

The configured database principal must have read-only permissions.

Optional AI configuration:

```bash
AI_GATEWAY_API_KEY=...

# Or Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_DEPLOYMENT=...
```

Optional production authentication:

```bash
NEXTAUTH_URL=https://your-deployment.example
NEXTAUTH_SECRET=...
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
AZURE_AD_TENANT_ID=...
```

Use `GET /api/health` to confirm database mode, AI configuration, cache state, and runtime health without exposing secrets.

## Quality gates

Run the same checks before opening a pull request:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

The test suite covers read-only enforcement, query validation, parameterized filters, table allowlisting, semantic discovery, schema-aware retries, request deadlines, KPI evidence, analytics contracts, dataset validation, and governed exports.

## Operational modes and persistence

- **Live database mode:** executes validated, parameterized reads against SQL Server.
- **Demo mode:** uses synthetic data when no usable database is configured.
- **Unavailable mode:** reports a configured but unreachable database without silently treating it as live.
- **Virtual metadata:** several report, dataset, KPI, and administration stores are process-local or non-authoritative. Treat them as preview/workflow state unless a service explicitly documents durable storage.

Do not represent virtual metadata as a write to the source system. Do not place healthcare source data into client-side persistence.

## Security model

- Microsoft Entra ID is the production identity provider.
- Database and AI credentials are server-only.
- SQL guards reject mutations, DDL, multi-statement execution, and privileged commands.
- Generated analytics queries require governed tables and parameterized date bounds.
- Dynamic filter values are bound parameters; identifiers are metadata-validated and safely quoted.
- Connection attempts are bounded, pooled, retried only for appropriate failures, and protected by cooldowns.
- Audit and session surfaces support operational review.

Application controls complement, but do not replace, a database account that is restricted to read-only access.

## AI contributor checklist

Before an AI-generated change is accepted, verify that it:

1. preserves source-database immutability;
2. adds no migration, seed, mutation, or client-side database access;
3. uses shared query guards and parameterized execution;
4. does not expose secrets, PHI, or raw result data in logs;
5. follows existing service, route, component, and validation patterns;
6. includes focused tests for security and failure behavior;
7. passes TypeScript, tests, lint, and production build checks;
8. updates this README when architecture or setup requirements change.

When uncertain, choose the safer read-only design and document the tradeoff.

## Business value

- **Executives:** timely KPIs, trends, and operational visibility.
- **Analysts:** governed self-service exploration and reduced SQL dependency.
- **Operations:** drill-down reporting, utilization monitoring, and actionable exceptions.
- **IT and compliance:** centralized query controls, read-only source access, auditability, and maintainable application boundaries.

## v0 project

This repository is connected to [v0](https://v0.app). Authorized contributors can continue development in the linked project:

[Open the AcaciaHealth Dynamic Reporting project in v0](https://v0.app/chat/projects/prj_yw4repKk9bArgEPTt93luo6mIM0M)
