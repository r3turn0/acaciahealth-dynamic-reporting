# AcaciaHealth Data Reporting Platform v2 — Internal Enterprise Audit Report

> Internal engineering and governance use only. This document is not rendered by the application UI.

- **Audit date:** 2026-08-05
- **Audited revision:** `b38d8b4119ac60db6112b2d82c0edc870f0a0252`
- **Branch:** `v0/johnericta-6157-715e28e2`
- **Environment:** local Next.js 16 development preview at `http://localhost:3000`
- **Audit mode:** strictly read-only
- **Framework:** `docs/acaciahealth-platform-v2-enterprise-audit.md`
- **Result status:** **PROVISIONAL**

## 1. Executive Summary

AcaciaHealth Platform v2 has a broad, coherent product surface and a strong SQL mutation guard. The application compiled successfully, all 128 automated tests passed, the primary modules rendered, and the safe validator rejected every tested write-capable SQL statement without sending any statement to the source database.

The platform is **not production-ready** in the audited revision. The browser-facing login can grant a simulated administrator session without enterprise identity verification, sensitive APIs are deliberately excluded from middleware authentication, six representative APIs returned data without any session, production dependencies include one critical and seven high-severity vulnerabilities, and baseline security headers are absent. Several administration, security, session, alerting, and governance surfaces present enterprise claims backed by demo or in-memory state.

### Executive scores

| Measure | Score | Assessment |
|---|---:|---|
| Arithmetic score after mandatory security rule | **43/100** | **High Risk** |
| Enterprise readiness | **40/100** | Early operational maturity |
| Governance maturity | **40/100** | Defined concepts, weak durable enforcement |
| Feature parity | **43/100** | Material fragmentation remains |
| Security | **0/100 applied** | Mandatory cap triggered by unauthenticated sensitive APIs |
| Accessibility and UX | **43/100** | Usable visually; material keyboard and semantics gaps |
| Evidence coverage | **87% (47/54 controls)** | Below final-report threshold |
| High-confidence evidence | **48% of controls** | Production and multi-role verification remain |

The uncapped observed Security control average was 43/100. Framework rule 3.6 sets Security to zero where sensitive reporting data is available without authentication; `/api/reports`, `/api/schema`, `/api/audit/logs`, and `/api/rbac/roles` returned HTTP 200 without a session. The resulting overall score is 43, below the 49-point cap.

## 2. Safety Attestation

- No source data or source schema was created, altered, inserted, updated, deleted, truncated, or dropped.
- No report, pipeline, role, alert, session, or other application record was intentionally changed during the audit.
- Mutation checks were sent only to `/api/generate-query/validate`, a parser-only endpoint. They were never sent to an execution endpoint.
- Live SQL execution was not used as audit evidence.
- Screenshots were stored outside the repository under `/tmp/agent-browser/`.
- No patient names, credentials, secrets, or live PHI are reproduced in this report.

## 3. Scope and Evidence

### Evidence collected

- Static inspection of middleware, Auth.js configuration, Query Gateway, SQL guard, read-only client, report services, administration components, and representative APIs.
- Browser inspection at 998×778 desktop and 390×844 mobile viewports.
- Safe unauthenticated GET probes against representative APIs.
- Parser-only validation of 13 write-capable SQL patterns.
- `npm test`: 14 files, 128 tests passed.
- `npm run build`: Next.js 16.2.6 production build passed; 67 static-generation items completed.
- `npm run lint`: completed with warnings, including React effect/state and unused-code findings.
- `npm audit --omit=dev`: 12 production vulnerabilities: 1 critical, 7 high, 4 moderate.
- Browser Web Vitals in development mode: TTFB 66.1 ms, FCP 500 ms, LCP 500 ms, CLS 0.06; INP was not measured.

### Evidence limitations

Seven controls remain not evaluated: F7, S7, P4, U5, E2, E3, and E4. The audit did not use a production-connected source, execute reports against the live warehouse, change durable application metadata, test multiple real Entra identities, run a screen reader, perform penetration testing, validate disaster recovery, or exercise every method on all 75 API route files. Scores are therefore provisional.

## 4. Platform Capability and Navigation Map

The production build exposes three page routes (`/`, `/dashboard`, `/login`) and 75 API route files. Most product modules are stateful panels inside the single application shell rather than distinct URLs.

