"use client";

import { BookOpen, Table2, Filter, TrendingUp, ExternalLink } from "lucide-react";
import type { QueryPlan } from "./AskAI";

interface QueryExplanationProps {
  plan: QueryPlan;
}

export function QueryExplanation({ plan }: QueryExplanationProps) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
        <BookOpen className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Query Explanation
        </h3>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Natural language explanation */}
        <p className="text-sm text-foreground leading-relaxed">{plan.explanation}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tables used */}
          {plan.tables_used.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Tables Used
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {plan.tables_used.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-primary/80 bg-primary/8 px-2 py-1 rounded w-fit"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters applied */}
          {plan.filters_applied.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Filters Applied
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {plan.filters_applied.map((f) => (
                  <span
                    key={f}
                    className="text-[11px] text-foreground/80 bg-muted px-2 py-1 rounded border border-border/50"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* KPI badge */}
        {plan.kpi_detected && (
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">KPI detected:</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium capitalize">
              {plan.kpi_detected}
            </span>
          </div>
        )}

        {/* API fallback */}
        {plan.strategy === "api_fallback" && plan.api_fallback_reason && (
          <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground leading-relaxed border border-border/50">
            <span className="font-semibold text-foreground">API Fallback: </span>
            {plan.api_fallback_reason}
          </div>
        )}
      </div>
    </div>
  );
}
