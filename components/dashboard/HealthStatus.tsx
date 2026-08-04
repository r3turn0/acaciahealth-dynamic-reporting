"use client";

import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useHealth } from "@/lib/hooks/useHealth";

export function HealthStatus() {
  const { data: health, isLoading, isValidating, mutate } = useHealth();

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">System Health</h2>
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading && !health ? (
        <p className="text-xs text-muted-foreground">Checking system health...</p>
      ) : !health ? (
        <div role="alert" className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Health service did not respond.</span>
          </div>
          <button type="button" onClick={() => void mutate()} className="text-xs font-medium text-primary hover:underline">
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <StatusRow label="API Service" ok={health.status === "ok"} value={health.status} />
          <StatusRow
            label="Database"
            ok={health.services.database.connected}
            value={health.services.database.mode}
            warning={!health.services.database.configured}
            warningText="Not configured — add SQL_CONNECTION_STRING"
          />
          <StatusRow
            label="AI Gateway"
            ok={health.services.ai?.configured ?? false}
            value={health.services.ai?.configured ? health.services.ai.model : "Not configured"}
            warning={!health.services.ai?.configured}
            warningText="Add AI_GATEWAY_API_KEY to enable AI features"
          />
          <StatusRow label="Cache" ok value={`${health.services.cache.active_entries} active entries`} />
          <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>v{health.version} · {health.environment}</span>
            <span>{new Date(health.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  ok,
  value,
  warning,
  warningText,
}: {
  label: string;
  ok: boolean;
  value: string;
  warning?: boolean;
  warningText?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-foreground capitalize">{value}</span>
        {warning ? (
          <span title={warningText}><AlertCircle className="w-3.5 h-3.5 text-chart-5" /></span>
        ) : ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-chart-3" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive" />
        )}
      </div>
    </div>
  );
}