| Area | Click depth | Observed capability | Audit status |
|---|---:|---|---|
| Home | 1 | Pinned reports, recent reports, health, navigation | Implemented with demo state |
| Discover Data | 2 | Table explorer, semantic search, CSV, dataset handoff | Partial; visibly marked Static/Demo |
| Dataset Studio | 2 | Discover, build, relationships, semantics, validate, publish | Partial; staged/shared-session behavior |
| Report Studio | 2 | Ask AI, semantic engine, visual builder, SQL, saved reports | Core paths implemented; live fidelity not fully verified |
| Report Catalog | 2 | 29 canonical reports, load, download, interpret, pin | Implemented catalog; live runs not audited |
| BI Studio | 2 | Datasets, KPI tools, copilot, SQL workspace, reports, import | Partial and separately modeled |
| KPI Intelligence | 2 | Interpreter, registry, governance, dependency graph | Partial; strong discovery surface |
| Intelligence Center | 1 | Alerts, KPI opportunities, activity, monitoring | Predominantly seeded/demo evidence |
| Schema Hub | 2 | Explorer, metadata, registry, lineage, glossary | Broad static/metadata surface |
| Administration | 2 | Audit, security, sessions, agents, pipelines, settings | UI-complete; several controls are simulated/in-memory |

Navigation is generally discoverable and consistently grouped. Deep-linking, browser history, and route-level authorization are weak because major modules share one page route and local UI state.

## 5. Scoring Ledger

Ratings use the framework scale: 5 Optimized, 4 Managed, 3 Defined, 2 Partial, 1 Initial, 0 Failed, NE Not Evaluated.

| Domain | Control ratings | Domain score | Weight | Contribution |
|---|---|---:|---:|---:|
| Architecture | A1 4, A2 2, A3 3, A4 3, A5 2, A6 2, A7 3 | 54 | 15% | 8.1 |
| Functionality & Reliability | F1 3, F2 4, F3 3, F4 2, F5 2, F6 3, F7 NE, F8 4 | 60 | 20% | 12.0 |
| Governance, Lineage & Quality | G1 3, G2 1, G3 2, G4 3, G5 1, G6 2, G7 2 | 40 | 15% | 6.0 |
| Security, Privacy & Read-Only | S1 4, S2 5, S3 0, S4 1, S5 3, S6 0, S7 NE, S8 2 | **0 applied** | 15% | 0.0 |
| Performance & Observability | P1 4, P2 4, P3 2, P4 NE, P5 3, P6 3 | 64 | 10% | 6.4 |
| Accessibility & UX | U1 1, U2 3, U3 1, U4 2, U5 NE, U6 4, U7 2 | 43 | 10% | 4.3 |
| Feature Parity & Cohesion | C1 3, C2 3, C3 2, C4 2, C5 2, C6 1 | 43 | 10% | 4.3 |
| Enterprise Readiness | E1 2, E2 NE, E3 NE, E4 NE, E5 2 | 40 | 5% | 2.0 |
| **Overall** | | | **100%** | **43/100** |

## 6. Findings by Severity

### Critical

#### AHV2-SEC-001 — Sensitive APIs do not require authentication

- **Controls:** S3, S4, S6
- **Affected modules:** Reports, Schema Hub, Audit, RBAC, Dashboard
- **Evidence:** Without cookies or authorization, representative GET requests returned HTTP 200: `/api/reports` (181,663 bytes), `/api/dashboard/summary`, `/api/schema` (56,452 bytes), `/api/gateway/query`, `/api/audit/logs`, and `/api/rbac/roles`.
- **Root cause:** `middleware.ts` explicitly bypasses `/api/*` and states that APIs are implicitly protected because the UI requires login. Browser UI gating is not an authorization boundary.
- **Impact:** Unauthenticated users can enumerate reports, SQL/metadata, schema, roles, and audit information. Any endpoint exposing live rows could expose regulated data.
- **Remediation:** Introduce a server-side `requireSession`/`authorize` boundary for every non-public API, default-deny routes, scope responses by role and tenant, and add contract tests that expect 401/403 without a valid session.

#### AHV2-SEC-002 — Simulated authentication can mint an administrator session

- **Controls:** S3, S4, S6
- **Affected modules:** Login, Administration, all UI modules
- **Evidence:** `/api/auth/validate` implements demo SSO/passwordless responses without validating an identity token and returns a mock bearer token with an Admin user. Browser SSO opened the full administrator workspace. The same route also contains hard-coded demo credentials and accepts any six-digit MFA code.
- **Root cause:** A demonstration authentication service is wired into the main application runtime instead of being isolated behind a non-production build boundary.
- **Impact:** A deployed configuration that reaches this route permits authentication and privilege bypass.
- **Remediation:** Remove the custom demo authentication path from production bundles. Use one Auth.js/Entra session model, validate tenant/issuer/audience, map directory groups to server-side roles, and fail closed when identity configuration is missing.

