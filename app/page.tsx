"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

// ── Consolidated module imports ───────────────────────────────────────────────
// Each hub merges previously-separate screens into one governed surface.

import { DataExplorer }       from "@/components/data/DataExplorer";
import { DatasetStudioHub }   from "@/components/dataset/DatasetStudioHub";
import { ReportStudio }       from "@/components/studio/ReportStudio";
import { SavedReports }       from "@/components/studio/SavedReports";
import { BiStudio }           from "@/components/bi/BiStudio";
import { KpiIntelligenceHub } from "@/components/kpi/KpiIntelligenceHub";
import { SchemaHub }          from "@/components/schema/SchemaHub";
import { AdministrationHub }  from "@/components/admin/AdministrationHub";

import { LoginPage }    from "@/components/auth/LoginPage";
import type { AuthUser } from "@/components/auth/LoginPage";
import type { LoadedReport } from "@/components/studio/ReportStudio";
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
  | "kpi-registry"
  | "kpi-admin"
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
  kpi:                       { title: "KPI Intelligence",      subtitle: "AI-powered KPI analysis — trends, variance, root cause, anomaly detection" },
  "kpi-registry":            { title: "KPI Intelligence",      subtitle: "KPI Registry — single source of truth for all KPI definitions and formulas" },
  "kpi-admin":               { title: "KPI Intelligence",      subtitle: "KPI Governance — version, approve, and publish KPI definitions" },
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
  "admin-settings":          { title: "Administration",        subtitle: "Settings — environment, connections, and configuration" },
};

// Resolve a raw view string (including legacy aliases) → canonical View
function canonicalize(raw: string): View {
  switch (raw) {
    case "dashboard": return "home";
    case "studio":    return "reports";
    case "data":      return "discover";
    case "kpiadmin":  return "kpi-admin";
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
  if (view.startsWith("schema") || view === "metadata" || view === "registry")  return "schema";
  if (view.startsWith("admin") || view === "audit" || view === "sessions" || view === "agents" || view === "pipeline" || view === "settings") return "administration";
  return "home";
}

const SESSION_KEY = "acacia_auth_user";

export default function Home() {
  const [view, setView]               = useState<View>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayLabel, setTodayLabel]   = useState<string>("");
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);
  const [authUser, setAuthUser]       = useState<AuthUser | null | false>(null);

  const { data: nextAuthSession, status: nextAuthStatus } = useSession();

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

  useEffect(() => {
    if (nextAuthStatus === "authenticated" && nextAuthSession?.user && authUser === false) {
      const u: AuthUser = {
        id:             (nextAuthSession.user as { id?: string }).id ?? nextAuthSession.user.email ?? "azure-ad",
        name:           nextAuthSession.user.name ?? nextAuthSession.user.email ?? "User",
        email:          nextAuthSession.user.email ?? "",
        role:           ((nextAuthSession as { roles?: string[] }).roles ?? []).includes("Admin") ? "Admin" : "Analyst",
        department:     "Azure AD",
        mfa_method:     "azure_ad",
        aal:            "AAL2",
        device_compliant: true,
        last_login:     new Date().toISOString(),
      };
      setAuthUser(u);
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    }
  }, [nextAuthStatus, nextAuthSession, authUser]);

  function navigate(raw: string) {
    setView(canonicalize(raw));
    setSidebarOpen(false);
  }

  function handleAuthenticated(u: AuthUser) {
    setAuthUser(u);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    setView("home");
  }

  function handleSignOut() {
    setAuthUser(false);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    if (nextAuthSession) { signOut({ callbackUrl: "/login" }); return; }
    setView("home");
  }

  if (authUser === null || nextAuthStatus === "loading") return null;
  if (authUser === false && nextAuthStatus !== "authenticated") {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
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

  return (
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-5 md:px-6 py-6">

          {/* 1. Home */}
          {primary === "home" && (
            <DashboardHome
              onNavigate={navigate}
              onOpenReport={(report) => {
                setLoadedReport({ sql: report.sql, prompt: report.prompt, kpi: report.kpi, name: report.name });
                navigate("reports");
              }}
            />
          )}

          {/* 2. Discover Data */}
          {primary === "discover" && (
            <div className="max-w-7xl mx-auto w-full">
              <DataExplorer onOpenBuilder={() => navigate("dataset-studio")} />
            </div>
          )}

          {/* 3. Dataset Studio — unified: Designer + DataContract + BI dataset */}
          {primary === "dataset-studio" && (
            <div className="max-w-7xl mx-auto w-full">
              <DatasetStudioHub
                initialTab={subTab as "build" | "validate" | "publish" | "history" | undefined}
                onNavigate={navigate}
              />
            </div>
          )}

          {/* 4. Reports — unified: ReportStudio + Saved + BI Studio */}
          {primary === "reports" && (
            <div className="max-w-7xl mx-auto w-full">
              {(subTab === "saved") ? (
                <div className="bg-card border border-border rounded-xl p-5">
                  <SavedReports
                    allowCreate
                    onLoad={(report) => {
                      setLoadedReport({ sql: report.sql, prompt: report.prompt, kpi: report.kpi, name: report.name });
                      navigate("reports");
                    }}
                  />
                </div>
              ) : subTab === "bi" ? (
                <BiStudio />
              ) : (
                <ReportStudio initialReport={loadedReport} />
              )}
            </div>
          )}

          {/* 5. KPI Intelligence — unified: KpiExplorer + KpiSchemaAdmin */}
          {primary === "kpi" && (
            <div className="max-w-7xl mx-auto w-full">
              <KpiIntelligenceHub
                initialTab={subTab as "intelligence" | "registry" | "admin" | undefined}
                userRole={user.role as "Admin" | "Analyst" | "Viewer"}
                onNavigate={navigate}
              />
            </div>
          )}

          {/* 6. Schema Hub — sole metadata authority */}
          {primary === "schema" && (
            <SchemaHub
              onNavigate={navigate}
              initialTab={
                subTab === "metadata" ? "metadata" :
                subTab === "registry" ? "registry" :
                "explorer"
              }
            />
          )}

          {/* 7. Administration — unified: Security + Sessions + Audit + Agents + Pipeline + Settings */}
          {primary === "administration" && (
            <div className="max-w-6xl mx-auto w-full">
              <AdministrationHub
                initialTab={subTab as "audit" | "security" | "sessions" | "agents" | "pipeline" | "settings" | undefined}
                currentUser={user}
                onNavigate={navigate}
              />
            </div>
          )}

        </main>
      </div>
    </div>
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
