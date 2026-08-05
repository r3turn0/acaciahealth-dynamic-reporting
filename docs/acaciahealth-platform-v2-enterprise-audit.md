# AcaciaHealth Data Reporting Platform v2 — Internal Enterprise Audit Framework

> **Classification:** Internal engineering and executive assurance artifact. This file is not rendered or linked by the application UI.
>
> **Audit posture:** Strictly read-only. No source, schema, application-data, configuration, governance, or workflow mutation is permitted during an audit.
>
> **Framework status:** Ready for execution. Scores remain `Not Assessed` until supported by recorded evidence.

## 1. Purpose

This document is the repeatable master prompt, scoring model, evidence standard, and report template for auditing AcaciaHealth Data Reporting Platform v2. It is tailored to the current Next.js 16 application shell, its eight primary navigation areas, Report Studio and BI Studio, Query Gateway, read-only SQL Server access, app metadata services, AI-assisted reporting, governance surfaces, and administration tooling.

The framework is designed for autonomous QA, architecture, governance, security, accessibility, and performance agents. It must never be interpreted as authorization to alter any database, application record, configuration, report, dataset, KPI, role, session, pipeline, or governance state.

---

## 2. Autonomous Audit Master Prompt

```yaml
agent:
  name: AcaciaHealthEnterpriseAuditEngineer
  version: 2.0
  correlationId: acaciahealth-platform-v2-readonly-audit
  operatingMode: EVIDENCE_DRIVEN_READ_ONLY

mission: >
  Perform a comprehensive, reproducible enterprise audit of AcaciaHealth Data
  Reporting Platform v2. Assess every visible and statically discoverable
  capability across UX, architecture, APIs, read-only workflows, reporting,
  semantic modeling, AI-assisted intelligence, governance, administration,
  security, accessibility, reliability, and performance. Produce evidence-backed
  findings and an executive scorecard without changing any persisted state.

platformContext:
  application: AcaciaHealth Data Reporting Platform v2
  localUrl: http://localhost:3000
  framework: Next.js 16 App Router with React 19
  applicationShape: single-page application shell with view-based navigation
  primaryNavigation:
    - Home
    - Discover Data
    - Dataset Studio
    - Reports
    - KPI Intelligence
    - Intelligence Center
    - Schema Hub
    - Administration
  keySurfaces:
    reports:
      - Report Studio / Ask AI and SQL
      - Semantic Engine
      - Visual Builder
      - Report Catalog / Saved Reports
      - BI Studio
    dataAndSemantics:
      - Table Explorer
      - Semantic Search
      - Dataset Build, Validate, Publish, and Version History
      - Schema Explorer
      - Metadata Engine
      - Schema Registry
      - Lineage Explorer
      - Business Glossary
    intelligence:
      - KPI Interpreter
      - KPI Registry
      - KPI Governance
      - Intelligence Center
    administration:
      - Audit and Monitoring
      - Security Console
      - Session Manager
      - Agent Registry
      - Pipeline Builder
      - Retry Intelligence
      - Settings
  dataArchitecture:
    analyticalSource: read-only Microsoft SQL Server
    applicationMetadata: PostgreSQL-backed and in-process services where configured
    queryControlPlane: QueryGateway
    ai: Vercel AI SDK and AI Gateway
    clientData: SWR and application state stores

absoluteReadOnlyBoundary:
  scope:
    - analytical source databases
    - application metadata databases
    - schemas, tables, views, indexes, procedures, and functions
    - reports, datasets, KPIs, glossary terms, tags, roles, sessions, pipelines, pins, and settings
    - external services and integrations
  prohibitedActions:
    - submit or execute INSERT, UPDATE, DELETE, MERGE, UPSERT, TRUNCATE, DROP, ALTER, CREATE, GRANT, REVOKE, EXEC, or write-capable procedure statements
    - invoke API methods or actions that create, edit, publish, deploy, approve, reject, archive, delete, save, share, schedule, pin, revoke, seed, synchronize, or otherwise persist state
    - inject test records or synthetic production data
    - modify environment variables, feature flags, credentials, permissions, RBAC, sessions, governance controls, or source configuration
    - bypass Query Gateway, authentication, authorization, validation, rate limits, or governance controls
    - run database migrations, setup scripts, seed scripts, or destructive test fixtures
    - expose, copy, persist, screenshot, or quote PHI, PII, credentials, tokens, connection strings, or raw patient-level query results in audit artifacts
  importantInterpretation: >
    A negative mutation test is not permission to submit a mutation statement.
    Validate write protections through static inspection, existing automated tests,
    mocks, and guard-unit tests only. UI write workflows may be inspected up to,
    but never through, their final state-changing action.

permittedMethods:
  - static source and configuration inspection
  - route, component, dependency, and contract inventory
  - UI inspection and keyboard-only navigation
  - read-only browser automation
  - GET requests that do not trigger seeding or side effects
  - POST requests proven by source inspection to perform generation, validation, planning, or SELECT-only execution without persistence
  - safe, bounded SELECT queries through the governed Query Gateway
  - mocked or isolated unit tests that cannot reach a live database
  - build, type-check, lint, and existing non-mutating test execution
  - accessibility snapshots and WCAG checks
  - network timing, Web Vitals, payload, render, and cache inspection
  - authentication and authorization posture inspection without bypass attempts
  - response-header and cookie-attribute inspection

safetyGateBeforeEveryAction:
  questions:
    - Can this action persist or alter any state?
    - Can this endpoint seed, synchronize, publish, save, revoke, deploy, or delete?
    - Can this query or indirect procedure mutate data or schema?
    - Could the output disclose PHI, PII, secrets, or patient-level details?
    - Is the action explicitly proven read-only from source or contract evidence?
  rule: >
    If any answer is yes, unknown, or cannot be proven safe, do not execute the
    action. Record it as Inspect Only, gather static evidence, and continue.

protectedDataHandling:
  - Use aggregate, metadata-only, or synthetic fixture evidence whenever possible.
  - Do not include patient names, identifiers, visit notes, addresses, dates of birth, or other PHI in findings.
  - Redact secrets and sensitive values; record only variable names and control behavior.
  - Do not store full request or response bodies when they may contain sensitive data.
  - Use counts, hashes, schemas, timings, and redacted excerpts as evidence.

executionStrategy:
  phase01_baselineAndSafety:
    objectives:
      - record commit, branch, environment, viewport, date, auditor, and correlation ID
      - verify the audit is running against the intended environment
      - inventory configured services without reading secret values
      - identify all state-changing routes and mark them Inspect Only
      - verify the read-only SQL guard and Query Gateway path statically
    exitCriteria:
      - safety matrix completed
      - no mutation-capable action remains unclassified

  phase02_discovery:
    objectives:
      - inventory App Router pages and API route handlers
      - inventory application-shell views, tabs, dialogs, drawers, menus, and wizards
      - map primary and secondary navigation and legacy aliases
      - identify source-discoverable surfaces not reachable from navigation
    deliverables:
      - route and API inventory
      - feature inventory
      - navigation and click-depth map
      - hidden, orphaned, duplicate, and legacy surface list

  phase03_navigationAndUX:
    inspect:
      - every safe page, view, tab, modal, dialog, drawer, settings panel, empty state, error state, and loading state
      - desktop and mobile layouts
      - breadcrumbs, page titles, active navigation, back behavior, and deep-link behavior
    identify:
      - dead or misleading controls
      - unreachable views
      - placeholders presented as production features
      - duplicated or fragmented workflows
      - ambiguous Demo versus Live status
      - hangs, stale loading states, silent failures, and poor recovery
    metrics:
      - click depth, target maximum 3
      - route and title consistency
      - task completion clarity
      - error-actionability rate

  phase04_featureClassification:
    statuses:
      - Verified Functional
      - Functional With Limitation
      - Inspect Only
      - Disabled
      - Hidden or Orphaned
      - Mocked or Demo
      - Placeholder
      - Nonfunctional
      - Not Assessed
    captureForEachFeature:
      - module and owner surface
      - status and evidence
      - dependencies and data source
      - governance, lineage, security, and observability integration
      - whether behavior is live, fallback, demo, cached, or persisted

  phase05_readOnlyCompliance:
    validateStatically:
      - all analytical execution enters a guarded read-only client or equivalent control
      - Query Gateway validation rejects non-SELECT and multi-statement escape paths
      - direct database call sites are inventoried and justified
      - dynamic identifiers are allowlisted and values parameterized
      - stored procedure and indirect execution are prohibited
      - SQL comments, casing, CTEs, semicolons, and obfuscation cannot bypass guards
      - connection credentials are least-privileged where verifiable without secret disclosure
    validateWithIsolatedTestsOnly:
      - mutation keywords are rejected before any database call
      - malformed and stacked statements are rejected
      - request cancellation and deadlines settle safely
    criticalRule: Any verified mutation path is CRITICAL and invokes score caps.

  phase06_apiAndContractAudit:
    inventory:
      - method, path, authentication, authorization, input schema, response schema
      - side effects, persistence, data source, timeout, retry, cache, and rate limit behavior
    validate:
      - Zod or equivalent boundary validation
      - status-code and error-envelope consistency
      - null, pagination, sorting, filtering, and serialization behavior
      - authentication and role enforcement
      - request cancellation, deadlines, retry safety, and idempotency where applicable
      - duplicate requests, over-fetching, N+1 behavior, and frontend/backend drift
    executionRestriction: State-changing endpoints are inspected statically and never invoked.

  phase07_readOnlyWorkflows:
    reports:
      safeToExercise:
        - natural-language plan generation
        - SQL validation
        - bounded SELECT execution
        - open and run existing reports when execution is read-only
        - non-persisting preview and export generation where proven safe
      inspectOnly:
        - save, edit, duplicate, share, schedule, certify, approve, publish, archive, and delete
    dashboards:
      safeToExercise: [view, filter, inspect existing pins]
      inspectOnly: [pin, unpin, share, schedule, subscribe]
    datasets:
      safeToExercise: [view existing metadata, preview with bounded SELECT]
      inspectOnly: [build persistence, validate-and-save, publish, version, certify]
    intelligence:
      safeToExercise: [read existing KPI definitions, generate non-persisting explanations]
      inspectOnly: [create, edit, approve, publish, deploy, rollback]
    governance:
      safeToExercise: [glossary lookup, lineage traversal, ownership inspection]
      inspectOnly: [tag, certify, approve, assign steward, alter ownership]

  phase08_moduleAudit:
    modules:
      - Home
      - Discover Data / Table Explorer / Semantic Search
      - Dataset Studio / Build / Validate / Publish / Version History
      - Reports / Report Studio / Report Catalog / BI Studio
      - KPI Intelligence / Interpreter / Registry / Governance
      - Intelligence Center
      - Schema Hub / Explorer / Metadata / Registry / Lineage / Glossary
      - Administration / Audit / Security / Sessions / Agents / Pipelines / Retry Intelligence / Settings
      - Query Gateway and read-only data access layer
    evaluateForEach:
      - functionality and truthful status
      - UX and task clarity
      - API and contract quality
      - governance and lineage integration
      - authentication, authorization, and sensitive-data handling
      - accessibility and responsive behavior
      - reliability, performance, observability, and test coverage

  phase09_featureParity:
    compare:
      reportStudio_vs_biStudio:
        - dataset selection and preview
        - semantic metadata and field browsing
        - filters, grouping, sorting, joins, calculations, and aggregation
        - time intelligence and visualization
        - non-persisting export, plus inspect-only share and schedule
        - governance, lineage, AI assistance, and version visibility
      reportStudio_vs_sqlEditor:
        - analytical capability, validation, errors, timeouts, result fidelity
        - catalog, export, lineage, governance, and explainability
      datasetStudio_vs_sqlEditor:
        - semantic, preview, security, governance, and result alignment
    output:
      - parity matrix
      - duplication and fragmentation findings
      - unified architecture recommendations

  phase10_governanceLineageAndQuality:
    validate:
      - source and metric ownership
      - Schema Hub as metadata authority
      - glossary definitions and stewardship
      - dataset, report, and KPI certification visibility
      - approval and version evidence
      - dataset, column, KPI, and report lineage
      - impact analysis and dependency accuracy
      - freshness, quality scorecards, and data-contract visibility
      - immutable and truthful auditability

  phase11_securityAndPrivacy:
    validate:
      - authentication coverage for UI and APIs
      - RBAC and least privilege at server boundaries
      - session handling, expiration, revocation design, and cookie attributes
      - CSRF posture for state-changing handlers
      - CSP and baseline security response headers
      - XSS and output-encoding posture
      - SQL injection resistance and parameterization
      - rate limiting and abuse controls
      - secret and sensitive-data exposure
      - PHI minimization in logs, AI prompts, exports, caches, and errors
      - audit trail integrity
    restriction: Do not exploit, bypass, exfiltrate, or perform destructive penetration testing.

  phase12_accessibility:
    standard: WCAG 2.1 AA
    validate:
      - semantic landmarks and heading structure
      - accessible names, descriptions, and status announcements
      - keyboard navigation and visible focus
      - modal focus trap and focus restoration
      - contrast and non-color communication
      - zoom, reflow, responsive layouts, and touch targets
      - tables, charts, loading states, errors, and form validation
      - screen-reader interpretation of AI, SQL, governance, and result states

  phase13_performanceReliabilityAndObservability:
    measure:
      - TTFB, FCP, LCP, CLS, and INP where interaction is available
      - route/view transition time
      - report-plan generation and SELECT execution duration
      - result rendering and large-table behavior
      - payload size, request count, cache hit evidence, and duplicate fetches
    validate:
      - explicit deadlines and cancellation
      - stale-response protection
      - actionable errors and retry behavior
      - connection-pool and dependency failure handling
      - fallback and Demo behavior is clearly disclosed
      - logs, metrics, traces, correlation IDs, and audit events are coherent

  phase14_engineeringQuality:
    validate:
      - type-check, lint, build, and non-mutating tests
      - architectural boundaries and duplicate implementations
      - server/client separation and safe data fetching
      - dependency currency and known-risk posture
      - test coverage for guards, APIs, workflows, and regressions
      - configuration consistency across local and Vercel environments

  phase15_gapAnalysisAndRecommendations:
    explicitlyAssess:
      governance: [certification, approvals, stewardship, versioning]
      lineage: [dataset, column, KPI, report, impact analysis]
      security: [row-level security, column-level security, API authorization]
      semantic: [model ownership, glossary generation, semantic consistency]
      reporting: [version history, subscriptions, alerts, notifications]
      query: [library, repository, templates, history, replay, explain plan, cost estimation]
      quality: [freshness, contracts, validation, quality scorecards]
      observability: [usage, adoption, reliability, cost, model telemetry]
      deployment: [promotion, approvals, environment management, rollback]
      ai: [documentation, grounding, governance, evaluation, prompt/data privacy]
    output:
      - prioritized backlog
      - implementation priority matrix
      - near-, mid-, and long-horizon architecture recommendations without time estimates

findingRequirements:
  requiredFields:
    - id
    - title
    - severity
    - category
    - affectedModule
    - affectedAssets
    - description
    - evidence
    - evidenceType
    - reproducibility
    - rootCause
    - riskAndBusinessImpact
    - remediation
    - implementationApproach
    - acceptanceCriteria
    - scoreImpact
    - confidence
    - readOnlySafeToVerify
  evidenceRule: No finding may be stated as fact without reproducible evidence.
  uncertaintyRule: Mark inferred claims as Hypothesis and state what evidence is missing.

severityModel:
  CRITICAL:
    - verified mutation path or read-only bypass
    - unauthenticated sensitive-data access
    - governance or authorization bypass
    - exploitable PHI, secret, or credential exposure
  HIGH:
    - broken core reporting or governance workflow
    - material lineage or metric inaccuracy
    - server-side authorization absent on sensitive capability
    - recurring reliability failure with no safe recovery
  MEDIUM:
    - important UX, accessibility, contract, observability, or performance deficiency
    - partial workflow or inconsistent cross-module behavior
  LOW:
    - localized defect with limited operational impact
  ENHANCEMENT:
    - evidence-backed capability or architecture improvement

successCriteria:
  - every source-discoverable route and application-shell view classified
  - every visible feature safely inspected or explicitly marked Inspect Only
  - every API contract inventoried; only proven read-only APIs exercised
  - read-only controls validated without submitting mutation statements
  - parity and capability gaps supported by evidence
  - findings deduplicated and mapped to modules and scoring controls
  - no persisted state changed and no sensitive data included in artifacts
  - all scores reproducible from the control ledger

requiredDeliverables:
  - Executive Summary and scorecard
  - Safety attestation
  - Architecture findings
  - Platform capability map
  - Route, API, feature, and navigation inventory
  - Read-only compliance findings
  - Feature parity matrix
  - API and workflow findings
  - UX and accessibility findings
  - Performance, reliability, and observability findings
  - Security, privacy, governance, lineage, and data-quality findings
  - Missing capability analysis
  - Enterprise readiness assessment
  - Prioritized backlog and implementation priority matrix
  - Evidence appendix and unresolved questions
```

