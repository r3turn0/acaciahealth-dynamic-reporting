export const runtime = "nodejs";

// Data Contract API — create / read scoped contracts.
//
//   POST /api/contract   { appId, tables: [{ name, allowedColumns }] }  → create/replace
//   GET  /api/contract?appId=acacia-app-1                               → fetch one
//   GET  /api/contract                                                  → list all

import { NextRequest, NextResponse } from "next/server";
import {
  createContract,
  getContract,
  listContracts,
  validateContract,
  validateJoins,
  type ContractTable,
  type ContractJoin,
} from "@/lib/access/contractService";

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("appId");
  if (appId) {
    const contract = getContract(appId);
    if (!contract) {
      return NextResponse.json({ error: "No contract found" }, { status: 404 });
    }
    return NextResponse.json({ contract });
  }
  return NextResponse.json({ contracts: listContracts() });
}

export async function POST(req: NextRequest) {
  let body: { appId?: string; tables?: ContractTable[]; joins?: ContractJoin[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { appId, tables } = body;
  const joins = Array.isArray(body.joins) ? body.joins : [];
  if (!appId || !Array.isArray(tables)) {
    return NextResponse.json(
      { error: "Body must include appId and tables[]" },
      { status: 400 }
    );
  }

  // Validate tables + joins against the schema registry before persisting.
  const errors = [
    ...(await validateContract(tables)),
    ...(await validateJoins(tables, joins)),
  ];
  if (errors.length > 0) {
    return NextResponse.json({ error: "Contract validation failed", errors }, { status: 422 });
  }

  try {
    const contract = await createContract(appId, tables, joins);
    return NextResponse.json({ contract }, { status: 201 });
  } catch (err) {
    console.error("[access] /api/contract POST error:", err);
    return NextResponse.json({ error: "Failed to create contract" }, { status: 500 });
  }
}
