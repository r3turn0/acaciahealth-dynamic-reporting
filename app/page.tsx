"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { SchemaViewer } from "@/components/dashboard/SchemaViewer";
import { KpiExplorer } from "@/components/dashboard/KpiExplorer";
import { HealthStatus } from "@/components/dashboard/HealthStatus";
import { ReportStudio } from "@/components/studio/ReportStudio";
import { SavedReports } from "@/components/studio/SavedReports";
import type { LoadedReport } from "@/components/studio/ReportStudio";
import { DataExplorer } from "@/components/data/DataExplorer";
import { MetadataReportEngine } from "@/components/schema/MetadataReportEngine";
import { LoginPage } from "@/components/auth/LoginPage";
import { SessionManager } from "@/components/security/SessionManager";
import { SecurityConsole } from "@/components/admin/SecurityConsole";
import { AuditDashboard } from "@/components/audit/AuditDashboard";
import { Menu, Bell, Calendar } from "lucide-react";

type View = "dashboard" | "studio" | "data" | "kpi" | "schema" | "metadata" | "saved" | "audit" | "settings" | "login" | "sessions" | "admin";

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
    title: "Data",
    subtitle: "Browse, filter, sort, and export raw table data",
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
    subtitle: "Upload metadata.json to build schema model, discover fields, resolve joins, and generate ReportPlans",
  },
  saved: {
    title: "Saved Reports",
    subtitle: "Your saved report library — load, re-run, or delete",
  },
  audit: {
    title: "Audit & Monitoring",
    subtitle: "Immutable authentication, access, and policy event log — HIPAA §164.312 · Azure Sentinel",
  },
  login: {
    title: "Secure Login",
    subtitle: "Azure AD SSO, passwordless, and MFA — NIST 800-63B AAL2/AAL3",
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
};

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayLabel, setTodayLabel] = useState<string>("");
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
  }, []);

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
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
              AD
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-5 md:px-6 py-6">
          {view === "dashboard" && (
            <div className="flex flex-col gap-6 max-w-6xl">
              <KpiCards />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <RecentReports />
                </div>
                <div>
                  <HealthStatus />
                </div>
              </div>
              <QuickStart onNavigate={(id) => setView(id as View)} />
            </div>
          )}
          {view === "studio" && (
            <div className="max-w-5xl">
              <ReportStudio initialReport={loadedReport} />
            </div>
          )}
          {view === "data" && (
            <div className="max-w-6xl">
              <DataExplorer />
            </div>
          )}
          {view === "saved" && (
            <div className="max-w-4xl">
              <div className="bg-card border border-border rounded-lg p-5">
                <SavedReports
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
            <div className="max-w-5xl">
              <KpiExplorer />
            </div>
          )}
          {view === "schema" && (
            <div className="max-w-5xl">
              <SchemaViewer />
            </div>
          )}
          {view === "metadata" && (
            <div className="max-w-5xl">
              <MetadataReportEngine />
            </div>
          )}
          {view === "audit" && (
            <div className="max-w-5xl">
              <AuditDashboard />
            </div>
          )}
          {view === "login" && (
            <div className="max-w-md mx-auto">
              <LoginPage onAuthenticated={() => setView("dashboard")} />
            </div>
          )}
          {view === "sessions" && (
            <div className="max-w-3xl">
              <SessionManager />
            </div>
          )}
          {view === "admin" && (
            <div className="max-w-5xl">
              <SecurityConsole />
            </div>
          )}
          {view === "settings" && (
            <div className="max-w-2xl">
              <SettingsPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Supporting sub-views ──────────────────────────────────────────────────────

function RecentReports() {
  const reports = [
    { name: "Weekly Admissions by Branch", kpi: "admissions", rows: 42, ran: "2 hours ago" },
    { name: "Revenue WTD — Home Health", kpi: "revenue", rows: 18, ran: "5 hours ago" },
    { name: "Active Census by Care Type", kpi: "census", rows: 12, ran: "1 day ago" },
    { name: "Discharge Summary Weekly", kpi: "discharges", rows: 36, ran: "1 day ago" },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Recent Reports</h2>
      <div className="flex flex-col gap-1">
        {reports.map((r, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0"
          >
            <div>
              <p className="text-sm text-foreground">{r.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.ran}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize">
                {r.kpi}
              </span>
              <span className="text-xs text-muted-foreground">{r.rows} rows</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickStart({ onNavigate }: { onNavigate: (id: string) => void }) {
  const actions = [
    {
      id: "studio",
      label: "Open Report Studio",
      desc: "Ask AI, write SQL, run queries, save reports",
    },
    {
      id: "kpi",
      label: "Explore KPIs",
      desc: "Browse admissions, revenue, census, discharges",
    },
    {
      id: "data",
      label: "Browse Table Data",
      desc: "Filter, sort, and export raw rows from any table",
    },
    {
      id: "schema",
      label: "Schema Intelligence",
      desc: "Tables, join paths, semantic layer, column types",
    },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {actions.map((a) => (
          <button
            key={a.id}
            onClick={() => onNavigate(a.id)}
            className="text-left border border-border rounded-lg p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <p className="text-sm font-medium text-foreground">{a.label}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.desc}</p>
          </button>
        ))}
      </div>
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
