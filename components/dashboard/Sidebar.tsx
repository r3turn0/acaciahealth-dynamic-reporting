"use client";

import { cn } from "@/lib/utils";
import {
  BarChart3,
  Database,
  Heart,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Sparkles,
  Bookmark,
  Zap,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", id: "dashboard", group: "main" },
  { icon: Sparkles, label: "Report Studio", id: "studio", group: "main" },
  { icon: BarChart3, label: "KPI Explorer", id: "kpi", group: "main" },
  { icon: Database, label: "Schema Intelligence", id: "schema", group: "main" },
  { icon: Bookmark, label: "Saved Reports", id: "saved", group: "reports" },
  { icon: ShieldCheck, label: "Audit Log", id: "audit", group: "reports" },
  { icon: Settings, label: "Settings", id: "settings", group: "config" },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside className="flex flex-col h-full w-60 bg-sidebar border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/20">
          <Heart className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground leading-none">AcaciaHealth Reporting</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Dynamic Engine v1.0</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1 overflow-y-auto">
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Reporting
        </p>
        {navItems
          .filter((n) => n.group === "main")
          .map(({ icon: Icon, label, id }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left w-full",
                activeView === id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}

        <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          History
        </p>
        {navItems
          .filter((n) => n.group === "reports")
          .map(({ icon: Icon, label, id }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left w-full",
                activeView === id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}

        <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          System
        </p>
        {navItems
          .filter((n) => n.group === "config")
          .map(({ icon: Icon, label, id }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left w-full",
                activeView === id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
      </nav>

      {/* Status badge */}
      <div className="px-4 py-4 border-t border-border flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-muted-foreground">
            AI:{" "}
            <span className="text-primary font-medium">GPT-4o-mini</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-chart-5" />
          <span className="text-xs text-muted-foreground">
            DB:{" "}
            <span className="text-chart-5 font-medium">Demo Mode</span>
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Add AI_GATEWAY_API_KEY + SQL_CONNECTION_STRING to go live
        </p>
      </div>
    </aside>
  );
}
