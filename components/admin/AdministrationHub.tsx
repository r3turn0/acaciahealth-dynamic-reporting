"use client";

/**
 * AdministrationHub
 *
 * Single governed administration surface — replaces 6 previously separate nav items:
 *   Audit & Monitoring | Security Console | Session Manager |
 *   Agent Registry | Pipeline Builder | Settings
 *
 * Spec: ≤ 7 primary nav items · Administration is primary item #7
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  Users,
  Activity,
  Layers,
  GitMerge,
  Settings,
  Lock,
} from "lucide-react";
import { AuditDashboard }   from "@/components/audit/AuditDashboard";
import { SecurityConsole }  from "@/components/admin/SecurityConsole";
import { SessionManager }   from "@/components/security/SessionManager";
import { AgentRegistry }    from "@/components/agents/AgentRegistry";
import { PipelineBuilder }  from "@/components/pipeline/PipelineBuilder";
import type { AuthUser }    from "@/components/auth/LoginPage";

// ── Tab definitions ───────────────────────────────────────────────────────────

type AdminTab = "audit" | "security" | "sessions" | "agents" | "pipeline" | "settings";

const TABS: { id: AdminTab; label: string; icon: React.ElementType; adminOnly?: boolean; description: string }[] = [
  {
    id:          "audit",
    label:       "Audit & Monitoring",
    icon:        Activity,
    description: "Immutable authentication, access, and policy event log — HIPAA §164.312",
  },
  {
    id:          "security",
    label:       "Security Console",
    icon:        ShieldCheck,
    adminOnly:   true,
    description: "RBAC/ABAC, conditional access, IP allowlists, PAM, and break-glass",
  },
  {
    id:          "sessions",
    label:       "Session Manager",
    icon:        Users,
    description: "Active sessions, device compliance, revocation, and inactivity timeout",
  },
  {
    id:          "agents",
    label:       "Agent Registry",
    icon:        Layers,
    description: "Registered agents — versioning, capabilities, feature flags, and A/B config",
  },
  {
    id:          "pipeline",
    label:       "Pipeline Builder",
    icon:        GitMerge,
    description: "Construct, version, and execute dynamic multi-agent pipelines",
  },
  {
    id:          "settings",
    label:       "Settings",
    icon:        Settings,
    description: "Environment, AI gateway, database connection, and configuration",
  },
];

interface AdministrationHubProps {
  initialTab?:  AdminTab;
  currentUser:  AuthUser;
  onNavigate:   (view: string) => void;
}

export function AdministrationHub({ initialTab = "audit", currentUser, onNavigate }: AdministrationHubProps) {
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const isAdmin = currentUser.role === "Admin";

  // Respond to sidebar sub-item clicks that change initialTab while this hub is already mounted
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const activeTab   = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-0 bg-card border border-border rounded-xl overflow-hidden">
      {/* Tab strip */}
      <div className="flex items-stretch gap-0 border-b border-border overflow-x-auto bg-card shrink-0">
        {visibleTabs.map(({ id, label, icon: Icon, adminOnly }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
              tab === id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {label}
            {adminOnly && (
              <Lock className="w-2.5 h-2.5 text-chart-5 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Active tab description bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 bg-muted/30 border-b border-border/60">
        {activeTab && <activeTab.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <p className="text-[11px] text-muted-foreground">{activeTab?.description}</p>
      </div>

      {/* Tab content */}
      <div className="p-5">
        {tab === "audit" && <AuditDashboard />}

        {tab === "security" && (
          isAdmin
            ? <SecurityConsole currentUser={currentUser} />
            : <AccessDenied role="Admin" current={currentUser.role} />
        )}

        {tab === "sessions" && <SessionManager currentUser={currentUser} />}

        {tab === "agents" && (
          <AgentRegistry onNavigateToPipeline={() => setTab("pipeline")} />
        )}

        {tab === "pipeline" && <PipelineBuilder />}

        {tab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}

// ── Settings panel (inlined — was previously a bare function in page.tsx) ─────

function SettingsPanel() {
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="bg-background border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">AI Configuration</h2>
        <div className="flex flex-col gap-4">
          {[
            {
              key:  "AI_GATEWAY_API_KEY",
              hint: "Powers the Query Gateway AI stages (IntentAgent → SQLGenerator) via Vercel AI Gateway. Without this key the engine uses rule-based generation.",
            },
            {
              key:  "AZURE_OPENAI_API_KEY",
              hint: "Optional override — use your own Azure OpenAI deployment instead of the gateway. Also set AZURE_OPENAI_DEPLOYMENT to your deployment name.",
            },
          ].map(({ key, hint }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground font-medium font-mono">{key}</label>
              <input
                type="password"
                disabled
                placeholder={`Set via Vars → ${key}`}
                className="bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-background border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Database Connection</h2>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground font-medium font-mono">SQL_CONNECTION_STRING</label>
          <input
            type="password"
            disabled
            placeholder="Set via Vars → SQL_CONNECTION_STRING"
            className="bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
          />
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Add this via the Vars section in project settings. The platform automatically switches from demo mode to live mode once configured.
          </p>
        </div>
      </div>

      <div className="bg-background border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Query Gateway Architecture</h2>
        <div className="flex flex-col gap-0 divide-y divide-border/60">
          {[
            ["POST /api/gateway/query",           "Single SQL execution entry point — all surfaces route here"],
            ["POST /api/gateway/feedback",         "User feedback → LearningRepository → pattern promotion"],
            ["GET  /api/gateway/patterns",         "Approved SQL pattern catalog — governance review"],
            ["POST /api/generate-query",           "Adapter → gateway (source: natural_language)"],
            ["POST /api/run-sql",                  "Adapter → gateway (source: sql_editor)"],
            ["POST /api/report/run",               "Adapter → gateway (source: report_builder)"],
            ["POST /api/datasets/query",           "Adapter → gateway (source: dataset_studio)"],
            ["GET  /api/schema",                   "Schema Intelligence Agent — INFORMATION_SCHEMA or static"],
            ["GET  /api/health",                   "Service and database health check"],
          ].map(([route, desc]) => (
            <div key={route} className="flex flex-col gap-0.5 py-2">
              <code className="text-[11px] text-primary font-mono">{route}</code>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Access denied sub-panel ───────────────────────────────────────────────────

function AccessDenied({ role, current }: { role: string; current: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center max-w-sm mx-auto">
      <div className="w-12 h-12 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center justify-center">
        <Lock className="w-6 h-6 text-destructive" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">Access Denied</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          This section requires the <span className="font-medium text-foreground">{role}</span> role.
          You are signed in as <span className="font-medium text-foreground">{current}</span>.
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground bg-muted border border-border rounded-lg px-4 py-2">
        This access attempt has been logged to the immutable audit trail.
      </p>
    </div>
  );
}