#### AHV2-SEC-003 — Critical and high production dependency vulnerabilities

- **Controls:** S6, S8, E1
- **Affected assets:** dependency supply chain
- **Evidence:** `npm audit --omit=dev` reported 1 critical, 7 high, and 4 moderate vulnerabilities. Direct dependencies include a critical `next-auth` advisory and high-severity `next` and `postcss` advisories. A non-major Next.js fix to 16.3.0 is available for multiple findings.
- **Impact:** Authentication, middleware, SSRF, denial-of-service, XSS, and information-disclosure risk.
- **Remediation:** Upgrade patched direct dependencies and regenerate `package-lock.json`; run frozen-lockfile install, tests, lint, build, authentication regression tests, and a new production audit before release.

### High

#### AHV2-SEC-004 — Baseline response security headers are absent

- **Controls:** S6
- **Evidence:** Root responses had no `X-Content-Type-Options`, `Referrer-Policy`, HSTS, frame policy, permissions policy, CSP, or report-only CSP. `next.config.mjs` has no `headers()` configuration.
- **Remediation:** Add baseline headers in one Next.js configuration location. Start CSP in report-only mode with complete API origins, then enforce after validation.

#### AHV2-SEC-005 — Authorization is inconsistent and UI-centric

- **Controls:** S3, S4
- **Evidence:** 75 API route files exist; only 10 files matched any session/auth/authorization pattern, and a match does not prove enforcement. Administration controls and destructive actions are rendered from role state while representative APIs remain open.
- **Remediation:** Centralize route guards, permission names, resource scoping, and audit attribution. Add an authorization matrix test covering Admin, Analyst, Auditor, Viewer, and anonymous users.

#### AHV2-ARCH-001 — Direct database access bypasses the declared read-only client boundary

- **Controls:** A1, A2, S1
- **Evidence:** The read-only client says it is the only approved warehouse access path, but runtime modules import `lib/services/db.ts` directly, including dashboard summary, episode/billing data, table/schema APIs, data APIs, health, and protected reports.
- **Risk:** Current SQL may be read-only, but future edits can bypass the shared guard and create inconsistent timeout, audit, parameterization, and policy behavior.
- **Remediation:** Migrate all runtime source reads to `ReadOnlyDataClient` or a narrowly reviewed introspection wrapper. Enforce this with ESLint import restrictions and architecture tests.

#### AHV2-GOV-001 — Enterprise security and governance claims exceed backing implementation

- **Controls:** G2, G5, G7, S4
- **Evidence:** UI copy claims immutable audit logs, Azure Sentinel forwarding, continuous access evaluation, AAL3 privileged operations, dual approval, PAM, break-glass controls, and live session revocation. Static inspection shows seeded arrays, in-memory stores, simulated sessions, and client-side state for several surfaces.
- **Impact:** Operators may treat demonstration evidence as an implemented control, creating audit and compliance risk.
- **Remediation:** Add a shared capability-state contract (`live`, `demo`, `inspect-only`, `unavailable`) sourced from the server. Prevent simulated controls from using compliance assertions without verifiable integrations.

#### AHV2-GOV-002 — Audit and application metadata are not demonstrably immutable or durable

- **Controls:** G2, G5, E2, E3
- **Evidence:** Audit/session/role/report/pipeline surfaces use a mixture of in-memory stores and generated records. Durability, append-only enforcement, retention, actor attribution, signing, export, and recovery were not established.
- **Remediation:** Use a dedicated application metadata store separate from the read-only clinical source, append-only audit tables, immutable event IDs, actor/session attribution, retention controls, and external SIEM delivery receipts.

### Medium

#### AHV2-UX-001 — Hidden mobile navigation remains keyboard-focusable

- **Controls:** U1, U4
- **Evidence:** At 390×844, document width correctly remained 390 pixels, but keyboard focus moved to a sidebar item whose bounding rectangle began at x = -232 while the drawer was closed.
- **Impact:** Keyboard and switch users can lose visible focus and operate hidden controls.
- **Remediation:** Apply `inert` and `aria-hidden` while the drawer is closed, remove descendants from the tab order, trap focus while open, restore focus to the opener, and close on Escape.

#### AHV2-UX-002 — Dialog and icon-button semantics are incomplete

- **Controls:** U2, U3, U7
- **Evidence:** The session-expiry overlay appeared as a generic container rather than an accessible alert dialog. Security Console and Pipeline Builder snapshots contained buttons with no accessible name.
- **Remediation:** Use accessible dialog primitives with labelled title/description, focus trapping, restoration, and `aria-modal`; label every icon-only button.

