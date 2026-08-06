"use client";

import { useState, useEffect, Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

// Top-level hubs are imported with the main route so local navigation never
// blocks on a separate on-demand client compilation after a tab click.
import { DataExplorer } from "@/components/data/DataExplorer";
import { DatasetStudioHub } from "@/components/dataset/DatasetStudioHub";
import { ReportStudio } from "@/components/studio/ReportStudio";
import { BiStudio } from "@/components/bi/BiStudio";
import { KpiIntelligenceHub } from "@/components/kpi/KpiIntelligenceHub";
import { SchemaHub } from "@/components/schema/SchemaHub";
import { AdministrationHub } from "@/components/admin/AdministrationHub";
import { IntelligenceCenter } from "@/components/intelligence/IntelligenceCenter";

function TabSkeleton() {
  return (
    <div className="flex w-full animate-pulse flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-72 rounded-lg bg-muted" />
      <div className="h-64 w-full rounded-xl bg-muted" />
      <div className="h-48 w-full rounded-xl bg-muted" />
    </div>
  );
}

import { LoginPage }    from "@/components/auth/LoginPage";
import type { AuthUser } from "@/components/auth/LoginPage";
import type { LoadedReport } from "@/components/studio/ReportStudio";
import type { CatalogNavigationAction } from "@/lib/discovery/navigation";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ThemeToggle } from "@/components/theme-toggle";
import { Menu, Bell, Calendar, LogOut, ShieldOff } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

// ── View type — maps directly to sidebar sub-item IDs ────────────────────────
//
// Primary views (7):  home, discover, dataset-studio, reports, kpi, schema, administration
// Sub-views depth-2:  prefixed with their primary (e.g. "reports-saved", "kpi-admin")
// Legacy aliases:     kept so any existing deep-links still resolve

type View =
  // Primary
  | "home"
  | "discover"
  | "discover-semantic"
  | "dataset-studio"
  | "dataset-studio-validate"
  | "dataset-studio-publish"
  | "dataset-studio-history"
  | "reports"
  | "reports-saved"
  | "reports-bi"
  | "kpi"
  | "kpi-interpreter"
  | "kpi-registry"
  | "kpi-governance"
  | "kpi-admin"
  | "intelligence"
  | "schema"
  | "schema-metadata"
  | "schema-registry"
  | "schema-lineage"
  | "schema-glossary"
  | "administration"
  | "admin-audit"
  | "admin-security"
  | "admin-sessions"
  | "admin-agents"
  | "admin-pipeline"
  | "admin-query-history"
  | "admin-settings"
  // Legacy aliases — redirect to unified views
  | "dashboard"
  | "studio"
  | "data"
  | "kpiadmin"
  | "bi"
  | "saved"
  | "audit"
  | "sessions"
  | "admin"
  | "agents"
  | "pipeline"
  | "settings"
  | "designer"
  | "contracts"
  | "metadata"
  | "registry";

// ── Title map — governs the topbar header ─────────────────────────────────────

