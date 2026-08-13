"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { analyzeSqlCompatibility } from "@/lib/services/sqlCompatibility";

interface SqlCompatibilityIndicatorProps {
  sql: string;
  availableParameters?: string[];
}

export function SqlCompatibilityIndicator({
  sql,
  availableParameters = ["StartDate", "EndDate", "BranchCode"],
}: SqlCompatibilityIndicatorProps) {
  const report = useMemo(
    () => analyzeSqlCompatibility(sql, availableParameters),
    [availableParameters, sql]
  );
  if (!sql.trim()) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      {report.compatible ? (
        <CheckCircle2 className="size-4 shrink-0 text-chart-1" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-chart-4" aria-hidden="true" />
      )}
      <span className="font-medium text-foreground">
        {report.compatible ? "Read-only compatible" : "Parameter values required"}
      </span>
      <span className="text-muted-foreground">
        {report.statementCount} result statement{report.statementCount === 1 ? "" : "s"}
      </span>
      {report.features.map((feature) => (
        <span key={feature} className="rounded bg-card px-2 py-0.5 text-muted-foreground ring-1 ring-border">
          {feature}
        </span>
      ))}
      {report.declaredParameters.length > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Local declarations preserved
        </span>
      )}
      {report.unresolvedParameters.length > 0 && (
        <span className="text-chart-4">
          Missing {report.unresolvedParameters.map((name) => `@${name}`).join(", ")}
        </span>
      )}
    </div>
  );
}
