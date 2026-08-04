# AcaciaHealth Dynamic Reporting — Comprehensive Codebase Audit Report

**Date:** 2026-07-28  
**Auditor:** FullStack / BackendSystems / QA / Performance / ProductEnhancement  
**Application:** AcaciaHealth Dynamic Reporting (Next.js 16, MSSQL, Azure AD)

---

## 1. APPLICATION INVENTORY

### 1.1 Pages (Next.js Routes)

| Route | Component | Auth Protected |
|---|---|---|
| `/` | `app/page.tsx` | No (redirect to login) |
| `/login` | `components/auth/LoginPage.tsx` | No |
| `/dashboard` | `app/dashboard/page.tsx` | Yes (middleware) |

> **Note:** The entire application is a single-page app-shell at `/dashboard`. All sub-views are tab-switched via the `Sidebar` — there are no deep URL routes for individual tabs (Home, Discover, Dataset Studio, Reports, KPI Intelligence, Schema Hub, Administration).

### 1.2 API Routes (64 total)

**Query Execution Layer (9 routes — all funnel through QueryGateway):**

| Route | Method | Purpose |
|---|---|---|
| `/api/run-sql` | POST | SQL Editor execution |
| `/api/generate-query` | POST | NL → SQL plan (planOnly=true) |
| `/api/generate-sql` | POST | Alias of generate-query |
| `/api/gateway/query` | POST | Primary gateway endpoint |
| `/api/report/run` | POST | Report runner |
| `/api/orchestrate` | POST | Orchestration |
| `/api/datasets/query` | POST | Dataset query |
| `/api/semantic/plan` | POST | Semantic plan |
| `/api/pipeline/execute` | POST | Pipeline step execution |

**Query Correction / Fix Layer (3 routes — partial duplication):**

| Route | Method | Purpose |
|---|---|---|
| `/api/generate-query/correct` | POST | Correction |
| `/api/generate-query/validate` | POST | Validation |
| `/api/fix-query` | POST | Self-healing SQL (older, vector-based) |

**Schema & Metadata (6 routes):**
`/api/schema`, `/api/schema/tables`, `/api/schema/tags`, `/api/schema/metadata`, `/api/schema/debug`, `/api/schema/intelligence`

**KPI (7 routes):**
`/api/kpi/[kpi]`, `/api/kpi/ask`, `/api/kpi/compute`, `/api/kpi/followup`, `/api/kpi/intelligence`, `/api/kpi/interpret`, `/api/kpi/seed-reports`

**BI Studio (5 routes):**
`/api/bi/copilot`, `/api/bi/datasets`, `/api/bi/datasets/[id]`, `/api/bi/reports`, `/api/bi/reports/[id]`

**AI Agents (5 routes):**
`/api/agents/kpi-definitions`, `/api/agents/kpi-engine`, `/api/agents/normalise-metadata`, `/api/agents/registry`, `/api/agents/vector-embed`

**Auth (3 routes):**
`/api/auth/[...nextauth]`, `/api/auth/sessions`, `/api/auth/validate`

**Admin / Governance (10 routes):**
`/api/admin/apcs`, `/api/audit/logs`, `/api/kpi-admin`, `/api/rbac/roles`, `/api/query-history`, `/api/learned-mappings`, `/api/gateway/patterns`, `/api/gateway/feedback`, `/api/registry`, `/api/pipeline/definitions`

**Data Access (3 routes):**
`/api/data`, `/api/data/[table]`, `/api/tables`

**Other (7 routes):**
`/api/health`, `/api/pins`, `/api/pins/[id]`, `/api/reports`, `/api/reports/[id]`, `/api/save-report`, `/api/protected/reports`

---

### 1.3 Components (59 total)