---

## 3. Internal Audit Scoring Framework

### 3.1 Domains and weights

| Domain | Weight | What is scored |
|---|---:|---|
| Architecture | 15% | Boundaries, consistency, maintainability, contracts, platform authority, testability |
| Functionality & Reliability | 20% | Core workflows, truthful behavior, error recovery, correctness, test coverage |
| Governance, Lineage & Data Quality | 15% | Ownership, certification, lineage, glossary, auditability, freshness and quality |
| Security, Privacy & Read-Only Compliance | 15% | Authentication, authorization, SQL safety, PHI handling, headers, sessions, secrets |
| Performance & Observability | 10% | Web Vitals, request/query latency, caching, payloads, telemetry, deadlines |
| Accessibility & UX | 10% | WCAG 2.1 AA, keyboard use, clarity, responsive behavior, discoverability |
| Feature Parity & Cohesion | 10% | Cross-studio consistency, capability coverage, duplication and fragmentation |
| Enterprise Readiness | 5% | Operations, deployment, resilience, ownership, supportability, documentation |
| **Total** | **100%** | |

### 3.2 Control rating scale

Every control receives one rating. Scores must not be based on impression alone.

| Rating | Label | Evidence threshold |
|---:|---|---|
| 5 | Optimized | Complete, consistently enforced, measured, tested, and operationally owned |
| 4 | Managed | Implemented and effective with minor, non-material gaps |
| 3 | Defined | Implemented in primary paths but incomplete, inconsistent, or weakly measured |
| 2 | Partial | Material portions exist, but important paths are missing or unreliable |
| 1 | Initial | Mostly ad hoc, mocked, UI-only, undocumented, or not server-enforced |
| 0 | Absent / Failed | Missing, nonfunctional, contradicted by evidence, or critically unsafe |
| NA | Not Applicable | Excluded with written rationale; its weight is redistributed within the domain |
| NE | Not Evaluated | Evidence unavailable; no numeric overall score may be called final |

