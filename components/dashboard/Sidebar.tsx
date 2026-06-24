"use client";

import { useState } from "react";
import {
  BarChart3,
  Database,
  FileText,
  Heart,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" },
  { icon: FileText, label: "Run Report", id: "run" },
  { icon: BarChart3, label: "KPI Explorer", id: "kpi" },
  { icon: Database, label: "Schema Info", id: "schema" },
  { icon: ShieldCheck, label: "Audit Log", id: "audit" },
  { icon: Settings, label: "Settings", id: "settings" },
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
          <p className="text-xs font-semibold text-foreground leading-none">HCHB Reporting</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Dynamic Engine v1.0</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1">
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Navigation
        </p>
        {navItems.map(({ icon: Icon, label, id }) => (
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
      <div className="px-5 py-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-muted-foreground">
            DB:{" "}
            <span className="text-primary font-medium">Demo Mode</span>
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Set SQL_CONNECTION_STRING to connect
        </p>
      </div>
    </aside>
  );
}