```
components/
  AuthButtons.tsx             — Session login/logout buttons
  SessionProvider.tsx         — NextAuth SessionProvider wrapper
  access/
    DataContractWorkspace.tsx — Data contract CRUD UI
  admin/
    APCSPanel.tsx             — Prompt compaction analytics
    AdministrationHub.tsx     — Admin tab router
    MetadataValidationPanel.tsx
    ObservabilityDashboard.tsx
    QueryHistoryPanel.tsx
    SecurityConsole.tsx
  agents/
    AgentRegistry.tsx         — AI Agent registry display
  audit/
    AuditDashboard.tsx        — Audit log viewer (uses seeded demo data in route)
  auth/
    LoginPage.tsx             — Login form
  bi/
    AiCopilot.tsx, AiFixPanel.tsx, BiStudio.tsx, ChartRenderer.tsx
    DatasetBuilder.tsx, ExcelImport.tsx, FeedbackModal.tsx
    KpiExplorerCanvas.tsx, QueryPage.tsx, ReportManager.tsx
    WorkspacePage.tsx, WorkspaceTabBar.tsx
  dashboard/
    DashboardHome.tsx, HealthStatus.tsx, KpiCards.tsx, KpiExplorer.tsx
    KpiIntelligence.tsx, KpiInterpreter.tsx, ReportRunner.tsx
    SchemaViewer.tsx, Sidebar.tsx
  data/
    DataExplorer.tsx          — Table browser (uses localStorage cache)
  dataset/
    DatasetDesigner.tsx, DatasetStudioHub.tsx
  discover/
    SemanticSearchPanel.tsx
  gateway/
    GatewayTransparencyPanel.tsx
  kpi-admin/
    KpiSchemaAdmin.tsx
  kpi/
    KpiIntelligenceHub.tsx
  pipeline/
    PipelineBuilder.tsx
  registry/
    SchemaIntelligenceRegistry.tsx
  schema/
    MetadataReportEngine.tsx, SchemaHub.tsx
  security/
    SessionManager.tsx
  studio/
    AskAI.tsx, PostQueryAnalytics.tsx, QueryExplanation.tsx
    ReportStudio.tsx, ResultsTable.tsx, SQLEditor.tsx
    SavedReports.tsx, SavedReportsLibrary.tsx
    SemanticQueryPanel.tsx, VisualQueryBuilder.tsx
  ui/
    FileUpload.tsx, button.tsx, card.tsx, chart.tsx
```

### 1.4 Libraries / Services

```
lib/
  ai/
    apcs/            — APCS prompt compression pipeline (APCSPipeline.ts, PromptCompactor.ts, PromptStore.ts)
    gateway.ts       — AI model provider (Vercel AI Gateway / Azure OpenAI)
    insightAgentPrompt.ts — Master system prompt builder (single source of truth)
    vectorSearch.ts  — pgvector embedding search
  agents/
    KPIDefinitionAgent.ts, KPIEngineAgent.ts
    MetadataNormalizationAgent.ts, RelationshipBuilderAgent.ts
    SchemaAwareRetryAgent.ts    — Phase 9 retry loop
    VectorEmbeddingAgent.ts
    orchestrator.ts, pinsRegistry.ts
    queryLearner.ts             — Client-side sessionStorage learner
    queryPlanner.ts, reportRegistry.ts
    schemaAgent.ts              — Knowledge Graph inference
    semanticQueryEngine.ts, tableTagger.ts
    tfidfEngine.ts              — Hybrid TF-IDF + synonym search
  config/
    allTables.json, bucketMap.json, healthcareThesaurus.json
    kpiConfig.json, schemaConfig.json, semanticLayer.json
    sqlLibrary.ts
  db/
    appClient.ts   — App metadata Postgres client (query history, learned mappings)
    pgvectorClient.ts
    readOnlyClient.ts
    setupVectors.ts
  gateway/
    QueryGateway.ts — 9-stage query orchestration engine (MAIN ENTRY POINT)
  services/
    aiQueryService.ts, cache.ts, datasetService.ts
    dateParams.ts, db.ts (MSSQL mssql driver)
    formatter.ts, kpiFormulaEngine.ts, kpiService.ts
    metadataRegistry.ts, observabilityStore.ts
    queryCorrectionService.ts, queryGenerator.ts
    queryGuard.ts, queryHistoryStore.ts
    relationshipService.ts, reportService.ts, sqlBuilder.ts
  access/
    contractService.ts, datasetDraft.ts, queryBuilder.ts, schemaRegistry.ts
  hooks/
    useQueryFeedbackLog.ts
```

### 1.5 Infrastructure

- **Framework:** Next.js 16.2.6, React 19
- **Database (OLAP):** MSSQL via `mssql` (tedious) driver — on-prem SQL Server
- **Database (App State):** Postgres via `pg` (AppDataClient) — query history, learned mappings
- **Auth:** NextAuth v4 (Azure AD + credentials)
- **AI:** Vercel AI SDK v6 (`ai@^6`), AI Gateway
- **Vector Search:** pgvector (Postgres extension)
- **State:** Zustand v5, SWR v2
- **Testing:** Vitest + custom e2e runner

---

## 2. ANALYSIS FINDINGS

---

### 2.1 CRITICAL FINDINGS

---

#### CRIT-01 — 52 of 64 API Routes Have No Authentication Guard

**Severity: CRITICAL**  
**File:** `middleware.ts`

The middleware only protects `/dashboard/:path*` and `/api/protected/*`. Every other API route — including `/api/run-sql`, `/api/gateway/query`, `/api/generate-query`, `/api/kpi/ask`, `/api/admin/apcs`, `/api/query-history`, `/api/learned-mappings`, `/api/rbac/roles`, `/api/audit/logs`, and 43 others — is **publicly reachable with zero authentication**.