const VIEW_TITLES: Partial<Record<View, { title: string; subtitle: string }>> = {
  home:                      { title: "Home",                  subtitle: "AcaciaHealth Dynamic Reporting Platform — overview" },
  // Discover Data
  discover:                  { title: "Discover Data",         subtitle: "Global search — tables, columns, relationships, glossary, lineage, and semantic search" },
  "discover-semantic":       { title: "Discover Data",         subtitle: "Semantic search — find data by meaning, not just name" },
  // Dataset Studio
  "dataset-studio":          { title: "Dataset Studio",        subtitle: "Build — Validate — Publish — one governed workflow" },
  "dataset-studio-validate": { title: "Dataset Studio",        subtitle: "Validate dataset — schema checks, relationship integrity, Power BI compatibility" },
  "dataset-studio-publish":  { title: "Dataset Studio",        subtitle: "Publish dataset — version, register in Schema Hub, expose to reports" },
  "dataset-studio-history":  { title: "Dataset Studio",        subtitle: "Version history — inspect all published versions and lineage" },
  // Reports
  reports:                   { title: "Reports",               subtitle: "Report Studio — natural language, SQL editor, and query gateway" },
  "reports-saved":           { title: "Reports",               subtitle: "Report Catalog — single catalog of all governed reports" },
  "reports-bi":              { title: "Reports",               subtitle: "BI Studio — drag-and-drop KPI canvas and AI copilot" },
  // KPI Intelligence
  kpi:                       { title: "KPI Intelligence",      subtitle: "KPI Interpreter — select a saved report and get AI-powered business interpretation" },
  "kpi-interpreter":         { title: "KPI Intelligence",      subtitle: "KPI Interpreter — AI-powered business interpretation of saved reports" },
  "kpi-registry":            { title: "KPI Intelligence",      subtitle: "KPI Registry — single source of truth for all KPI definitions and formulas" },
  "kpi-governance":          { title: "KPI Intelligence",      subtitle: "KPI Governance — version, approve, and publish KPI definitions" },
  "kpi-admin":               { title: "KPI Intelligence",      subtitle: "KPI Governance — version, approve, and publish KPI definitions" },
  intelligence:               { title: "Intelligence Center",   subtitle: "Correlated alerts, KPI detection, activity, and operational health" },
  // Schema Hub
  schema:                    { title: "Schema Hub",            subtitle: "Schema Explorer — single metadata authority for the platform" },
  "schema-metadata":         { title: "Schema Hub",            subtitle: "Metadata Engine — AI schema inference, column roles, and join path grounding" },
  "schema-registry":         { title: "Schema Hub",            subtitle: "Schema Registry — full metadata catalog, lineage, tags, and KPI dependencies" },
  "schema-lineage":          { title: "Schema Hub",            subtitle: "Lineage Explorer — end-to-end data lineage from source to report" },
  "schema-glossary":         { title: "Schema Hub",            subtitle: "Business Glossary — canonical business definitions and term ownership" },
  // Administration
  administration:            { title: "Administration",        subtitle: "Audit, security, sessions, agents, pipelines, and settings" },
  "admin-audit":             { title: "Administration",        subtitle: "Audit & Monitoring — immutable event log, HIPAA §164.312" },
  "admin-security":          { title: "Administration",        subtitle: "Security Console — RBAC, conditional access, IP allowlists, PAM" },
  "admin-sessions":          { title: "Administration",        subtitle: "Session Manager — active sessions, device compliance, revocation" },
  "admin-agents":            { title: "Administration",        subtitle: "Agent Registry — registered agents, versioning, and capabilities" },
  "admin-pipeline":          { title: "Administration",        subtitle: "Pipeline Builder — dynamic multi-agent pipeline construction" },
  "admin-query-history":     { title: "Administration",        subtitle: "Retry Intelligence — query history, failure analysis, and learned term mappings" },
  "admin-settings":          { title: "Administration",        subtitle: "Settings — environment, connections, and configuration" },
};

// Resolve a raw view string (including legacy aliases) → canonical View
function canonicalize(raw: string): View {
  switch (raw) {
    case "dashboard": return "home";
    case "studio":    return "reports";
    case "data":      return "discover";
    case "kpiadmin":  return "kpi-governance";
    case "bi":        return "reports-bi";
    case "saved":     return "reports-saved";
    case "audit":     return "admin-audit";
    case "sessions":  return "admin-sessions";
    case "admin":     return "admin-security";
    case "agents":    return "admin-agents";
    case "pipeline":  return "admin-pipeline";
    case "settings":  return "admin-settings";
    case "designer":  return "dataset-studio";
    case "contracts": return "dataset-studio";
    case "metadata":  return "schema-metadata";
    case "registry":  return "schema-registry";
    default:          return raw as View;
  }
}

function getTitle(view: View): { title: string; subtitle: string } {
  return VIEW_TITLES[view] ?? VIEW_TITLES["home"]!;
}

// ── Primary view resolver — maps canonical View → which hub to render ─────────

function getPrimaryView(view: View): string {
  if (view === "home" || view === "dashboard")                                   return "home";
  if (view.startsWith("discover") || view === "data")                           return "discover";
  if (view.startsWith("dataset"))                                                return "dataset-studio";
  if (view.startsWith("reports") || view === "studio" || view === "bi")         return "reports";
  if (view.startsWith("kpi"))                                                    return "kpi";
  if (view === "intelligence")                                                   return "intelligence";
  if (view.startsWith("schema") || view === "metadata" || view === "registry")  return "schema";
  if (view.startsWith("admin") || view === "audit" || view === "sessions" || view === "agents" || view === "pipeline" || view === "settings") return "administration";
  return "home";
}