### 3.3 Calculation

For each domain:

- `domainScore = sum(controlRating × controlWeight) / sum(5 × applicableControlWeight) × 100`
- `weightedDomainScore = domainScore × domainWeight / 100`
- `overallScore = sum(weightedDomainScore)`

All domain control weights default to equal weight unless the audit run declares different weights before testing. `NA` controls are excluded and redistributed. `NE` controls are not zero; they make the result provisional and reduce evidence coverage.

### 3.4 Evidence coverage and confidence

Report these independently from quality scores:

- `evidenceCoverage = evaluatedApplicableControls / applicableControls × 100`
- Confidence per control: `High`, `Medium`, or `Low`
- Overall confidence: weighted percentage of controls with High confidence

A score is **Final** only when evidence coverage is at least 90%, all critical controls are evaluated, and no unresolved safety question remains. Otherwise label it **Provisional**.

### 3.5 Maturity levels

| Overall score | Maturity |
|---:|---|
| 90–100 | Enterprise Ready |
| 80–89 | Production Ready |
| 70–79 | Functional With Gaps |
| 60–69 | Requires Remediation |
| Below 60 | High Risk |

### 3.6 Mandatory score caps

The arithmetic score is not allowed to conceal critical risk.

| Verified condition | Required cap |
|---|---:|
| Any source or application-data mutation path reachable through reporting/query surfaces | Overall ≤ 49; Security = 0 |
| Unauthenticated or unauthorized access to PHI/sensitive reporting data | Overall ≤ 49; Security = 0 |
| Critical governance or RBAC bypass | Overall ≤ 59 |
| Core report execution broadly nonfunctional | Overall ≤ 59; Functionality ≤ 30 |
| Audit evidence includes exposed secrets or PHI | Audit invalid; stop, contain, and redact |
| Evidence coverage below 70% | No maturity above “Functional With Gaps” |
| Any critical control is `NE` | Result must remain Provisional |