An unauthenticated attacker can:
- Execute arbitrary SQL generation requests against the AI backend
- Read query history and learned term mappings
- Trigger the schema-aware retry engine
- Access APCS admin metrics
- Read and modify RBAC roles and pipeline definitions

**Affected routes (confirmed unprotected):** All routes except `/api/auth/*`, `/api/health`, `/api/protected/*`.

**Remediation:**
```ts
// middleware.ts — expand the matcher
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/protected/:path*",
    "/api/run-sql",
    "/api/gateway/:path*",
    "/api/generate-query/:path*",
    "/api/generate-sql",
    "/api/kpi/:path*",
    "/api/admin/:path*",
    "/api/query-history",
    "/api/learned-mappings",
    "/api/audit/:path*",
    "/api/rbac/:path*",
    // ... (or use a blanket "/api/:path*" and whitelist /api/auth, /api/health)
  ],
};
```

---

#### CRIT-02 — Gateway Learning Store (`_learningStore`, `_auditLog`) Is In-Process Memory Only

**Severity: CRITICAL**  
**Files:** `lib/gateway/QueryGateway.ts:213`, `lib/gateway/QueryGateway.ts:285`

The QueryGateway maintains `_learningStore` (1,000 pattern cap) and `_auditLog` (5,000 entry cap) as plain module-level arrays. These are:

1. **Lost on every Vercel cold start / function restart.** Serverless functions are stateless; any learned pattern or audit entry disappears.
2. **Not shared across Vercel function instances.** Concurrent requests hit different instances with different `_learningStore` states, meaning pattern similarity lookups are inconsistent.
3. **Separate from `queryHistoryStore.ts` which already has Postgres persistence.** There are now TWO learning stores (in-process gateway store + Postgres-backed history store) that are not synchronized.

**Consequence:** The "Approved Pattern" matching in Stage 3 (`ApprovedPatternAgent`) will almost always return `null` in production, causing every request to go through the full AI generation pipeline instead of reusing validated patterns.

**Remediation:** Migrate `_learningStore` and `_auditLog` to the existing Postgres AppDataClient (same tables that `queryHistoryStore.ts` already creates). The infrastructure is already present — it just needs to be wired.

---

#### CRIT-03 — `typescript.ignoreBuildErrors: true` in `next.config.mjs`

**Severity: CRITICAL**  
**File:** `next.config.mjs`

TypeScript errors are silently suppressed at build time. The `tsc --noEmit` check produces no errors only because the CI/CD step likely skips it. Runtime type errors that TypeScript would catch can reach production undetected.

**Remediation:**
```js
// next.config.mjs — remove this block entirely
typescript: {
  ignoreBuildErrors: true,  // DELETE THIS
},
```
Then fix any actual TypeScript errors exposed.

---

### 2.2 HIGH FINDINGS

---

#### HIGH-01 — `app/api/data/route.ts` Bypasses the QueryGateway

**Severity: HIGH**  
**File:** `app/api/data/route.ts`

This route calls `executeQueryWithParams` directly instead of routing through `runQueryGateway`. While it does enforce data contracts via `getContract()` and uses `buildSafeQuery()`, it bypasses:
- Stage 1 (intent classification)
- Stage 7 (feedback)
- Stage 8 (learning)
- The unified audit trail

This means queries through `/api/data` are invisible to the observability and learning systems.

**Remediation:** This route's use case (contract-scoped paginated table reads) is legitimate and different from free-form SQL. Create a dedicated `source: "data_contract"` query source in the Gateway, or at minimum route through the gateway's execution + audit stages.

---

#### HIGH-02 — `app/api/fix-query/route.ts` Is a Parallel Self-Healing Path

**Severity: HIGH**  
**File:** `app/api/fix-query/route.ts`

This 326-line route implements its own SQL repair pipeline (pgvector embedding → context docs → AI fix). The `SchemaAwareRetryAgent` (Phase 9) already provides schema-aware SQL correction inside the QueryGateway. Having two independent repair paths means:
- Learned mappings from `fix-query` are never fed back into `queryHistoryStore`
- The retry loop in the gateway and the repair pipeline in `fix-query` can produce conflicting corrections for the same query
- Double maintenance burden

**Remediation:** Deprecate `/api/fix-query`. Route all repair calls to `/api/generate-query/correct` (which already calls `SchemaAwareRetryAgent`) or expose the retry result via the gateway's `retry_info` field.

---

#### HIGH-03 — `app/dashboard/page.tsx` Uses `useEffect` + `fetch` (Anti-Pattern)

**Severity: HIGH**  
**File:** `app/dashboard/page.tsx`

The dashboard page is a `"use client"` component that uses `useEffect` + `fetch` to load reports. Per v0 guidelines: **do not fetch inside useEffect**. This causes:
- No deduplication (multiple renders = multiple requests)
- No caching (data is re-fetched on every mount)
- No error boundary integration
- Race conditions on fast navigation