const SESSION_KEY = "acacia_auth_user";
const AZURE_AUTH_ENABLED = process.env.NEXT_PUBLIC_AZURE_AUTH_ENABLED === "true";

type AzureSessionBridgeProps = {
  authUser: AuthUser | null | false;
  setAuthUser: (user: AuthUser) => void;
  onSessionState: (authenticated: boolean) => void;
};

function AzureSessionBridge({ authUser, setAuthUser, onSessionState }: AzureSessionBridgeProps) {
  const { data: session, status } = useSession();
  useEffect(() => {
    onSessionState(status === "authenticated");
    if (status !== "authenticated" || !session?.user || authUser !== false) return;
    const user: AuthUser = {
      id: (session.user as { id?: string }).id ?? session.user.email ?? "azure-ad",
      name: session.user.name ?? session.user.email ?? "User",
      email: session.user.email ?? "",
      role: ((session as { roles?: string[] }).roles ?? []).includes("Admin") ? "Admin" : "Analyst",
      department: "Azure AD",
      mfa_method: "azure_ad",
      aal: "AAL2",
      device_compliant: true,
      last_login: new Date().toISOString(),
    };
    setAuthUser(user);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  }, [authUser, onSessionState, session, setAuthUser, status]);
  return null;
}

export default function Home() {
  const [view, setView]               = useState<View>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayLabel, setTodayLabel]   = useState<string>("");
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);
  const [catalogNavigationError, setCatalogNavigationError] = useState<string | null>(null);
  const [authUser, setAuthUser]       = useState<AuthUser | null | false>(null);
  const [azureAuthenticated, setAzureAuthenticated] = useState(false);
  // KPI pre-selection: set when user clicks "Interpret" on a saved report
  const [preselectedKpi, setPreselectedKpi] = useState<string | null>(null);
  // Report pre-selection: set when a dashboard pin is clicked — opens KPI Interpreter with that report
  const [preselectedReportName, setPreselectedReportName] = useState<string | null>(null);
  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    );
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      setAuthUser(stored ? (JSON.parse(stored) as AuthUser) : false);
    } catch {
      setAuthUser(false);
    }
  }, []);

  function navigate(raw: string) {
    // Special token: "kpi:interpret:<kpiName>" — jump to KPI Interpreter with KPI pre-selection
    if (raw.startsWith("kpi:interpret:")) {
      const kpiName = raw.slice("kpi:interpret:".length);
      setPreselectedKpi(kpiName || null);
      setPreselectedReportName(null);
      setView("kpi");
      setSidebarOpen(false);
      return;
    }
    // Special token: "kpi:report:<reportName>" — jump to KPI Interpreter with a specific report pre-selected
    if (raw.startsWith("kpi:report:")) {
      const reportName = raw.slice("kpi:report:".length);
      setPreselectedReportName(reportName || null);
      setPreselectedKpi(null);
      setView("kpi");
      setSidebarOpen(false);
      return;
    }
    setView(canonicalize(raw));
    setSidebarOpen(false);
  }

  async function handleCatalogNavigate(
    action: Exclude<CatalogNavigationAction, { kind: "table" | "discover-context" }>
  ) {
    setCatalogNavigationError(null);
    if (action.kind === "navigate") {
      navigate(action.destination);
      return;
    }

    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(action.reportId)}`);
      const report = await response.json() as Partial<LoadedReport> & { error?: string };
      if (!response.ok || !report.sql || !report.name) {
        throw new Error(report.error ?? "Report could not be loaded");
      }
      setLoadedReport({
        sql: report.sql,
        prompt: report.prompt ?? report.name,
        kpi: report.kpi ?? "",
        name: report.name,
      });
      navigate("reports");
    } catch (error) {
      setCatalogNavigationError(error instanceof Error ? error.message : "Report could not be loaded");
    }
  }

  function handleAuthenticated(u: AuthUser) {
    setAuthUser(u);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    setView("home");
  }

  function handleSignOut() {
    setAuthUser(false);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    if (AZURE_AUTH_ENABLED && azureAuthenticated) { void signOut({ callbackUrl: "/login" }); return; }
    setView("home");
  }

  const azureBridge = AZURE_AUTH_ENABLED
    ? <AzureSessionBridge authUser={authUser} setAuthUser={setAuthUser} onSessionState={setAzureAuthenticated} />
    : null;

  // authUser === null means the sessionStorage read hasn't completed yet.
  if (authUser === null) return azureBridge;
  if (authUser === false && !azureAuthenticated) {
    return <>{azureBridge}<LoginPage onAuthenticated={handleAuthenticated} /></>;
  }

  const user          = authUser as AuthUser;
  const { title, subtitle } = getTitle(view);
  const primary       = getPrimaryView(view);

  // Sub-tab to pass into hub components.
  // Strip the primary prefix segment to get the sub-tab key.
  // e.g. "admin-audit"            → "audit"
  //      "dataset-studio-validate"→ "validate"
  //      "reports-saved"          → "saved"
  //      "kpi-registry"           → "registry"
  //      "schema-metadata"        → "metadata"
  //      "reports" (no dash)      → undefined
  function deriveSubTab(v: string): string | undefined {
    if (v === "home" || v === "discover" || v === "reports" || v === "kpi" || v === "schema" || v === "administration" || v === "dataset-studio") return undefined;
    // Strip the longest matching primary prefix
    const prefixes: [string, string][] = [
      ["dataset-studio-", "dataset-studio-"],
      ["admin-",          "admin-"],
      ["reports-",        "reports-"],
      ["kpi-",            "kpi-"],
      ["schema-",         "schema-"],
      ["discover-",       "discover-"],
    ];
    for (const [prefix, strip] of prefixes) {
      if (v.startsWith(prefix)) return v.slice(strip.length);
    }
    return undefined;
  }
  const subTab = deriveSubTab(view);

  // Resolve KPI sub-tab string → KpiIntelligenceHub tab ID
  function resolveKpiTab(raw: string | undefined): "interpreter" | "registry" | "governance" | undefined {
    if (!raw) return undefined;
    if (raw === "admin") return "governance";         // legacy alias
    if (raw === "governance") return "governance";
    if (raw === "interpreter") return "interpreter";
    if (raw === "intelligence") return "registry";   // retired duplicate tab
    if (raw === "registry") return "registry";
    return undefined;
  }
  const kpiTab = resolveKpiTab(subTab);

  return (
    <>
    {azureBridge}
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed md:relative z-30 h-full transition-transform duration-200 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          activeView={view}
          userRole={user.role}
          onNavigate={navigate}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md hover:bg-muted transition-colors"
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5 text-foreground" />
            </button>
            <div>
              <h1 className="text-sm font-semibold text-foreground">{title}</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {todayLabel}
            </div>
            <ThemeToggle />
            <button
              className="p-1.5 rounded-md hover:bg-muted transition-colors relative"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
            </button>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-medium text-foreground leading-none">{user.name}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{user.role} · {user.aal}</span>
              </div>
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                {user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page content — wrapped in ErrorBoundary (R-19) so tab crashes don't unmount the shell */}
        <main className="flex-1 overflow-y-auto px-5 md:px-6 py-6">
        {catalogNavigationError && (
          <div role="alert" className="mx-auto mb-4 max-w-7xl rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {catalogNavigationError}
          </div>
        )}
        <ErrorBoundary label="the dashboard">

          {/* 1. Home */}
          {primary === "home" && (
            <Suspense fallback={<TabSkeleton />}>
              <DashboardHome
                onNavigate={navigate}
                onOpenReport={(report) => {
                  setLoadedReport({ sql: report.sql, prompt: report.prompt, kpi: report.kpi, name: report.name });
                  navigate("reports");
                }}
              />
            </Suspense>
          )}

          {/* 2. Discover Data */}
          {primary === "discover" && (
            <div className="max-w-7xl mx-auto w-full">
              <Suspense fallback={<TabSkeleton />}>
                <DataExplorer
                  initialSemanticSearch={view === "discover-semantic"}
                  onOpenBuilder={() => navigate("dataset-studio")}
                  onCatalogNavigate={(action) => { void handleCatalogNavigate(action); }}
                />
              </Suspense>
            </div>
          )}

          {/* 3. Dataset Studio — unified: Designer + DataContract + BI dataset */}
          {primary === "dataset-studio" && (
            <div className="max-w-7xl mx-auto w-full">
              <Suspense fallback={<TabSkeleton />}>
                <DatasetStudioHub
                  initialTab={subTab as "build" | "validate" | "publish" | "history" | undefined}
                  onNavigate={navigate}
                />
              </Suspense>
            </div>
          )}

          {/* 4. Reports — unified: ReportStudio (with internal Saved tab) + BI Studio */}
          {primary === "reports" && (
            <div className="max-w-7xl mx-auto w-full">
              <Suspense fallback={<TabSkeleton />}>
                {subTab === "bi" ? (
                  <BiStudio />
                ) : (
                  <ReportStudio
                    initialReport={loadedReport}
                    initialTab={subTab === "saved" ? "saved" : undefined}
                    onNavigate={navigate}
                  />
                )}
              </Suspense>
            </div>
          )}

          {/* 5. KPI Intelligence — Interpreter entry plus Registry and Governance */}
          {primary === "kpi" && (
            <div className="max-w-7xl mx-auto w-full">
              <Suspense fallback={<TabSkeleton />}>
                <KpiIntelligenceHub
                  initialTab={kpiTab}
                  preselectedKpi={preselectedKpi}
                  preselectedReportName={preselectedReportName}
                  userRole={user.role as "Admin" | "Analyst" | "Viewer"}
                  onNavigate={navigate}
                  onClearPreselected={() => {
                    setPreselectedKpi(null);
                    setPreselectedReportName(null);
                  }}
                />
              </Suspense>
            </div>
          )}

  {/* Intelligence Center — alerts, KPI detection, activity, and monitoring */}
  {primary === "intelligence" && (
  <div className="mx-auto w-full max-w-[1500px]">
  <Suspense fallback={<TabSkeleton />}>
  <IntelligenceCenter />
  </Suspense>
  </div>
  )}

  {/* 6. Schema Hub — sole metadata authority */}
  {primary === "schema" && (
            <Suspense fallback={<TabSkeleton />}>
              <SchemaHub
                onNavigate={navigate}
                initialTab={
                  subTab === "metadata" ? "metadata" :
                  subTab === "registry" ? "registry" :
                  "explorer"
                }
              />
            </Suspense>
          )}

          {/* 7. Administration — unified: Security + Sessions + Audit + Agents + Pipeline + Settings */}
          {primary === "administration" && (
            <div className="max-w-6xl mx-auto w-full">
              <Suspense fallback={<TabSkeleton />}>
                <AdministrationHub
                  initialTab={subTab as "audit" | "security" | "sessions" | "agents" | "pipeline" | "settings" | undefined}
                  currentUser={user}
                  onNavigate={navigate}
                />
              </Suspense>
            </div>
          )}

        </ErrorBoundary>
        </main>
      </div>
    </div>
    </>
  );
}

// ── Access denied fallback ────────────────────────────────────────────────────

function _AccessDenied({ requiredRole, currentRole, onBack }: { requiredRole: string; currentRole: string; onBack: () => void }) {
  return (
    <div className="bg-card border border-border rounded-xl p-10 flex flex-col items-center gap-4 text-center max-w-md mx-auto mt-10">
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center">
        <ShieldOff className="w-7 h-7 text-destructive" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">Access Denied</h2>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-xs">
          This area requires the <span className="text-foreground font-medium">{requiredRole}</span> role.
          You are signed in as <span className="text-foreground font-medium">{currentRole}</span>.
        </p>
      </div>
      <div className="text-[11px] text-muted-foreground bg-muted border border-border rounded-lg px-4 py-3 w-full">
        This access attempt has been logged to the immutable audit trail.
      </div>
      <button
        onClick={onBack}
        className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Return to Home
      </button>
    </div>
  );
}
