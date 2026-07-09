"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Database,
  Table2,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  Check,
  X,
  Loader2,
  ChevronLeft,
  Lock,
  FileCheck2,
  AlertCircle,
  Link2,
  Waypoints,
} from "lucide-react";

// ── Types (mirror the access-proxy API shapes) ─────────────────────────────────

interface RegistryColumn { name: string; type: string }
interface RegistryRelationship { toTable: string; condition: string }
interface RegistryTable {
  id: string; schema: string; name: string; alias: string;
  columns: RegistryColumn[]; relationships: RegistryRelationship[];
}
interface RegisteredSchema {
  id: string; name: string; source: "upload" | "introspection";
  tables: RegistryTable[]; registeredAt: string;
}
interface ContractJoin { fromTable: string; toTable: string; type: "FK" }
interface DataPage {
  table: string; columns: string[]; rows: Record<string, unknown>[];
  page: number; pageSize: number; total: number; totalPages: number;
  source: "demo" | "live_db";
}

const PAGE_SIZES = [25, 50, 100, 200];

// ── Cell renderer ───────────────────────────────────────────────────────────────

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground/40 italic text-xs">NULL</span>;
  if (typeof value === "number")
    return <span className="font-mono text-xs tabular-nums text-foreground">{value.toLocaleString()}</span>;
  return <span className="text-xs text-foreground">{String(value)}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DataContractWorkspace() {
  const [appId, setAppId] = useState("acacia-app-1");
  const [schemas, setSchemas] = useState<RegisteredSchema[]>([]);
  const [loadingReg, setLoadingReg] = useState(true);
  const [regError, setRegError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // selection: tableId -> Set<columnName>
  const [selection, setSelection] = useState<Map<string, Set<string>>>(new Map());
  // join selection: "fromId||toId"
  const [selectedJoins, setSelectedJoins] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [contractMsg, setContractMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeJoins, setActiveJoins] = useState<ContractJoin[]>([]);

  // preview state
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [previewJoin, setPreviewJoin] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<DataPage | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // ── Load registry ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingReg(true);
    fetch("/api/registry")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setSchemas(d.schemas ?? []);
      })
      .catch((e) => setRegError(e.message ?? "Failed to load registry"))
      .finally(() => setLoadingReg(false));
  }, []);

  const allTables = useMemo(
    () => schemas.flatMap((s) => s.tables),
    [schemas]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTables;
    return allTables.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [allTables, query]);

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleTable = useCallback((t: RegistryTable) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(t.id)) next.delete(t.id);
      else next.set(t.id, new Set(t.columns.map((c) => c.name)));
      return next;
    });
  }, []);

  const toggleColumn = useCallback((tableId: string, col: string, allCols: string[]) => {
    setSelection((prev) => {
      const next = new Map(prev);
      const cols = new Set(next.get(tableId) ?? []);
      if (cols.has(col)) cols.delete(col);
      else cols.add(col);
      if (cols.size === 0) next.delete(tableId);
      else next.set(tableId, cols);
      return next;
    });
  }, []);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedTables = useMemo(
    () => allTables.filter((t) => selection.has(t.id)),
    [allTables, selection]
  );
  const totalColumns = useMemo(
    () => [...selection.values()].reduce((n, s) => n + s.size, 0),
    [selection]
  );

  // FK relationships available between currently-selected tables.
  const availableJoins = useMemo(() => {
    const selectedIds = new Set([...selection.keys()].map((k) => k.toLowerCase()));
    const out: { key: string; fromId: string; toId: string; fromShort: string; toShort: string }[] = [];
    const seen = new Set<string>();
    for (const t of allTables) {
      if (!selection.has(t.id)) continue;
      for (const r of t.relationships ?? []) {
        if (!selectedIds.has(r.toTable.toLowerCase())) continue;
        const key = `${t.id}||${r.toTable}`;
        const rev = `${r.toTable}||${t.id}`;
        if (seen.has(key) || seen.has(rev)) continue;
        seen.add(key);
        const toTbl = allTables.find((x) => x.id.toLowerCase() === r.toTable.toLowerCase());
        out.push({
          key,
          fromId: t.id,
          toId: r.toTable,
          fromShort: t.name,
          toShort: toTbl?.name ?? r.toTable.split(".").pop()!,
        });
      }
    }
    return out;
  }, [allTables, selection]);

  const toggleJoin = useCallback((key: string) => {
    setSelectedJoins((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // Drop join selections whose tables are no longer both selected.
  useEffect(() => {
    setSelectedJoins((prev) => {
      const valid = new Set(availableJoins.map((j) => j.key));
      const next = new Set([...prev].filter((k) => valid.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableJoins]);

  // ── Create contract ────────────────────────────────────────────────────────────
  async function createContract() {
    setSaving(true);
    setContractMsg(null);
    const tables = selectedTables.map((t) => ({
      name: t.id,
      allowedColumns: [...(selection.get(t.id) ?? [])],
    }));
    const joins: ContractJoin[] = [...selectedJoins]
      .filter((k) => availableJoins.some((a) => a.key === k))
      .map((k) => {
        const [fromTable, toTable] = k.split("||");
        return { fromTable, toTable, type: "FK" as const };
      });
    try {
      const res = await fetch("/api/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, tables, joins }),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body.errors
          ? body.errors.map((e: { table: string; message: string }) => `${e.table}: ${e.message}`).join(" · ")
          : body.error;
        throw new Error(detail ?? "Failed to create contract");
      }
      const joinNote = joins.length ? `, ${joins.length} join(s)` : "";
      setContractMsg({ ok: true, text: `Contract active for "${appId}" — ${tables.length} table(s), ${totalColumns} column(s)${joinNote} exposed.` });
      setActiveJoins(body.contract?.joins ?? joins);
      // Auto-preview the first table in the new contract.
      const first = tables[0]?.name ?? null;
      setPreviewTable(first);
      setPreviewJoin(null);
      setPage(1);
    } catch (e) {
      setContractMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // ── Fetch preview through the access proxy ──────────────────────────────────────
  useEffect(() => {
    if (!previewTable) return;
    setLoadingData(true);
    setDataError(null);
    const url =
      `/api/data?appId=${encodeURIComponent(appId)}&table=${encodeURIComponent(previewTable)}` +
      `&page=${page}&pageSize=${pageSize}` +
      (previewJoin ? `&join=${encodeURIComponent(previewJoin)}` : "");
    fetch(url)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? `Request failed (${r.status})`);
        return b;
      })
      .then((d: DataPage) => setData(d))
      .catch((e) => {
        setDataError((e as Error).message);
        setData(null);
      })
      .finally(() => setLoadingData(false));
  }, [previewTable, page, pageSize, appId]);

  const contractTables = useMemo(
    () => selectedTables.map((t) => t.id),
    [selectedTables]
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* App scope header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/15">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">Data Contract</p>
            <p className="text-[11px] text-muted-foreground mt-1">Scope exactly what this app can read</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
          <label htmlFor="appId" className="text-xs text-muted-foreground shrink-0">App ID</label>
          <input
            id="appId"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="flex-1 sm:w-52 bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Table registry / selection ── */}
        <div className="lg:col-span-3 bg-card border border-border rounded-lg flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Schema Registry</h2>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {allTables.length} table{allTables.length !== 1 && "s"} available
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tables or columns (e.g. patient, invoice, amount)"
                className="w-full bg-background border border-border rounded-md pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            {loadingReg && (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading registry…
              </div>
            )}
            {regError && (
              <div className="flex items-center gap-2 py-6 px-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" /> {regError}
              </div>
            )}
            {!loadingReg && !regError && filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-10">No tables match &quot;{query}&quot;.</p>
            )}

            {filtered.map((t) => {
              const isSelected = selection.has(t.id);
              const selCols = selection.get(t.id);
              const isOpen = expanded.has(t.id);
              return (
                <div key={t.id} className="mb-1 rounded-md border border-transparent hover:border-border">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      onClick={() => toggleExpand(t.id)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => toggleTable(t)}
                      className={cn(
                        "flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors",
                        isSelected ? "bg-primary border-primary" : "border-border hover:border-primary"
                      )}
                      aria-label={isSelected ? "Deselect table" : "Select table"}
                    >
                      {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>
                    <button onClick={() => toggleTable(t)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <Table2 className="w-3.5 h-3.5 text-chart-1 shrink-0" />
                      <span className="text-sm text-foreground truncate font-medium">{t.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{t.schema}</span>
                    </button>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {isSelected ? `${selCols?.size}/${t.columns.length}` : t.columns.length} cols
                    </span>
                  </div>

                  {isOpen && (
                    <div className="pl-9 pr-2 pb-2 flex flex-wrap gap-1.5">
                      {t.columns.map((c) => {
                        const on = selCols?.has(c.name) ?? false;
                        return (
                          <button
                            key={c.name}
                            onClick={() => toggleColumn(t.id, c.name, t.columns.map((x) => x.name))}
                            className={cn(
                              "flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border transition-colors",
                              on
                                ? "bg-primary/15 border-primary/40 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            )}
                            title={c.type}
                          >
                            {on && <Check className="w-2.5 h-2.5" />}
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scope summary ── */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg flex flex-col">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-chart-3" />
            <h2 className="text-sm font-semibold text-foreground">Scope Summary</h2>
          </div>
          <div className="p-4 flex-1 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background border border-border rounded-md p-3">
                <p className="text-2xl font-semibold text-foreground tabular-nums">{selectedTables.length}</p>
                <p className="text-[11px] text-muted-foreground">Tables exposed</p>
              </div>
              <div className="bg-background border border-border rounded-md p-3">
                <p className="text-2xl font-semibold text-foreground tabular-nums">{totalColumns}</p>
                <p className="text-[11px] text-muted-foreground">Columns exposed</p>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto max-h-40 flex flex-col gap-1.5">
              {selectedTables.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Select tables to build the contract. Everything else stays hidden.
                </p>
              ) : (
                selectedTables.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs bg-background border border-border rounded px-2 py-1.5">
                    <Table2 className="w-3 h-3 text-chart-1 shrink-0" />
                    <span className="text-foreground truncate flex-1">{t.id}</span>
                    <span className="text-muted-foreground">{selection.get(t.id)?.size} cols</span>
                    <button onClick={() => toggleTable(t)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={createContract}
              disabled={selectedTables.length === 0 || saving}
              className="flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
              Create Data Contract
            </button>

            {contractMsg && (
              <div
                className={cn(
                  "flex items-start gap-2 text-xs rounded-md px-2.5 py-2 border",
                  contractMsg.ok
                    ? "bg-chart-3/10 border-chart-3/30 text-chart-3"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                )}
              >
                {contractMsg.ok ? <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                <span>{contractMsg.text}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Data preview (single-table, through the access proxy) ── */}
      {contractMsg?.ok && contractTables.length > 0 && (
        <div className="bg-card border border-border rounded-lg flex flex-col">
          <div className="p-4 border-b border-border flex flex-wrap items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Contract Preview</h2>
            {data && (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  data.source === "live_db" ? "bg-chart-3/15 text-chart-3" : "bg-chart-5/15 text-chart-5"
                )}
              >
                {data.source === "live_db" ? "Live DB" : "Demo data"}
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto flex-wrap">
              {contractTables.map((tid) => {
                const short = tid.split(".").pop();
                const active = previewTable?.toLowerCase() === tid.toLowerCase();
                return (
                  <button
                    key={tid}
                    onClick={() => { setPreviewTable(tid); setPage(1); }}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-md border transition-colors",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary font-medium"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            {loadingData && (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Querying through access proxy…
              </div>
            )}
            {dataError && (
              <div className="flex items-center gap-2 py-8 px-4 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" /> {dataError}
              </div>
            )}
            {!loadingData && !dataError && data && (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    {data.columns.map((c) => (
                      <th key={c} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-accent/40">
                      {data.columns.map((c) => (
                        <td key={c} className="px-3 py-2 whitespace-nowrap">
                          <Cell value={row[c]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={data.columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No rows on this page.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {data && !dataError && (
            <div className="flex flex-wrap items-center gap-3 p-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {data.total.toLocaleString()} rows · page {data.page} of {data.totalPages}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>{s} / page</option>
                  ))}
                </select>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1 || loadingData}
                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={data.page >= data.totalPages || loadingData}
                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