Additionally, the `/dashboard` page is the full app shell but is itself a simple demo with just a reports table. The real app shell is `DashboardHome.tsx` which renders the full sidebar + tab routing. The two are disconnected.

**Remediation:** Replace `useEffect` + `fetch` with SWR:
```ts
const { data, error, isLoading, mutate } = useSWR('/api/protected/reports', fetcher);
```

---

#### HIGH-04 — `/api/audit/logs` Returns Hardcoded Seeded Demo Data

**Severity: HIGH**  
**File:** `app/api/audit/logs/route.ts`

The audit log route generates 50 fake entries with hardcoded user names and events. The `AuditDashboard` component displays this as if it were real. In production, this means compliance audit logs are fake and security-relevant queries audited by the gateway's `_auditLog` are never shown to administrators.

**Remediation:** Wire `/api/audit/logs` to `getAuditLog()` from `QueryGateway.ts` (or the Postgres-backed equivalent after CRIT-02 is resolved). Remove the seeded demo array.

---

#### HIGH-05 — `kpi/followup` and `kpi/ask` Run on Edge Runtime with mssql Dependency Risk

**Severity: HIGH**  
**Files:** `app/api/kpi/followup/route.ts`, `app/api/kpi/ask/route.ts`

Both routes declare `export const runtime = "edge"` and stream responses. They import from `@/lib/ai/insightAgentPrompt` which is safe, but if any transitive import pulls in `mssql` (which uses native Node.js bindings) the route will fail at Vercel Edge. The `next.config.mjs` correctly marks `mssql` as `serverExternalPackages`, but this only applies to `nodejs` runtime. Any future change that adds a DB call to these routes will silently fail at the edge.

**Remediation:** Add explicit comments and lint rules preventing DB imports in edge routes. Consider a single `export const runtime = "nodejs"` change with streaming disabled, or guard with runtime checks.

---

#### HIGH-06 — No Route-Level Input Validation (Zod Not Used in API Routes)

**Severity: HIGH**  
**Scope:** All 64 API routes

Despite `zod@^4.4.3` being listed as a dependency, zero API routes use Zod for request body validation. Routes manually destructure `req.json()` and check for presence but not type, shape, or value ranges. Examples:
- `/api/run-sql`: `if (!sql || typeof sql !== "string")` — no max length check
- `/api/gateway/query`: date strings accepted without format validation
- `/api/kpi/interpret`: no schema validation on input object shape

**Remediation:** Create a shared `validateBody<T>(req, schema)` helper using Zod and apply it at the top of every route handler.

---

### 2.3 MEDIUM FINDINGS

---

#### MED-01 — Duplicate Route Pairs (Redundant Endpoints)

**Severity: MEDIUM**

The following route pairs have overlapping or identical behavior:

| Primary | Duplicate | Overlap |
|---|---|---|
| `/api/gateway/query` | `/api/run-sql` + `/api/generate-query` | All three call `runQueryGateway` |
| `/api/generate-sql` | `/api/generate-query` | Same body, same gateway call |
| `/api/reports` | `/api/bi/reports` | Both manage saved reports |
| `/api/schema` | `/api/schema/tables` | Both return schema info |
| `/api/orchestrate` | `/api/gateway/query` | Both call `runQueryGateway` |

This creates maintenance confusion: a fix to gateway behavior may need to be applied to 5+ routes if callers are checking specific fields.

**Remediation:** Audit callers of each duplicate. Migrate callers to the canonical route and return HTTP 301/410 from deprecated routes.

---

#### MED-02 — `queryLearner.ts` Uses sessionStorage (Data Lost on Tab Close)

**Severity: MEDIUM**  
**File:** `lib/agents/queryLearner.ts`

The client-side query learner that drives TF-IDF table boost scores stores its state in `sessionStorage`. Closing the tab or restarting the browser silently wipes all learned table frequency data. This defeats the "adaptive suggestions" feature for any session longer than one browser tab.

**Remediation:** Persist learner state to `localStorage` with a TTL (7-day expiry). For true cross-session persistence, sync to a server endpoint (POST to `/api/query-history` or a new `/api/user-preferences` route).

---

#### MED-03 — `DataExplorer.tsx` Uses `localStorage` for Table List Cache (Stale Data Risk)

**Severity: MEDIUM**  
**File:** `components/data/DataExplorer.tsx`

The table list is cached in `localStorage` under `hchb_table_list` with no TTL or invalidation. If the schema changes (tables added/removed), users will see outdated autocomplete until they manually clear browser storage.

**Remediation:** Add a timestamp to the cache entry and invalidate after 24 hours. Or use SWR with `staleWhileRevalidate` so the list refreshes in the background.