### 3.7 Domain control ledger

#### Architecture — 15%

- A1: Query Gateway is the authoritative analytical execution boundary.
- A2: Direct database paths are inventoried, guarded, and justified.
- A3: Schema Hub and semantic metadata have clear ownership and no conflicting authorities.
- A4: API and data contracts are explicit, validated, and version-compatible.
- A5: Duplicate report, query correction, registry, and workflow implementations are controlled.
- A6: Server/client boundaries, caching, state, and persistence patterns are coherent.
- A7: Architecture is testable, documented, and consistent across local and Vercel environments.

#### Functionality & Reliability — 20%

- F1: Discover Data and semantic search return truthful, actionable results.
- F2: Report Studio natural-language, validation, SQL, execution, and results flows settle reliably.
- F3: Saved Reports/Report Catalog opens and runs canonical reports correctly.
- F4: BI Studio core analytical flows are functional or accurately labeled.
- F5: Dataset and KPI workflows accurately disclose implemented versus inspect-only/demo behavior.
- F6: Loading, empty, timeout, dependency-failure, and retry states recover safely.
- F7: Result schemas, totals, filters, dates, sorting, exports, and multi-result behavior preserve fidelity.
- F8: Automated tests cover critical guards and regressions; build/type/lint status is healthy.

#### Governance, Lineage & Data Quality — 15%

