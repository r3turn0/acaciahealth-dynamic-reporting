"use client";

import { useRef, useState } from "react";
import { Plus, X, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/store/useWorkspaceStore";
import type { WorkspaceTab } from "@/lib/store/useWorkspaceStore";

interface WorkspaceTabBarProps {
  onRefreshAll: () => void;
  refreshingAll: boolean;
}

const STATUS_ICON: Record<WorkspaceTab["status"], React.ReactNode> = {
  idle: null,
  generating: <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />,
  running: <Loader2 className="w-2.5 h-2.5 animate-spin text-chart-3" />,
  fixing: <Loader2 className="w-2.5 h-2.5 animate-spin text-chart-4" />,
  success: <CheckCircle2 className="w-2.5 h-2.5 text-chart-3" />,
  error: <XCircle className="w-2.5 h-2.5 text-destructive" />,
};

export function WorkspaceTabBar({ onRefreshAll, refreshingAll }: WorkspaceTabBarProps) {
  const { tabs, activeTabId, addTab, closeTab, switchTab, updateTab } = useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename(tab: WorkspaceTab) {
    setEditingId(tab.id);
    setEditValue(tab.title);
    setTimeout(() => inputRef.current?.select(), 30);
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      updateTab(editingId, { title: editValue.trim() });
    }
    setEditingId(null);
  }

  return (
    <div className="flex items-center gap-0 border-b border-border bg-muted/30 overflow-x-auto shrink-0">
      {/* Tabs */}
      <div className="flex items-center min-w-0 flex-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const icon = STATUS_ICON[tab.status];

          return (
            <div
              key={tab.id}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-2 border-r border-border cursor-pointer select-none transition-colors shrink-0 max-w-[200px] relative",
                isActive
                  ? "bg-card text-foreground border-b-2 border-b-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              onClick={() => switchTab(tab.id)}
              onDoubleClick={() => startRename(tab)}
            >
              {/* Type indicator */}
              {tab.type === "report" ? (
                <BookMarked className="w-3 h-3 shrink-0 text-primary/60" />
              ) : null}

              {/* Title or rename input */}
              {editingId === tab.id ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-24 text-xs bg-transparent border-b border-primary outline-none text-foreground"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-[12px] font-medium truncate max-w-[120px]">{tab.title}</span>
              )}

              {/* Status indicator */}
              {icon && <span className="shrink-0">{icon}</span>}

              {/* Last run time */}
              {tab.status === "success" && tab.lastRun && (
                <span className="text-[9px] text-muted-foreground hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <Clock className="w-2 h-2" />
                  {new Date(tab.lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}

              {/* Close button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-colors",
                    isActive
                      ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  aria-label={`Close ${tab.title}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* New tab button */}
        <button
          onClick={() => addTab()}
          className="flex items-center gap-1 px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 border-r border-border"
          aria-label="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Refresh All */}
      <button
        onClick={onRefreshAll}
        disabled={refreshingAll}
        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 border-l border-border disabled:opacity-40"
        title="Re-run all tabs with SQL"
      >
        {refreshingAll ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">Refresh All</span>
      </button>
    </div>
  );
}