---

#### MED-04 — `app/dashboard/page.tsx` Is a Legacy Stub, Not the Real App Shell

**Severity: MEDIUM**  
**File:** `app/dashboard/page.tsx`

The actual application (Sidebar + DashboardHome + all tabs) renders inside `app/dashboard/page.tsx`'s `DashboardHome` import but the page itself is a legacy prototype with `useSession`, `useEffect`, and a simple reports table that is never seen by real users (the `DashboardHome` is what renders). The page has dead UI code that takes up maintenance bandwidth.

**Remediation:** Simplify `app/dashboard/page.tsx` to a thin RSC wrapper that just renders `<DashboardHome />`. Remove the legacy fetch logic and unused JSX.

---

#### MED-05 — `insightAgentPrompt.ts` Full System Prompt Sent on Every Request

**Severity: MEDIUM**  
**File:** `lib/ai/insightAgentPrompt.ts`

The master system prompt assembles `AGENT_IDENTITY + CORE_PRINCIPLES + DOMAIN_EXPERTISE + RESPONSE_FORMAT + ...` (14 sections) into a single large string sent with every AI call. The APCS compression layer (`buildCompactSemanticQueryPrompt`) provides some compression, but its metrics show this is not applied to all routes — `kpi/interpret`, `kpi/ask`, and `bi/copilot` call the full prompt builders that do not use APCS.

**Remediation:** Apply APCS compression to all AI-calling routes, not just the SQL generator.

---

#### MED-06 — 86 Direct `fetch()` Calls in Components Without SWR

**Severity: MEDIUM**  
**Scope:** 86 raw fetch calls in `components/`

The codebase has 86 raw `fetch()` calls in components, many inside `useEffect`. This means:
- No request deduplication
- No caching / stale-while-revalidate
- Error states handled inconsistently
- No global loading state coordination

**Remediation:** Migrate all data-fetching components to SWR hooks with a centralized fetcher. Create typed hooks (e.g., `useReports()`, `useKpiCards()`) that other components consume.

---

#### MED-07 — `SavedReports.tsx` and `SavedReportsLibrary.tsx` Are Functional Duplicates

**Severity: MEDIUM**  
**Files:** `components/studio/SavedReports.tsx`, `components/studio/SavedReportsLibrary.tsx`

Both components render lists of saved reports and are used in different parts of the UI. They likely share similar fetch logic and display patterns. Without reading both deeply, they appear to be a case of parallel component evolution.

**Remediation:** Unify into a single `SavedReportsLibrary` component with an optional compact/full-view prop.

---

### 2.4 LOW FINDINGS

---

#### LOW-01 — `xlsx` Package Loaded in `ResultsTable.tsx` Client Bundle

**Severity: LOW**  
**File:** `components/studio/ResultsTable.tsx`

The `xlsx` package (SheetJS) is statically imported in a `"use client"` component. This adds ~300KB to the client bundle even when the user never exports to Excel.

**Remediation:** Use `next/dynamic` with `ssr: false` to lazy-load the xlsx import only when the export button is clicked.

---

#### LOW-02 — No Suspense Boundaries in Dashboard Tab Views

**Severity: LOW**  
**Scope:** All tab components in `DashboardHome`

None of the tab-level components are wrapped in `<Suspense>`. If any async component fails or suspends, the entire dashboard crashes instead of showing a graceful fallback.

**Remediation:** Wrap each primary view in `<Suspense fallback={<LoadingSkeleton />}>`.

---

#### LOW-03 — `crypto-js` Dependency Is Unused

**Severity: LOW**  
**File:** `package.json`

`crypto-js@^4.2.0` is listed as a dependency. Searching the codebase finds no imports of it. Node.js has built-in `crypto` module which is used for hashing in several services.

**Remediation:** Remove `crypto-js` from `package.json`.

---

#### LOW-04 — `enhanced-resolve` Listed as Runtime Dependency

**Severity: LOW**  
**File:** `package.json`

`enhanced-resolve@^5.18.1` is a webpack internal utility. It should be a `devDependency`, not a production `dependency`. It was likely added to fix a build issue and was never categorized correctly.

**Remediation:** Move to `devDependencies`.

---

#### LOW-05 — Missing Error Boundaries on All Major Components

**Severity: LOW**  
**Scope:** Entire component tree

No React Error Boundaries exist anywhere in the codebase. If `ChartRenderer`, `ResultsTable`, or `KpiIntelligenceHub` throw a runtime error, the entire dashboard unmounts.

**Remediation:** Add a top-level `ErrorBoundary` in `app/dashboard/page.tsx` and per-tab boundaries in `DashboardHome`.

---

#### LOW-06 — `app/page.tsx` Root Page Not Audited for Redirect Behavior

**Severity: LOW**  
**File:** `app/page.tsx`

