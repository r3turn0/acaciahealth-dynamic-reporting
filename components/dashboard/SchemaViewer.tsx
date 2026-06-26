"use client";

import { Database, Link2 } from "lucide-react";
import schemaConfig from "@/lib/config/schemaConfig.json";
import kpiConfig from "@/lib/config/kpiConfig.json";
import bucketMap from "@/lib/config/bucketMap.json";

type SchemaEntry = {
  alias: string;
  keys: string[];
  joins: Record<string, string>;
};

export function SchemaViewer() {
  const schema = schemaConfig as Record<string, SchemaEntry>;

  return (
    <div className="flex flex-col gap-6">
      {/* Tables */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            AcaciaHealth Schema (Read-Only)
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(schema).map(([table, def]) => (
            <div
              key={table}
              className="border border-border rounded-md p-3 bg-muted/30"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-semibold text-primary">{table}</span>
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                  alias: {def.alias}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Keys: {def.keys.join(", ")}
              </p>
              {Object.keys(def.joins).length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                    Joins
                  </p>
                  {Object.entries(def.joins).map(([target, condition]) => (
                    <div key={target} className="flex items-start gap-1.5 mb-1">
                      <Link2 className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-[11px] text-foreground font-medium">{target}</span>
                        <br />
                        <code className="text-[10px] font-mono text-muted-foreground">
                          {condition}
                        </code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* KPI definitions */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">KPI Definitions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(kpiConfig).map(([kpi, def]) => (
            <div key={kpi} className="border border-border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-primary capitalize">{def.label}</span>
                <code className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                  {kpi}
                </code>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">{def.description}</p>
              <div className="flex flex-col gap-1 text-[11px]">
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Table:</span>
                  <code className="font-mono text-foreground">{def.fact_table}</code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Date col:</span>
                  <code className="font-mono text-foreground">{def.date_column}</code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Aggregation:</span>
                  <code className="font-mono text-foreground">{def.aggregation}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bucket map */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Bucket / Branch Map</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  SL ID
                </th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Branch Code
                </th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Bucket Name
                </th>
              </tr>
            </thead>
            <tbody>
              {bucketMap.map((row) => (
                <tr
                  key={row.sl_id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{row.sl_id}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">{row.branch_code}</td>
                  <td className="px-3 py-2 text-xs text-foreground">{row.bucket_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
