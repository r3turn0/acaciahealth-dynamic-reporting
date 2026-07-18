"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { SchemaViewer } from "@/components/dashboard/SchemaViewer";
import { KpiExplorer } from "@/components/dashboard/KpiExplorer";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { ReportStudio } from "@/components/studio/ReportStudio";
import { SavedReports } from "@/components/studio/SavedReports";
import type { LoadedReport } from "@/components/studio/ReportStudio";
import { DataExplorer } from "@/components/data/DataExplorer";
import { MetadataReportEngine } from "@/components/schema/MetadataReportEngine";
import { BiStudio } from "@/components/bi/BiStudio";
import { DataContractWorkspace } from "@/components/access/DataContractWorkspace";

import { LoginPage } from "@/components/auth/LoginPage";
import type { AuthUser } from "@/components/auth/LoginPage";
import { SessionManager } from "@/components/security/SessionManager";
import { SecurityConsole } from "@/components/admin/SecurityConsole";
import { AuditDashboard } from "@/components/audit/AuditDashboard";
import { AgentRegistry } from "@/components/agents/AgentRegistry";
import { Menu, Bell, Calendar, LogOut, ShieldOff } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

type View = "dashboard" | "studio" | "data" | "kpi" | "schema" | "metadata" | "bi" | "contracts" | "saved" | "audit" | "settings" | "sessions" | "admin" | "agents";

const VIEW_TITLES: Record<View, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "AcaciaHealth Dynamic Reporting Engine — overview",
  },
  studio: {
    title: "Report Studio",
    subtitle: "Ask AI, edit SQL, run queries, view results, save reports",
  },
  data: {
    title: "Discover Data",
    subtitle: "Search, preview, and sample tables — then add them to your dataset",
  },
  kpi: {
    title: "KPI Explorer",
    subtitle: "Browse available KPI definitions and API specs",
  },
  schema: {
    title: "Schema Intelligence",
    subtitle: "Live database schema, join paths, and semantic layer",
  },
  metadata: {
    title: "Metadata Engine",
    subtitle: "AI schema-inference tool — inspect tables, columns, roles, and join paths for fast lookup and grounding",
  },
  bi: {
    title: "BI Studio",
    subtitle: "Build datasets, explore KPIs with drag-and-drop, import Excel, and generate reports with AI",
  },
  contracts: {
    title: "Build Dataset",
    subtitle: "Shape a reusable dataset — pick tables, columns, and relationships the access proxy will enforce",
  },

  saved: {
    title: "Saved Reports",
    subtitle: "Your saved report library — load, re-run, or delete",
  },
  audit: {
    title: "Audit & Monitoring",
    subtitle: "Immutable authentication, access, and policy event log — HIPAA §164.312 · Azure Sentinel",
  },
  sessions: {
    title: "Session Management",
    subtitle: "Active sessions, device compliance, revocation, and inactivity timeout",
  },
  admin: {
    title: "Security Console",
    subtitle: "RBAC/ABAC, Conditional Access, IP allowlists, PAM, and break-glass — privileged access required",
  },
  settings: {
    title: "Settings",
    subtitle: "Environment and connection configuration",
  },
  agents: {
    title: "Agent Registry",
    subtitle: "Registered agents — drag to reorder pipeline execution sequence, inspect status and capabilities",
  },
};