#### AHV2-FUNC-001 — Demo/live state is inconsistent across modules

- **Controls:** F1, F5, G7
- **Evidence:** Discover Data clearly shows `Static`, `Read-only`, and `Demo`, while Intelligence Center shows `Live`, Security Console shows Azure Sentinel/AAL3 claims, and Administration shows active sessions without equivalent demo disclosure.
- **Remediation:** Display a persistent environment/capability banner and per-module provenance. Do not mix generated data with live operational labels.

#### AHV2-FUNC-002 — Agent Registry summary contradicts row status

- **Controls:** F5, P5
- **Evidence:** The registry summary reported 13 enabled agents while all 13 displayed rows were labelled disabled.
- **Remediation:** Derive totals and row badges from the same server response and add a consistency test.

#### AHV2-PERF-001 — Large unpaginated payloads and dense DOMs

- **Controls:** P3
- **Evidence:** Unauthenticated `/api/reports` returned 181,663 bytes for 29 reports, including report definitions. Discover Data rendered a 500-row preview in the accessibility tree.
- **Remediation:** Paginate report summaries, lazy-load SQL/details, virtualize large tables, cap previews, and publish payload-size budgets.

#### AHV2-PERF-002 — Performance baseline is promising but incomplete

- **Controls:** P1, P5
- **Evidence:** Development desktop lab metrics were TTFB 66.1 ms, FCP/LCP 500 ms, and CLS 0.06. A prior development run observed CLS 0.15. INP and production route-transition metrics were not collected.
- **Remediation:** Measure production builds for Home, Discover, Report Studio, Catalog, and BI Studio; add interactions for INP and define route/payload/query SLOs.

#### AHV2-ARCH-002 — Authentication and persistence models are fragmented

- **Controls:** A5, A6, S6
- **Evidence:** Auth.js uses JWT cookies, while the main custom login uses `sessionStorage` and mock bearer data. Report, registry, session, and governance state use different API/in-memory/client patterns.
- **Remediation:** Adopt one server-verifiable session, one authorization service, and explicit source-data versus application-metadata persistence boundaries.

#### AHV2-PARITY-001 — Analytical capabilities are split across Report Studio and BI Studio

- **Controls:** C1–C6
- **Evidence:** Report Studio exposes AI/SQL, semantic, visual, and saved-report tabs. BI Studio separately exposes datasets, KPI tools, copilot, SQL workspace, reports, and workbook import. Save, lineage, certification, scheduling, sharing, versioning, and filter semantics are not presented as one consistent governed contract.
- **Remediation:** Define shared dataset, semantic field, filter, result, lineage, and report-definition contracts. Treat both studios as clients of the same services rather than independent products.

### Low

#### AHV2-ENG-001 — Lint debt and deprecated runtime convention

- **Controls:** A7, F8, E1
- **Evidence:** Lint completed with numerous warnings, including synchronous state updates in effects and unused code. Build warns that `middleware.ts` is deprecated in Next.js 16 in favor of `proxy`.
- **Remediation:** Set a zero-warning release gate, migrate middleware to proxy after authentication redesign, and fix cascading-effect patterns.

## 7. Read-Only Compliance Results

The SQL safety layer is the strongest audited control.

- `validateReadOnlySql` accepts only `SELECT` and read-only CTE entry points.
- It strips comments and quoted values before scanning.
- It rejects stacked statements, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, TRUNCATE, RENAME, permission changes, USE, EXEC/EXECUTE, external access functions, and SELECT INTO.
- `ReadOnlyDataClient` applies the guard immediately before database helper invocation.
- Query Gateway validation adds PII detection and metadata/performance warnings.
- 35 query-guard tests passed, including comment, string, stacked-statement, DDL, permission, execution, and external-access cases.
- Parser-only API probes rejected all 13 tested write-capable statements.

**Residual risk:** direct imports from `lib/services/db.ts` weaken the claim that every source query crosses the same guard. This is an architecture gap, not evidence that a mutation succeeded. No mutation path was executed during this audit.

## 8. API and Workflow Findings

### API posture

- 75 API route files and 121 exported HTTP handlers were observed.
- Six representative unauthenticated GET requests returned HTTP 200.
- API middleware protection is explicitly disabled.
- Request validation is inconsistent: some critical routes use Zod, while others parse untyped JSON.
- Pagination, filtering, status-code, retry, and null contracts vary by module.
- There is no demonstrated global rate-limit, CSRF strategy for custom mutation APIs, or default-deny authorization layer.

### Workflow posture