- G1: Report, dataset, KPI, glossary, and source ownership is visible and authoritative.
- G2: Certification and approval states are truthful, traceable, and server-backed.
- G3: Dataset, column, KPI, and report lineage is complete and accurate.
- G4: Glossary and semantic definitions are consistent across platform modules.
- G5: Versions, approvals, changes, and audit events are immutable and attributable.
- G6: Freshness, contracts, validation, and quality status are visible and actionable.
- G7: Demo or fallback data cannot be mistaken for governed live data.

#### Security, Privacy & Read-Only Compliance — 15%

- S1: Analytical and metadata database access is technically read-only.
- S2: SQL guard blocks mutation, stacked statements, indirect execution, and obfuscation before DB access.
- S3: Every sensitive API enforces authentication and server-side authorization.
- S4: RBAC and least privilege are consistent across UI, APIs, and data access.
- S5: Inputs are validated and query values are parameterized; dynamic identifiers are allowlisted.
- S6: Sessions, cookies, CSRF posture, rate limits, and security headers are appropriate.
- S7: PHI/PII is minimized in prompts, logs, errors, exports, caches, and audit artifacts.
- S8: Secrets and environment configuration cannot leak to clients or logs.

#### Performance & Observability — 10%

- P1: Key views meet reasonable Web Vitals and interaction responsiveness thresholds.
- P2: Query and AI generation have bounded deadlines, cancellation, and stale-response protection.
- P3: Requests, payloads, rendering, and database round trips avoid material waste.
- P4: Cache behavior is correct, observable, invalidated safely, and never leaks scoped data.
- P5: Logs, metrics, traces, correlation IDs, query history, and audit events support diagnosis.
- P6: Dependency failures degrade truthfully and recover without hangs.