const SESSION_KEY = "acacia_auth_user";

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayLabel, setTodayLabel] = useState<string>("");
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);
  // null = not yet checked, false = unauthenticated, AuthUser = authenticated
  const [authUser, setAuthUser] = useState<AuthUser | null | false>(null);

  const { data: nextAuthSession, status: nextAuthStatus } = useSession();

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
    // Rehydrate demo session from sessionStorage
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      setAuthUser(stored ? (JSON.parse(stored) as AuthUser) : false);
    } catch {
      setAuthUser(false);
    }
  }, []);

  // If a real Azure AD session exists, synthesise an AuthUser from it
  useEffect(() => {
    if (nextAuthStatus === "authenticated" && nextAuthSession?.user && authUser === false) {
      const u: AuthUser = {
        id: (nextAuthSession.user as { id?: string }).id ?? nextAuthSession.user.email ?? "azure-ad",
        name: nextAuthSession.user.name ?? nextAuthSession.user.email ?? "User",
        email: nextAuthSession.user.email ?? "",
        role: ((nextAuthSession as { roles?: string[] }).roles ?? []).includes("Admin") ? "Admin" : "Analyst",
        department: "Azure AD",
        mfa_method: "azure_ad",
        aal: "AAL2",
        device_compliant: true,
        last_login: new Date().toISOString(),
      };
      setAuthUser(u);
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    }
  }, [nextAuthStatus, nextAuthSession, authUser]);

  function handleAuthenticated(u: AuthUser) {
    setAuthUser(u);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    setView("dashboard");
  }

  function handleSignOut() {
    setAuthUser(false);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    // Sign out of NextAuth session too if one exists
    if (nextAuthSession) {
      signOut({ callbackUrl: "/login" });
      return;
    }
    setView("dashboard");
  }

  // Null = hydrating; wait for both storage and NextAuth status to resolve
  if (authUser === null || nextAuthStatus === "loading") return null;

  // Not authenticated — show full-page login
  if (authUser === false && nextAuthStatus !== "authenticated") {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  // After this point authUser is always a real AuthUser (narrowed for TypeScript)
  const user = authUser as AuthUser;

  const { title, subtitle } = VIEW_TITLES[view];

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
          onNavigate={(id) => {
            setView(id as View);
            setSidebarOpen(false);
          }}
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
            {/* User avatar + sign out */}
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
          {view === "dashboard" && (
            <DashboardHome
              onNavigate={(id) => setView(id as View)}
              onOpenReport={(report) => {
                setLoadedReport({
                  sql: report.sql,
                  prompt: report.prompt,
                  kpi: report.kpi,
                  name: report.name,
                });
                setView("studio");
              }}
            />
          )}
          {view === "studio" && (
            <div className="max-w-6xl mx-auto w-full">
              <ReportStudio initialReport={loadedReport} />
            </div>
          )}
          {view === "data" && (
            <div className="max-w-7xl mx-auto w-full">
              <DataExplorer onOpenBuilder={() => setView("contracts")} />
            </div>
          )}
          {view === "saved" && (
            <div className="max-w-5xl mx-auto w-full">
              <div className="bg-card border border-border rounded-lg p-5">
                <SavedReports
                  allowCreate
                  onLoad={(report) => {
                    setLoadedReport({
                      sql: report.sql,
                      prompt: report.prompt,
                      kpi: report.kpi,
                      name: report.name,
                    });
                    setView("studio");
                  }}
                />
              </div>
            </div>
          )}
          {view === "kpi" && (
            <div className="max-w-6xl mx-auto w-full">
              <KpiExplorer />
            </div>
          )}
          {view === "schema" && (
            <div className="max-w-6xl mx-auto w-full">
              <SchemaViewer />
            </div>
          )}
          {view === "metadata" && (
            <div className="max-w-6xl mx-auto w-full">
              <MetadataReportEngine />
            </div>
          )}
          {view === "bi" && (
            <div className="max-w-7xl mx-auto w-full">
              <BiStudio />
            </div>
          )}
          {view === "contracts" && (
            <div className="max-w-7xl mx-auto w-full">
              <DataContractWorkspace />
            </div>
          )}

          {view === "agents" && (
            <div className="max-w-3xl mx-auto w-full">
              <AgentRegistry />
            </div>
          )}
          {view === "audit" && (
            <div className="max-w-6xl mx-auto w-full">
              <AuditDashboard />
            </div>
          )}
          {view === "sessions" && (
            <div className="max-w-3xl mx-auto w-full">
              <SessionManager currentUser={user} />
            </div>
          )}
          {view === "admin" && (
            <div className="max-w-6xl mx-auto w-full">
              {user.role === "Admin" ? (
                <SecurityConsole currentUser={user} />
              ) : (
                <AccessDenied
                  requiredRole="Admin"
                  currentRole={user.role}
                  onBack={() => setView("dashboard")}
                />
              )}
            </div>
          )}
          {view === "settings" && (
            <div className="max-w-2xl mx-auto w-full">
              <SettingsPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Supporting sub-views ──────────────────────────────────────────────────────

function AccessDenied({
  requiredRole,
  currentRole,
  onBack,
}: {
  requiredRole: string;
  currentRole: string;
  onBack: () => void;
}) {
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
          Contact your system administrator to request elevated access.
        </p>
      </div>
      <div className="text-[11px] text-muted-foreground bg-muted border border-border rounded-lg px-4 py-3 w-full">
        This access attempt has been logged to the immutable audit trail.
      </div>
      <button
        onClick={onBack}
        className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Return to Dashboard
      </button>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">AI Configuration</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">AI_GATEWAY_API_KEY</label>
            <input
              type="password"
              disabled
              placeholder="Set via Vars → AI_GATEWAY_API_KEY"
              className="bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Powers the AI Query Planner Agent (GPT-4o-mini via Vercel AI Gateway). Without this key the engine falls back to rule-based query generation.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">
              AZURE_OPENAI_API_KEY <span className="opacity-50">(optional — override)</span>
            </label>
            <input
              type="password"
              disabled
              placeholder="Set via Vars → AZURE_OPENAI_API_KEY"
              className="bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Use your own Azure OpenAI deployment instead of the gateway. Set AZURE_OPENAI_DEPLOYMENT to your deployment name.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Database Connection</h2>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground font-medium">
            SQL_CONNECTION_STRING
          </label>
          <input
            type="password"
            disabled
            placeholder="Set via Vars → SQL_CONNECTION_STRING"
            className="bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
          />
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Add this environment variable via the Vars section in project settings. The engine
            automatically switches from demo mode to live mode once configured.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Architecture Reference</h2>
        <div className="flex flex-col gap-0.5">
          {[
            ["POST /api/generate-query", "AI Query Planner Agent — NL → structured QueryPlan"],
            ["POST /api/generate-query/validate", "Inline SQL validator for the SQL editor"],
            ["POST /api/run-sql", "SQL Execution Agent — runs validated SQL, caps at 10k rows"],
            ["GET  /api/schema", "Schema Intelligence Agent — live INFORMATION_SCHEMA or static"],
            ["GET  /api/reports", "List all saved reports (Report Registry)"],
            ["POST /api/reports", "Save a new report to the registry"],
            ["PATCH/DELETE /api/reports/[id]", "Update or delete a saved report"],
            ["POST /api/report/run", "Legacy pipeline — NL → generate → validate → execute"],
            ["GET /api/health", "Service and database health check"],
            ["lib/agents/queryPlanner.ts", "AI Query Planner — Azure OpenAI / AI Gateway"],
            ["lib/agents/schemaAgent.ts", "Schema Intelligence — INFORMATION_SCHEMA + cache"],
            ["lib/agents/reportRegistry.ts", "Report Registry — DynamicReports in-memory store"],
            ["lib/services/queryGuard.ts", "Security layer — blocks DDL, injection, SELECT *"],
            ["lib/services/db.ts", "MSSQL connection pool with read-only intent"],
            ["lib/config/semanticLayer.json", "Business term → physical column mapping"],
            ["lib/config/schemaConfig.json", "Table aliases, keys, join conditions"],
            ["lib/config/kpiConfig.json", "KPI → table/column/aggregation mapping"],
          ].map(([path, desc]) => (
            <div
              key={path}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-1.5 border-b border-border/40 last:border-0"
            >
              <code className="font-mono text-primary/90 shrink-0 text-[11px]">{path}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Scheduling — Azure Logic Apps
        </h2>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          Schedule a weekly trigger every Sunday at 23:00 America/Los_Angeles. The Logic App
          POSTs to{" "}
          <code className="font-mono text-primary">/api/report/run</code> with your report
          payload.
        </p>
        <pre className="text-[11px] font-mono text-foreground/80 bg-muted rounded-md p-3 overflow-x-auto leading-relaxed">
{`{
  "report_name": "Weekly Admissions",
  "prompt": "Show weekly admissions by branch",
  "filters": {
    "date_range": {
      "start_date": "@{startOfWeek(utcNow())}",
      "end_date": "@{utcNow()}"
    }
  }
}`}
        </pre>
      </div>
    </div>
  );
}
