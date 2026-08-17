"use client";

import { BookOpen, Table2, Filter, TrendingUp, ExternalLink, ShieldCheck, Gauge, GitBranch } from "lucide-react";
import { analyzeSql } from "@/lib/services/metadataIntelligence";
import type { QueryPlan } from "./AskAI";

interface QueryExplanationProps {
  plan: QueryPlan;
}

export function QueryExplanation({ plan }: QueryExplanationProps) {
  const intelligence = analyzeSql(plan.sql);
  const scoreItems = [
    { label: "Execution readiness", value: intelligence.executionReadinessScore },
    { label: "Join confidence", value: intelligence.joinConfidenceScore },
    { label: "Query complexity", value: intelligence.queryComplexityScore },
  ];

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

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="SQL intelligence scores">
          {scoreItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</span>
                <span className="font-mono text-xs font-semibold text-foreground">{item.value}/100</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Join evidence</span>
            </div>
            {intelligence.joinLogic.length > 0 ? (
              <div className="flex flex-col gap-1">
                {intelligence.joinLogic.map((join) => (
                  <div key={`${join.left}-${join.right}`} className="rounded border border-border/50 bg-muted px-2 py-1.5 text-[11px] text-foreground/80">
                    <span className="font-mono">{join.left} = {join.right}</span>
                    <span className="ml-2 text-muted-foreground">{join.band} ({join.confidence}/100)</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">No joins are required by this query.</p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estimated impact</span>
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-foreground/80">
              <span>Row impact: <strong className="capitalize">{intelligence.estimatedRowImpact}</strong></span>
              <span>Cost risk: <strong className="capitalize">{intelligence.estimatedCostRisk}</strong></span>
              <span>Parameters: <span className="font-mono">{intelligence.externalParameters.join(", ") || "None"}</span></span>
            </div>
          </div>
        </div>

        {(intelligence.warnings.length > 0 || intelligence.optimizationRecommendations.length > 0) && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Advisory guidance</span>
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed text-foreground/80">
              {[...intelligence.warnings, ...intelligence.optimizationRecommendations.map((item) => item.message)].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">Advisory only · virtual · not persisted</p>
          </div>
        )}

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