#### Accessibility & UX — 10%

- U1: Primary workflows are keyboard-operable with visible focus and logical order.
- U2: Landmarks, headings, labels, descriptions, and live statuses are screen-reader meaningful.
- U3: Dialogs and overlays trap and restore focus correctly.
- U4: Contrast, zoom, reflow, responsive layouts, and touch targets meet WCAG 2.1 AA intent.
- U5: Tables, charts, SQL, AI output, errors, and loading states have accessible alternatives.
- U6: Navigation, terminology, status, and click depth are coherent and discoverable.
- U7: Destructive or state-changing controls are clearly distinguished and permission-aware.

#### Feature Parity & Cohesion — 10%

- C1: Report Studio and BI Studio share governed datasets, semantics, and result definitions.
- C2: Report Studio and SQL Editor have coherent save/catalog/export/lineage/governance visibility.
- C3: Dataset Studio and SQL surfaces align on previews, security, semantics, and governance.
- C4: Filters, grouping, sorting, joins, calculations, aggregation, and time intelligence are consistent.
- C5: Share, schedule, version, certification, lineage, and AI assistance capabilities are not misleadingly fragmented.
- C6: Duplicate routes and legacy aliases have a documented consolidation path.

#### Enterprise Readiness — 5%

- E1: Production, local, and deployment configuration behavior is predictable and documented.
- E2: Operational ownership, support, runbooks, and incident evidence are defined.
- E3: Promotion, rollback, versioning, and environment controls are safe and auditable.
- E4: Capacity, availability, dependency, backup, and recovery assumptions are known.
- E5: AI quality, grounding, privacy, evaluation, model change, and cost risks are governed.

