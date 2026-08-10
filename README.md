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
- `SELECT INTO` or privileged external data access;

Governed multi-result reports may contain multiple semicolon-delimited statements only when every statement independently begins with `SELECT` or a read-only CTE and passes the shared guard.
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

## User and administrator guide

### Roles

| Persona | Primary activities |
| --- | --- |
| Executive or manager | Review KPI cards, trends, exceptions, operational status, and exported reports |
| Analyst | Discover data, generate and review SQL, build datasets, run reports, investigate results, and export data |
| Data steward | Review KPI definitions, evidence, aliases, glossary terms, ownership, lineage, and validation status |
| Administrator | Inspect security posture, sessions, observability, query history, metadata validation, and agent health |
| Engineer | Maintain guarded APIs, metadata artifacts, integrations, tests, and deployment controls |

The demo identity service currently returns `Admin` and `Analyst` roles. Production authorization must be enforced by each protected server route; hiding a navigation item is not an authorization control.

### Workspace map

```mermaid
flowchart TD
    W[AcaciaHealth workspace] --> D[Dashboard]
    W --> X[Data Explorer]
    W --> DS[Dataset Studio]
    W --> BI[BI Workspace]
    W --> RS[Report Studio]
    W --> KPI[KPI Intelligence]
    W --> SH[Schema Intelligence]
    W --> AD[Administration]
    W --> AU[Audit]
    W --> AR[Agent Registry]
    DS --> DES[Designer]
    DS --> VAL[Validation]
    RS --> SQL[SQL editor]
    RS --> SEM[Semantic query]
    RS --> VIS[Visual builder]
    RS --> SAV[Saved reports]
    SH --> REG[Registry and glossary]
    SH --> LIN[Metadata and lineage]
```

### Run a report

1. Open **Report Studio** and choose the SQL, semantic, visual, or saved-report workflow.
2. Set the reporting date range and any governed business filters.
3. Review generated SQL before execution. Use explicit columns and bound parameters.
4. Run the report. For a governed batch, each statement is validated separately and each returned dataset remains independent.
5. Select the named result set to inspect; review row count, execution time, source lineage, classification, confidence, and verification support.
6. Export only the selected result set to an available CSV, spreadsheet, JSON, or print/PDF workflow.
7. Open post-query analytics for follow-up questions. Switching result sets clears the prior conversation so analysis cannot cross dataset boundaries.

### Use the BI Workspace

1. Create or select a workspace tab.
2. Ask a precise question containing the measure, population, date window, and grouping.
3. Generate SQL from governed schema and saved-report context.
4. Review the generated SQL, explanation, source context, and confidence.
5. Execute through `/api/datasets/query` using `StartDate` and `EndDate`.
6. If execution fails, inspect the proposed read-only correction. High-confidence corrections may be retried by the workflow.
7. Save successful work only with the understanding that the current report service is process-local and non-authoritative.

### Build a dataset

1. Select trusted source tables and explicit fields in **Dataset Studio**.
2. Add joins only where known metadata relationships support them.
3. Add date and business filters, grouping, and supported aggregations.
4. Preview the generated read-only query and sample data.
5. Run schema, relationship, filter, and quality validation.
6. Export the validated result or consume the virtual dataset in reporting workflows.

Interactive filtering and aggregation can operate on already-returned rows to avoid unnecessary database round trips. Dataset execution returns at most 10,000 rows and discloses truncation and demo mode in its result contract.

## KPI and data governance

### Evidence model

| Evidence | Interpretation |
| --- | --- |
| Classification | Structural or metadata match to a governed KPI family |
| Confidence | Match strength; never proof of numerical correctness |
| Lineage | Statement-specific source tables and extracted columns |
| Verification plan | Whether a separate safe aggregate can validate the observation |
| `validated` | Observation and verification agree within tolerance |
| `partial` | Evidence exists but coverage is incomplete or values differ |
| `unverified` | A safe numerical comparison is unavailable |

```mermaid
flowchart LR
    C[Source column] --> T[Source table]
    T --> M[Business measure]
    M --> K[Governed KPI]
    K --> E[Evidence and verification]
```

Schema Intelligence derives glossary, provenance, relationships, and lineage from version-controlled metadata and SQL analysis. It must not be described as runtime column-level tracing beyond the evidence available in those artifacts. Newly discovered KPI candidates remain Draft until reviewed by Data Governance; discovery does not imply certification.

### Administrative operations

- **Security Console:** review identity and session posture. Compliance labels in demo UI describe intended controls, not deployment certification.
- **Observability:** inspect process-local performance, prompt health, failures, and request correlation.
- **Query History:** identify repeated failures, expensive patterns, and opportunities for canonical reports or glossary aliases.
- **Metadata Validation:** compare catalogs, expected fields, relationships, and KPI dependencies without repairing or changing source schema.
- **Agent Registry:** inspect query-planning, schema-aware retry, KPI, metadata, relationship, and orchestration responsibilities.

## Architecture

```mermaid
flowchart TB
    Browser[React workspaces] --> App[Next.js 16 App Router]
    App --> Routes[Route handlers]
    Routes --> Orch[Request orchestration]
    Orch --> Services[Report, dataset, KPI and schema services]
    Services --> Guard[ReadOnlyDataClient and SQL guard]
    Guard --> DB[(Read-only SQL Server)]
    Services --> AI[Vercel AI Gateway]
    Services --> Catalog[Versioned governance catalogs]
    Services --> Memory[Bounded process-local stores]
```

The browser never connects directly to SQL Server. Credentials remain in server-side environment variables, and live SQL is executed through the `mssql` driver. When a usable database connection is absent, supported surfaces can operate with synthetic demo data that must be visibly identified as `demoMode`.

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

The current `/api/auth/validate` implementation is a demonstrative identity flow: it includes hardcoded demo users and simulated SSO, passwordless, MFA, device, and network states. Production page middleware can verify a NextAuth token when Azure AD variables are configured, but `/api/*` routes are deliberately excluded from middleware. Before handling sensitive data, replace the demo flow with one server-verifiable session model and enforce authentication and role authorization inside every protected API route.

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

| Capability | Current mode | Limitation |
| --- | --- | --- |
| Operational analytics | Read-only SQL Server | The application must never mutate it |
| Reports, snapshots, versions, execution records | Bounded process-local maps | Virtual, non-authoritative, and lost on restart |
| Workspace tabs and selected UI state | Browser/Zustand state | Interactive continuity only; not a record of truth |
| Query history and telemetry | Process-local or browser-local by surface | Not durable across all deployments |
| Governance catalogs | Version-controlled JSON and TypeScript | Changed through reviewed code/artifact workflows, never source-schema mutations |
| Demo results | Synthetic service fallback | Must never be represented as operational data |

- **Live database mode:** executes validated, parameterized reads against SQL Server.
- **Demo mode:** uses synthetic data when no usable database is configured.
- **Unavailable mode:** reports a configured but unreachable database without silently treating it as live.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Validated: evidence reviewed
    Validated --> Published: steward approval
    Published --> Archived: retired
    Validated --> Draft: definition changes
    Published --> Draft: material revision
```

The lifecycle diagram is a governance model; process-local saved objects do not become durable records merely because they are labeled published. Do not represent virtual metadata as a write to the source system, and do not place healthcare source data into client-side persistence.

## Security model

- Microsoft Entra ID with a server-verifiable session is the production target; the current custom validation route remains demonstrative.
- Database and AI credentials are server-only.
- SQL guards reject mutations, DDL, permission changes, stored procedures, context changes, `SELECT INTO`, and privileged external access. Governed multi-result batches are permitted only when every statement independently passes read-only validation.
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