- Report Studio generation and SQL-editor request lifecycles have timeouts, cancellation, and stale-response protection.
- Saved Reports exposes load, download, interpret, pin, and actions for 29 canonical reports.
- Dataset Studio presents a coherent six-stage workflow, but publication durability and approval evidence remain incomplete.
- BI Studio provides substantial tooling but is separately modeled from Report Studio.
- Administration workflows are visually complete but cannot be accepted as operational controls until persistence, authorization, and external integrations are proven.

## 9. Accessibility and UX

Positive findings include semantic `main`, navigation labels, headings, labelled date controls, readable empty/disabled states, responsive document width, and clear primary module grouping. Material gaps include hidden mobile focus, generic overlays instead of dialogs, unnamed icon controls, uncertain chart alternatives, and no completed screen-reader or 200% zoom verification.

The navigation click depth is generally one or two actions, but single-route module state weakens deep links, breadcrumbs, refresh recovery, and browser history. Report Catalog cards expose many repeated controls and should support a compact table/list mode with pagination and consistent action menus.

## 10. Architecture Recommendation

Adopt five enforceable platform boundaries:

1. **Identity and authorization boundary:** Auth.js/Entra cookie session, central `requireSession`, resource-level `authorize`, default-deny APIs, and role matrix tests.
2. **Clinical source boundary:** database credentials with server-side read-only permissions plus mandatory `ReadOnlyDataClient`/Query Gateway imports enforced by lint and tests.
3. **Application metadata boundary:** durable database for reports, datasets, versions, approvals, schedules, pins, alerts, agent configuration, and append-only audit events; never write to the AcaciaHealth source database.
4. **Governed analytics contract:** one semantic dataset, filter, result, lineage, certification, and report-definition model consumed by Report Studio, SQL Workspace, BI Studio, KPI, and exports.
5. **Capability truth boundary:** server-issued live/demo/inspect-only status and provenance for every module, metric, control, and integration.

## 11. Prioritized Backlog

| Priority | Work item | Finding IDs | Exit criterion |
|---|---|---|---|
| P0 | Remove demo administrator authentication from production and unify sessions | SEC-002, ARCH-002 | No unverified identity can obtain a session; production fails closed |
| P0 | Require server-side auth and authorization on every sensitive API | SEC-001, SEC-005 | Anonymous requests receive 401; unauthorized roles receive 403 |
| P0 | Patch critical/high production dependencies | SEC-003 | Production audit has no critical or high fixable findings |
| P0 | Add security headers and CSRF/rate-limit posture | SEC-004, SEC-005 | Header tests and mutation-route security tests pass |
| P1 | Route all warehouse access through the read-only boundary | ARCH-001 | Restricted-import test reports no unauthorized DB imports |
| P1 | Replace simulated governance claims with durable evidence or explicit demo labels | GOV-001, GOV-002, FUNC-001 | Every control has provenance and server-backed evidence |
| P1 | Establish durable application metadata and append-only audit storage | GOV-002, ARCH-002 | Restart-safe records, attribution, retention, and recovery verified |
| P1 | Repair mobile drawer focus and dialog/icon semantics | UX-001, UX-002 | Keyboard, axe, screen-reader, and focus tests pass |
| P1 | Resolve Agent Registry status inconsistency | FUNC-002 | Summary and rows use one authoritative state |
| P2 | Unify Studio contracts and capability semantics | PARITY-001 | Cross-studio parity suite passes |
| P2 | Add pagination, virtualization, and payload budgets | PERF-001 | Budget tests and production traces meet targets |
| P2 | Establish production performance SLOs and warning-free release gate | PERF-002, ENG-001 | INP/CLS/LCP and lint gates pass in CI |

## 12. Release Recommendation

**Do not approve the audited revision for production handling of AcaciaHealth reporting data.** Continue development and internal demonstrations only, with unambiguous demo labeling and no externally reachable deployment, until all P0 items are remediated and independently re-tested. A new audit should then use production-equivalent Entra identities, protected API contract tests, patched dependencies, a production build, role-by-role authorization checks, and read-only source credentials.

## 13. Evidence References

- Framework: `docs/acaciahealth-platform-v2-enterprise-audit.md`
- SQL guard: `lib/services/queryGuard.ts`
- Read-only client: `lib/db/readOnlyClient.ts`
- Query Gateway: `lib/gateway/QueryGateway.ts`
- API bypass: `middleware.ts`
- Auth.js setup: `app/api/auth/[...nextauth]/route.ts`
- Demo authentication: `app/api/auth/validate/route.ts`
- Security headers: `next.config.mjs`
- Automated guard tests: `tests/queryGuard.test.ts`
- Browser evidence: `/tmp/agent-browser/audit-*.png` in the audit VM only