---

## 4. Finding and Backlog Rules

### 4.1 Finding record

```yaml
id: AHV2-<CATEGORY>-000
status: Open | Accepted | Remediated | Rejected
severity: CRITICAL | HIGH | MEDIUM | LOW | ENHANCEMENT
category: Architecture | Functionality | Governance | Security | Performance | Accessibility | Parity | Enterprise
controlIds: [S2]
affectedModule: Report Studio
affectedAssets: []
title: Concise evidence-based title
description: What was observed, without speculation
evidence:
  type: Static | Browser | API | Test | Metric | Configuration
  location: file:line, route, test, or screenshot reference
  observation: Redacted, reproducible evidence
reproduction: Safe read-only steps only
rootCause: Confirmed cause or explicitly labeled hypothesis
riskAndBusinessImpact: Clinical, operational, compliance, financial, or user impact
remediation: Desired end state
implementationApproach: Concrete technical approach
acceptanceCriteria: Verifiable completion conditions
scoreImpact:
  controls: [S2]
  proposedRating: 0
confidence: High | Medium | Low
readOnlySafeToVerify: true | false
```

### 4.2 Prioritization

Order backlog items by:

1. Read-only, PHI, authentication, authorization, and governance integrity.
2. Broken report correctness and core workflow reliability.
3. Auditability, lineage, and enterprise operational controls.
4. Accessibility and material UX/performance barriers.
5. Cohesion, maintainability, and enhancements.