The root page likely redirects to `/login` or `/dashboard`. Its behavior should be confirmed to correctly handle both authenticated and unauthenticated states server-side (using `getServerSession`) rather than client-side to avoid flash of incorrect content.

---

## 3. QUERY RETRY AUDIT

### 3.1 Retry Loop Analysis

**Status: WELL IMPLEMENTED with one critical gap**

The `SchemaAwareRetryAgent` implements the Golden Rule correctly:
- Anti-loop: normalized SQL hash comparison (`hashSql` djb2) prevents identical query replay
- Anti-loop: same remediation strategy check prevents trivial retry loops
- Anti-loop: `priorHashes` set passed to AI prevents hash collision
- MAX_RETRIES = 3 (configurable)
- Failure classification covers 10 categories (TABLE_NOT_FOUND, COLUMN_NOT_FOUND, JOIN_FAILURE, etc.)
- Remediation strategies are failure-class-specific and augmented with learned mappings

**Gap:** The retry stores failure records in `queryHistoryStore` (Postgres/in-memory fallback), but the `_learningStore` in `QueryGateway.ts` is separate (in-memory only, CRIT-02). This means learned patterns from successful retries are not available across restarts.

### 3.2 Retry Version Tracking

- `retry_version` field in `QueryHistoryEntry` is set correctly (0 = original attempt, 1-3 = retry attempts)
- `failure_reason` (FailureClass) is stored on each attempt
- `remediation_strategy` is stored as a human-readable string
- `final_success_query` is updated on success via `markQuerySuccess()`
- `learned_mappings_snapshot` is serialized at time of success

**Assessment:** Correct. Retry history is not replaying identical SQL.

---

## 4. METADATA AUDIT

### 4.1 `metadata.json` Usage

`public/metadata.json` exists and is loaded by:
- `app/api/fix-query/route.ts` (legacy — reads via `readFileSync`)
- `lib/services/metadataRegistry.ts`

However, the main system now uses `lib/config/schemaConfig.json`, `kpiConfig.json`, and `semanticLayer.json` as the authoritative metadata sources. `public/metadata.json` is a legacy artifact that is only accessed by the deprecated `fix-query` route.

**Recommendation:** Remove `public/metadata.json` dependency from `fix-query`. Use the config JSON files exclusively.

### 4.2 Metadata for Relationship Inference

`lib/config/schemaConfig.json` is used in Stage 4 (SQLGeneratorAgent) and `SchemaAwareRetryAgent`. The `schemaAgent.ts` (`inferQueryContext`) queries the pgvector store for table/column resolution.

Alias mapping is handled through:
- `lib/config/healthcareThesaurus.json` (synonym expansion in TF-IDF engine)
- `lib/services/metadataRegistry.ts` (column alias resolution)
- Learned mappings in `queryHistoryStore` (runtime alias discovery)

**Assessment:** The three-layer alias system (thesaurus → schema config → learned mappings) is well-structured. The gap is that learned mappings are volatile (in-memory fallback).

---

## 5. HISTORICAL QUERY MEMORY

### 5.1 Query Signature Storage

- `hashSql()` uses djb2 with normalization (strip NOLOCK, collapse whitespace, lowercase, strip AS aliases)
- `generateSchemaHash()` extracts table references for schema fingerprinting
- Both hashes are stored in `query_history` table

**Assessment: Correct.** The normalization is thorough enough to detect logically equivalent queries.

### 5.2 Learned Mappings

- `user_term → actual_object` with confidence scoring
- `success_count / failure_count` tracked for each mapping
- High-confidence mappings (≥0.6) injected into SQL generation prompts
- `suggestMappingsForError()` matches error message text to learned terms

**Assessment: Correct.** The confidence decay/growth model is appropriate.

---

## 6. PROMPT OPTIMIZATION AUDIT

### 6.1 APCS (Adaptive Prompt Compression System)

The APCS system in `lib/ai/apcs/` provides:
- Dictionary references (replace repeated schema terms with short keys)
- Macro expansion (compress repeated instruction blocks)
- SQL template library (replace boilerplate SQL patterns with template references)
- Schema caching (skip re-transmitting unchanged schema)
- RAG reference injection (replace verbose context docs with IDs)

**Gap:** APCS is only applied in `buildCompactSemanticQueryPrompt` (Stage 4 SQL generation). The following AI routes bypass APCS:
- `/api/kpi/interpret` (full master prompt)
- `/api/kpi/ask` (streaming, full prompt)
- `/api/kpi/followup` (streaming, full prompt)
- `/api/bi/copilot` (full prompt)

These routes are sending the full 14-section system prompt on every request.

### 6.2 Repeated Prompt Blocks

