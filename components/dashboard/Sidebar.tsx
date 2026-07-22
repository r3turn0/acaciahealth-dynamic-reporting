"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Heart,
  LayoutDashboard,
  Compass,
  Layers,
  BarChart3,
  TrendingUp,
  Database,
  ShieldCheck,
  Sparkles,
  Zap,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";

// ── Navigation architecture — exactly 7 primary items ────────────────────────
//
// Spec: MAX 7 primary nav items, MAX 3-click depth, workflow-driven order:
//   Discover → Design → Publish → Analyze → Govern
//
// 1. Home
// 2. Discover Data
// 3. Dataset Studio   (Designer + DataContract + BI dataset tools)
// 4. Reports          (ReportStudio + Saved Reports)
// 5. KPI Intelligence (KpiExplorer + KpiSchemaAdmin + KpiIntelligence)
// 6. Schema Hub       (existing — sole metadata authority)
// 7. Administration   (Security + Sessions + Audit + Agents + Pipeline + Settings)

export type PrimaryView =
  | "home"
  | "discover"
  | "dataset-studio"
  | "reports"
  | "kpi"
  | "schema"
  | "administration";

interface NavItem {
  id:           PrimaryView;
  label:        string;
  icon:         React.ElementType;
  step?:        number;       // workflow step badge (1-5)
  badge?:       string;       // e.g. "Governed"
  subItems?:    SubNavItem[];
}

interface SubNavItem {
  id:    string;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  {
    id:    "home",
    label: "Home",
    icon:  LayoutDashboard,
  },
  {
    id:    "discover",
    label: "Discover Data",
    icon:  Compass,
    step:  1,
    subItems: [
      { id: "discover",          label: "Table Explorer"   },
      { id: "discover-semantic", label: "Semantic Search"  },
    ],
  },
  {
    id:    "dataset-studio",
    label: "Dataset Studio",
    icon:  Layers,
    step:  2,
    badge: "Single Source",
    subItems: [
      { id: "dataset-studio",          label: "Build Dataset"    },
      { id: "dataset-studio-validate", label: "Validate"         },
      { id: "dataset-studio-publish",  label: "Publish"          },
      { id: "dataset-studio-history",  label: "Version History"  },
    ],
  },
  {
    id:    "reports",
    label: "Reports",
    icon:  BarChart3,
    step:  3,
    subItems: [
      { id: "reports",       label: "Report Studio"  },
      { id: "reports-saved", label: "Report Catalog" },
      { id: "reports-bi",    label: "BI Studio"      },
    ],
  },
  {
    id:    "kpi",
    label: "KPI Intelligence",
    icon:  TrendingUp,
    step:  4,
    badge: "Registry",
    subItems: [
      { id: "kpi",              label: "KPI Interpreter"  },
      { id: "kpi-registry",     label: "KPI Registry"     },
      { id: "kpi-governance",   label: "KPI Governance"   },
    ],
  },
  {
    id:    "schema",
    label: "Schema Hub",
    icon:  Database,
    badge: "Authority",
    subItems: [
      { id: "schema",             label: "Schema Explorer"    },
      { id: "schema-metadata",    label: "Metadata Engine"    },
      { id: "schema-registry",    label: "Schema Registry"    },
      { id: "schema-lineage",     label: "Lineage Explorer"   },
      { id: "schema-glossary",    label: "Business Glossary"  },
    ],
  },
  {
    id:    "administration",
    label: "Administration",
    icon:  ShieldCheck,
    subItems: [
      { id: "admin-audit",     label: "Audit & Monitoring" },
      { id: "admin-security",  label: "Security Console"   },
      { id: "admin-sessions",  label: "Session Manager"    },
      { id: "admin-agents",    label: "Agent Registry"     },
      { id: "admin-pipeline",  label: "Pipeline Builder"   },
      { id: "admin-settings",  label: "Settings"           },
    ],
  },
];

// ── Status rows ───────────────────────────────────────────────────────────────

function AiStatusRow() {
  const [status, setStatus] = useState<"checking" | "live" | "demo">("checking");
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setStatus(d?.services?.ai?.configured ? "live" : "demo"))
      .catch(() => setStatus("demo"));
  }, []);
  return (
    <div className="flex items-center gap-2">
      <Sparkles className="w-3 h-3 text-primary shrink-0" />
      <span className="text-[11px] text-muted-foreground">
        AI:{" "}
        {status === "checking" ? (
          <span className="font-medium">...</span>
        ) : status === "live" ? (
          <span className="text-primary font-medium">Gateway</span>
        ) : (
          <span className="text-chart-5 font-medium">Demo</span>
        )}
      </span>
    </div>
  );
}

