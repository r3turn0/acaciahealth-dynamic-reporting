"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import kpiConfig from "@/lib/config/kpiConfig.json";

type KpiKey = keyof typeof kpiConfig;

export function KpiExplorer() {
  const [selected, setSelected] = useState<KpiKey | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchKpi(kpi: KpiKey) {
    setSelected(kpi);
    setLoading(true);
    try {
      const res = await fetch(`/api/kpi/${kpi}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Available KPIs</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(kpiConfig) as KpiKey[]).map((kpi) => {
            const def = kpiConfig[kpi];
            return (
              <button
                key={kpi}
                onClick={() => fetchKpi(kpi)}
                className={`text-left border rounded-lg p-3 transition-colors ${
                  selected === kpi
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted/30 hover:border-primary/50"
                }`}
              >
                <p className="text-xs font-semibold text-foreground capitalize">{def.label}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                  {def.description}
                </p>
                <p className="text-[10px] font-mono text-primary mt-2">{def.aggregation}</p>
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading KPI definition...
        </div>
      )}

      {data && !loading && (
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <ExternalLink className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground capitalize">
              {selected} — API Definition
            </h3>
          </div>
          <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted rounded-md p-4 overflow-x-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