`AGENT_IDENTITY + CORE_PRINCIPLES + DOMAIN_EXPERTISE` are repeated verbatim across all AI routes (≈1,200 tokens each call). With APCS applied, these compress to dictionary references (~80 tokens).

**Estimated token waste without APCS on all routes:** ~1,120 tokens × every KPI/copilot call.

---

## 7. PERFORMANCE AUDIT

### 7.1 Bundle Size

- **57/59 components** are `"use client"` — excessive client-side rendering
- `recharts` imported in 5 client components with no lazy loading
- `xlsx` (SheetJS, ~300KB) statically imported in `ResultsTable.tsx`
- No `next/dynamic` usage anywhere in the codebase
- `mssql` correctly excluded via `serverExternalPackages`

**Estimated impact:** First load JS bundle is likely 2-4MB uncompressed.

### 7.2 Server Component Opportunities

Components that could be Server Components (no interactivity, no hooks):
- `components/dashboard/HealthStatus.tsx` (reads health endpoint, no user interaction)
- `components/dashboard/KpiCards.tsx` (displays static KPI config)
- `components/schema/SchemaHub.tsx` (schema browsing, largely read-only)

### 7.3 Caching

`lib/services/cache.ts` provides in-memory caching with `buildCacheKey` / `getCache` / `setCache`. This is used in the QueryGateway. The same serverless-restart caveat applies — cache is lost on cold starts.

**Recommendation:** Consider Vercel's `unstable_cache` or Redis (Upstash) for distributed cache.

### 7.4 Lazy Loading

No `next/dynamic` calls exist anywhere. All 59 components are eagerly loaded.

**Recommendation:** At minimum, lazy-load heavy tabs:
```ts
const KpiIntelligenceHub = dynamic(() => import('@/components/kpi/KpiIntelligenceHub'), { loading: () => <Skeleton /> });
```

---

## 8. VERCEL-SPECIFIC AUDIT

| Check | Status | Notes |
|---|---|---|
| Build succeeds with no warnings | UNKNOWN | `typescript.ignoreBuildErrors: true` hides TypeScript errors |
| TypeScript strict mode enabled | PARTIAL | `strict: true` in tsconfig but `ignoreBuildErrors: true` overrides it at build |
| Environment variables validated | NO | No startup validation of required env vars |
| Edge runtime compatibility | RISK | `kpi/ask` and `kpi/followup` are edge but import chain could pull Node APIs |
| API route limits reviewed | NO | No max duration or memory config per route |
| Server Actions validated | N/A | No Server Actions used |
| Middleware latency reviewed | OK | Middleware is thin (NextAuth only) |
| Observability configured | PARTIAL | `@vercel/analytics` installed, no error monitoring (Sentry not configured) |
| Error monitoring configured | NO | No Sentry, no Vercel Log Drains configured |
| Bundle analysis reviewed | NO | No `@next/bundle-analyzer` configured |
| Cache headers optimized | NO | No explicit `Cache-Control` headers on API responses |

---

## 9. SECURITY REVIEW SUMMARY

| Finding | Severity |
|---|---|
| 52/64 API routes unauthenticated | CRITICAL |
| Admin endpoints (APCS, RBAC, query history) fully public | CRITICAL |
| No Zod input validation on any route | HIGH |
| Audit log is hardcoded demo data | HIGH |
| `typescript.ignoreBuildErrors` suppresses type-safety | CRITICAL |
| No rate limiting on AI routes | HIGH |
| `public/metadata.json` exposes full schema via GET | MEDIUM |

---

## 10. PRIORITIZED REMEDIATION PLAN

### Sprint 1 — Critical (Do Immediately)

| # | Task | Files | Impact |
|---|---|---|---|
| R-01 | Expand middleware to cover all `/api/*` routes except `/api/auth/*` and `/api/health` | `middleware.ts` | Closes 52 unprotected endpoints |
| R-02 | Remove `typescript.ignoreBuildErrors: true` and fix exposed type errors | `next.config.mjs` | Restores type safety |
| R-03 | Migrate `_learningStore` and `_auditLog` from in-process arrays to Postgres AppDataClient | `lib/gateway/QueryGateway.ts` | Fixes learning persistence across restarts |
| R-04 | Wire `/api/audit/logs` to real audit data (from R-03) | `app/api/audit/logs/route.ts` | Real compliance audit trail |

### Sprint 2 — High (Next Release)

| # | Task | Files | Impact |
|---|---|---|---|
| R-05 | Add Zod validation to all API routes | All `app/api/*/route.ts` | Prevents malformed input attacks |
| R-06 | Replace `useEffect`+`fetch` in `dashboard/page.tsx` with SWR | `app/dashboard/page.tsx` | Eliminates data fetching anti-pattern |
| R-07 | Deprecate `/api/fix-query` — route callers to `/api/generate-query/correct` | `app/api/fix-query/route.ts`, component callers | Eliminates parallel repair path |
| R-08 | Add rate limiting middleware on AI routes (`/api/kpi/*`, `/api/gateway/*`) | New `lib/middleware/rateLimiter.ts` | Prevents AI cost abuse |
| R-09 | Add `max_duration` and memory config to Vercel functions | `next.config.mjs` or `vercel.json` | Prevents runaway AI calls |