Do not use an unqualified issue count as a quality measure. Deduplicate findings by root cause and map one systemic issue to all affected assets.

---

## 5. Audit Run Report Template

Copy this section for each audit run. Do not overwrite prior runs if historical comparison is required.

### Audit metadata

| Field | Value |
|---|---|
| Audit ID | `AHV2-AUDIT-YYYYMMDD-01` |
| Status | Not Assessed |
| Date | — |
| Auditor/agent | — |
| Commit and branch | — |
| Environment | — |
| Correlation ID | — |
| Viewports | Desktop 998×778 light; additional mobile viewport required |
| Database posture | Read-only |
| Safety incidents | None / describe and stop |

### Safety attestation

- [ ] No database or schema mutation was submitted or executed.
- [ ] No state-changing endpoint or final UI action was invoked.
- [ ] No source, app metadata, configuration, governance, role, session, or workflow state changed.
- [ ] No PHI, PII, credentials, tokens, or connection values were captured in artifacts.
- [ ] All uncertain actions were treated as Inspect Only.

### Executive scorecard

| Domain | Weight | Score | Weighted score | Evaluated controls | Confidence | Key blocker |
|---|---:|---:|---:|---:|---|---|
| Architecture | 15% | NE | — | 0/7 | — | Not assessed |
| Functionality & Reliability | 20% | NE | — | 0/8 | — | Not assessed |
| Governance, Lineage & Data Quality | 15% | NE | — | 0/7 | — | Not assessed |
| Security, Privacy & Read-Only Compliance | 15% | NE | — | 0/8 | — | Not assessed |
| Performance & Observability | 10% | NE | — | 0/6 | — | Not assessed |
| Accessibility & UX | 10% | NE | — | 0/7 | — | Not assessed |
| Feature Parity & Cohesion | 10% | NE | — | 0/6 | — | Not assessed |
| Enterprise Readiness | 5% | NE | — | 0/5 | — | Not assessed |
| **Overall** | **100%** | **NE** | **—** | **0/54** | **—** | **Provisional** |

### Executive conclusions

- **Overall maturity:** Not Assessed
- **Evidence coverage:** 0%
- **Enterprise readiness:** Not Assessed
- **Read-only assurance:** Not Assessed
- **Release recommendation:** No recommendation until evidence coverage and critical controls meet final-score requirements
- **Top risks:** —
- **Top strengths:** —
- **Priority decisions required:** —

### Findings summary

| Severity | Count | Finding IDs |
|---|---:|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 0 | — |
| Enhancement | 0 | — |

### Required report sections

1. Executive Summary
2. Safety Attestation
3. Architecture Findings
4. Platform Capability Map
5. Navigation and Click-Depth Audit
6. Feature Inventory and Truthfulness Classification
7. Read-Only Compliance Findings
8. Feature Parity Findings
9. API and Contract Findings
10. End-to-End Read-Only Workflow Findings
11. UX and Accessibility Findings
12. Performance, Reliability, and Observability Findings
13. Security and Privacy Findings
14. Governance, Lineage, and Data-Quality Findings
15. Missing Capability Analysis
16. Enterprise Readiness Assessment
17. Prioritized Backlog and Implementation Priority Matrix
18. Evidence Appendix and Unresolved Questions

---

## 6. Framework Governance

- Keep this file internal and outside application imports; do not expose it through UI routes or APIs.
- Update control definitions when platform architecture or regulatory requirements materially change.
- Never silently change weights during an audit run. Record framework version and any approved deviations.
- Re-score remediated controls only after evidence is captured; do not award credit for planned work.
- Keep prior evidence references stable and redact sensitive material before committing.
- The existing `AUDIT_REPORT.md` is historical evidence, not an automatically current score. Revalidate every inherited finding against the audited commit.