function DbStatusRow() {
  const [mode, setMode] = useState<"checking" | "live_db" | "demo">("checking");
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setMode(d?.services?.database?.mode ?? "demo"))
      .catch(() => setMode("demo"));
  }, []);
  return (
    <div className="flex items-center gap-2">
      <Zap className="w-3 h-3 text-chart-5 shrink-0" />
      <span className="text-[11px] text-muted-foreground">
        DB:{" "}
        {mode === "checking" ? (
          <span className="font-medium">...</span>
        ) : mode === "live_db" ? (
          <span className="text-chart-3 font-medium">Live</span>
        ) : (
          <span className="text-chart-5 font-medium">Demo</span>
        )}
      </span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  activeView:  string;
  userRole?:   string;
  onNavigate:  (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ activeView, userRole: _userRole, onNavigate }: SidebarProps) {
  // Determine which primary item is active based on the current view string
  function getPrimary(view: string): PrimaryView {
    if (view === "home" || view === "dashboard")                   return "home";
    if (view.startsWith("discover") || view === "data")           return "discover";
    if (view.startsWith("dataset") || view === "designer" || view === "contracts" || view === "bi-data") return "dataset-studio";
    if (view.startsWith("reports") || view === "studio" || view === "saved" || view === "bi")           return "reports";
    if (view.startsWith("kpi") || view === "kpiadmin")            return "kpi";
    if (view.startsWith("schema") || view === "metadata" || view === "registry") return "schema";
    if (view.startsWith("admin") || view === "audit" || view === "sessions" || view === "agents" || view === "pipeline" || view === "settings") return "administration";
    return "home";
  }

  const activePrimary = getPrimary(activeView);

  // Track which primary items are expanded (open accordion).
  // Initialise with the active section open.
  const [expanded, setExpanded] = useState<Set<PrimaryView>>(() => new Set([activePrimary]));

  // Keep the accordion in sync whenever the active primary section changes
  // (e.g. programmatic navigation, DashboardHome quick-actions, etc.)
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.has(activePrimary)) return prev; // already open — no change
      const next = new Set(prev);
      next.add(activePrimary);
      return next;
    });
  }, [activePrimary]);

  function toggleExpand(id: PrimaryView) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handlePrimaryClick(item: NavItem) {
    if (item.subItems && item.subItems.length > 0) {
      toggleExpand(item.id);
      // Also navigate to the first sub-item
      onNavigate(item.subItems[0].id);
    } else {
      onNavigate(item.id);
    }
  }

  return (
    <aside className="flex flex-col h-full w-60 bg-sidebar border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20 shrink-0">
          <Heart className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-foreground leading-none truncate">AcaciaHealth</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">Reporting Platform v2</p>
        </div>
      </div>

      {/* Workflow label */}
      <div className="px-4 pt-3 pb-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
          Discover → Design → Analyze → Govern
        </p>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 flex-1 overflow-y-auto pb-2" aria-label="Primary navigation">
        {PRIMARY_NAV.map((item) => {
          const Icon     = item.icon;
          const isActive = activePrimary === item.id;
          const isOpen   = expanded.has(item.id);
          const hasChildren = item.subItems && item.subItems.length > 0;

          return (
            <div key={item.id}>
              {/* Primary item */}
              <button
                onClick={() => handlePrimaryClick(item)}
                aria-expanded={hasChildren ? isOpen : undefined}
                className={cn(
                  "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium transition-colors text-left",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
              >
                {/* Step badge or icon */}
                {item.step ? (
                  <span
                    className={cn(
                      "flex items-center justify-center w-5 h-5 rounded-md text-[9px] font-bold shrink-0 border",
                      isActive
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-muted/60 border-border text-muted-foreground"
                    )}
                  >
                    {item.step}
                  </span>
                ) : (
                  <Icon className="w-4 h-4 shrink-0" />
                )}

                {/* Label + governance badge */}
                <span className="flex-1 truncate text-[13px]">{item.label}</span>

                {item.badge && (
                  <span className={cn(
                    "text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0",
                    isActive
                      ? "bg-primary/20 border-primary/30 text-primary"
                      : "bg-muted/60 border-border text-muted-foreground/70"
                  )}>
                    {item.badge}
                  </span>
                )}

                {/* Chevron for expandable items */}
                {hasChildren && (
                  isOpen
                    ? <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
                    : <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-50" />
                )}
              </button>

              {/* Sub-items */}
              {hasChildren && isOpen && (
                <div className="ml-3 mt-0.5 mb-0.5 flex flex-col gap-0.5 border-l border-border/60 pl-2.5">
                  {item.subItems!.map((sub) => {
                    const isSubActive = activeView === sub.id;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => onNavigate(sub.id)}
                        className={cn(
                          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors",
                          isSubActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                        )}
                      >
                        {isSubActive && <CheckCircle2 className="w-3 h-3 shrink-0 text-primary" />}
                        <span className={cn("text-[12px] truncate", !isSubActive && "pl-5")}>
                          {sub.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Governance badge */}
      <div className="px-3 py-2 mx-2 mb-2 rounded-lg bg-chart-3/8 border border-chart-3/20">
        <p className="text-[9px] font-bold uppercase tracking-widest text-chart-3/80 mb-1">Query Gateway</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          100% read-only · All SQL governed
        </p>
      </div>

      {/* Status footer */}
      <div className="px-4 py-3 border-t border-border flex flex-col gap-1.5">
        <AiStatusRow />
        <DbStatusRow />
      </div>
    </aside>
  );
}