### Sprint 3 — Medium (Next Quarter)

| # | Task | Files | Impact |
|---|---|---|---|
| R-10 | Apply APCS compression to `kpi/interpret`, `kpi/ask`, `kpi/followup`, `bi/copilot` | 4 route files | Reduces token cost on every KPI/copilot call |
| R-11 | Migrate 86 raw fetch calls to SWR hooks | ~20 component files | Deduplication, caching, consistency |
| R-12 | Lazy-load heavy components with `next/dynamic` | `DashboardHome.tsx`, 5-6 tab components | Reduces initial bundle by ~40% |
| R-13 | Persist `queryLearner` to `localStorage` with TTL | `lib/agents/queryLearner.ts` | Adaptive suggestions survive tab close |
| R-14 | Add TTL to `DataExplorer` localStorage table cache | `components/data/DataExplorer.tsx` | Prevents stale schema in autocomplete |
| R-15 | Unify `SavedReports` + `SavedReportsLibrary` into one component | Both files | Reduces duplicate maintenance |
| R-16 | Consolidate duplicate routes (generate-sql → generate-query, orchestrate → gateway/query) | 3-4 route files | Reduces API surface |

### Sprint 4 — Low (Backlog)

| # | Task | Files | Impact |
|---|---|---|---|
| R-17 | Remove `crypto-js` unused dependency | `package.json` | Reduce bundle |
| R-18 | Move `enhanced-resolve` to devDependencies | `package.json` | Correct categorization |
| R-19 | Add React Error Boundaries at dashboard and tab level | `app/dashboard/page.tsx`, `DashboardHome.tsx` | Graceful error recovery |
| R-20 | Add Suspense boundaries to all tab-level components | `DashboardHome.tsx` | Loading state resilience |
| R-21 | Lazy-load `xlsx` in `ResultsTable` | `components/studio/ResultsTable.tsx` | ~300KB bundle reduction |
| R-22 | Configure Sentry or Vercel Error Monitoring | `app/layout.tsx`, `instrumentation.ts` | Production error visibility |
| R-23 | Add `/api/health` startup env-var validation | `app/api/health/route.ts` | Early detection of missing config |
| R-24 | Deep URL routing for dashboard tabs | `app/dashboard/[tab]/page.tsx` | Shareable / bookmarkable URLs |
| R-25 | Add `Cache-Control` headers to schema/metadata routes | Schema route files | Browser/CDN caching |

---

## 11. FEATURE ENHANCEMENT BACKLOG

The following enhancements reuse existing APIs, components, and schema with minimal refactoring:

| # | Enhancement | Existing Asset to Reuse |
|---|---|---|
| FE-01 | **Export to CSV/PDF from ResultsTable** — currently only Excel (xlsx) | `ResultsTable.tsx`, existing `xlsx` import |
| FE-02 | **Scheduled Reports** — `source: "scheduled"` already defined in `QuerySource` type | `QueryGateway.ts`, `reportService.ts` |
| FE-03 | **Query Favorites / Pins** — `/api/pins` route and `pinsRegistry.ts` exist but UI is unfinished | `pinsRegistry.ts`, `/api/pins` |
| FE-04 | **Alert Thresholds on KPIs** — `kpiConfig.json` has `benchmarks` per KPI | `KpiCards.tsx`, `kpiFormulaEngine.ts` |
| FE-05 | **Gateway Transparency Panel expansion** — `pipeline` trace is in every gateway response | `GatewayTransparencyPanel.tsx`, `gateway` field in API responses |
| FE-06 | **Query History playback** — `/api/query-history` returns full history; UI doesn't allow re-running historical queries | `QueryHistoryPanel.tsx`, `run-sql` route |
| FE-07 | **Learned Mappings Management UI** — `/api/learned-mappings` route exists; no admin UI to edit/delete mappings | `AdministrationHub.tsx` tab slot |
| FE-08 | **Deep URL routing for tabs** — navigation state is all in-memory; refreshing loses context | `Sidebar.tsx`, Next.js router |
| FE-09 | **Report sharing / permalink** — reports are saved but not shareable via URL | `reportRegistry.ts`, `/api/reports/[id]` |
| FE-10 | **RBAC role assignment UI** — `/api/rbac/roles` exists, `SecurityConsole.tsx` exists but role assignment is read-only | `SecurityConsole.tsx`, `/api/rbac/roles` |

---

*End of Audit Report*
