// ─────────────────────────────────────────────────────────────────────────────
// Contract Service — Access-Proxy Layer (Phase 1)
//
//   Schema Registry → [Data Contracts] → Access Proxy API → Read-Only DB
//
// A Data Contract is the security boundary: it declares exactly which tables
// and which columns an app may read. The Access Proxy refuses anything not in
// the contract, so the frontend never sees the full database.
//
//   createContract("acacia-app-1", [
//     { name: "patients", allowedColumns: ["id", "name", "dob"] },
//     { name: "invoices", allowedColumns: ["id", "amount", "created_at"] },
//   ]);
// ─────────────────────────────────────────────────────────────────────────────

import { findTable, findRelationship } from "./schemaRegistry";

export interface ContractTable {
  /** Table id or name — must exist in the schema registry. */
  name: string;
  allowedColumns: string[];
}

export type RelationshipType = "FK";

/**
 * A join the app is allowed to perform. Both tables must be in the contract
 * and an FK relationship must exist between them in the schema registry.
 */
export interface ContractJoin {
  fromTable: string;
  toTable: string;
  type: RelationshipType;
}

export interface DataContract {
  appId: string;
  tables: ContractTable[];
  joins: ContractJoin[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractValidationError {
  table: string;
  message: string;
}

// ── Singleton store (survives hot-reload) ───────────────────────────────────────

const globalForContracts = globalThis as unknown as {
  __data_contracts?: Map<string, DataContract>;
};

function store(): Map<string, DataContract> {
  if (!globalForContracts.__data_contracts) {
    globalForContracts.__data_contracts = new Map();
  }
  return globalForContracts.__data_contracts;
}

// ── Validation ───────────────────────────────────────────────────────────────────

/**
 * Validate a proposed contract against the schema registry.
 * Every table must exist and every allowed column must exist on that table.
 * Returns [] when valid.
 */
export async function validateContract(
  tables: ContractTable[]
): Promise<ContractValidationError[]> {
  const errors: ContractValidationError[] = [];

  if (!Array.isArray(tables) || tables.length === 0) {
    return [{ table: "*", message: "Contract must include at least one table." }];
  }

  for (const t of tables) {
    if (!t?.name) {
      errors.push({ table: String(t?.name ?? "?"), message: "Missing table name." });
      continue;
    }
    if (!Array.isArray(t.allowedColumns) || t.allowedColumns.length === 0) {
      errors.push({ table: t.name, message: "At least one allowed column is required." });
      continue;
    }

    const known = await findTable(t.name);
    if (!known) {
      errors.push({ table: t.name, message: "Table not found in schema registry." });
      continue;
    }

    const knownCols = new Set(known.columns.map((c) => c.name.toLowerCase()));
    const unknown = t.allowedColumns.filter((c) => !knownCols.has(c.toLowerCase()));
    if (unknown.length > 0) {
      errors.push({
        table: t.name,
        message: `Unknown column(s): ${unknown.join(", ")}`,
      });
    }
  }

  return errors;
}

/**
 * Validate proposed joins: every join must connect two tables that are both
 * in the contract AND have a real FK relationship in the schema registry.
 */
export async function validateJoins(
  tables: ContractTable[],
  joins: ContractJoin[]
): Promise<ContractValidationError[]> {
  if (!Array.isArray(joins) || joins.length === 0) return [];

  const errors: ContractValidationError[] = [];
  const inContract = new Set(tables.map((t) => t.name.toLowerCase()));
  const shortInContract = new Set(
    tables.map((t) => t.name.split(".").pop()!.toLowerCase())
  );

  const isInContract = (name: string) =>
    inContract.has(name.toLowerCase()) ||
    shortInContract.has(name.split(".").pop()!.toLowerCase());

  for (const j of joins) {
    const label = `${j.fromTable} ⋈ ${j.toTable}`;
    if (!j?.fromTable || !j?.toTable) {
      errors.push({ table: label, message: "Join must specify fromTable and toTable." });
      continue;
    }
    if (!isInContract(j.fromTable) || !isInContract(j.toTable)) {
      errors.push({ table: label, message: "Both joined tables must be in the contract." });
      continue;
    }
    const rel = await findRelationship(j.fromTable, j.toTable);
    if (!rel) {
      errors.push({ table: label, message: "No FK relationship exists between these tables." });
    }
  }

  return errors;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────────

/**
 * Create or replace a scoped data contract for an app.
 * Throws if validation fails.
 */
export async function createContract(
  appId: string,
  tables: ContractTable[],
  joins: ContractJoin[] = []
): Promise<DataContract> {
  if (!appId) throw new Error("appId is required");

  const errors = [
    ...(await validateContract(tables)),
    ...(await validateJoins(tables, joins)),
  ];
  if (errors.length > 0) {
    throw new Error(
      `Contract validation failed: ${errors.map((e) => `${e.table} — ${e.message}`).join("; ")}`
    );
  }

  // Normalize table ids to their registry-canonical form.
  const normalized: ContractTable[] = [];
  for (const t of tables) {
    const known = await findTable(t.name);
    normalized.push({
      name: known!.id,
      allowedColumns: [...new Set(t.allowedColumns)],
    });
  }

  // Normalize join endpoints to canonical ids and de-duplicate.
  const normalizedJoins: ContractJoin[] = [];
  const seen = new Set<string>();
  for (const j of joins) {
    const from = await findTable(j.fromTable);
    const to = await findTable(j.toTable);
    if (!from || !to) continue;
    const key = `${from.id.toLowerCase()}::${to.id.toLowerCase()}`;
    const keyRev = `${to.id.toLowerCase()}::${from.id.toLowerCase()}`;
    if (seen.has(key) || seen.has(keyRev)) continue;
    seen.add(key);
    normalizedJoins.push({ fromTable: from.id, toTable: to.id, type: "FK" });
  }

  const now = new Date().toISOString();
  const existing = store().get(appId);
  const contract: DataContract = {
    appId,
    tables: normalized,
    joins: normalizedJoins,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store().set(appId, contract);
  return contract;
}

/** Get a contract by appId, or null if none exists. */
export function getContract(appId: string): DataContract | null {
  return store().get(appId) ?? null;
}

/** List every contract (for admin/registry views). */
export function listContracts(): DataContract[] {
  return Array.from(store().values());
}

/** Delete a contract. Returns true if one was removed. */
export function deleteContract(appId: string): boolean {
  return store().delete(appId);
}

/**
 * Resolve the allowed columns for a table within a contract.
 * Returns null when the table is not part of the contract (access denied).
 */
export function allowedColumnsFor(
  contract: DataContract,
  table: string
): string[] | null {
  const lower = table.toLowerCase();
  const entry = contract.tables.find(
    (t) => t.name.toLowerCase() === lower || t.name.split(".").pop()!.toLowerCase() === lower
  );
  return entry ? entry.allowedColumns : null;
}

/**
 * Whether the contract authorizes joining two tables (either direction).
 * The Access Proxy calls this before ever assembling a joined query.
 */
export function isJoinAllowed(
  contract: DataContract,
  aTable: string,
  bTable: string
): boolean {
  const a = aTable.toLowerCase();
  const aShort = aTable.split(".").pop()!.toLowerCase();
  const b = bTable.toLowerCase();
  const bShort = bTable.split(".").pop()!.toLowerCase();
  const matches = (name: string, full: string, short: string) => {
    const n = name.toLowerCase();
    return n === full || n.split(".").pop() === short;
  };
  return (contract.joins ?? []).some(
    (j) =>
      (matches(j.fromTable, a, aShort) && matches(j.toTable, b, bShort)) ||
      (matches(j.fromTable, b, bShort) && matches(j.toTable, a, aShort))
  );
}
