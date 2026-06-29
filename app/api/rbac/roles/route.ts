import { NextRequest, NextResponse } from "next/server";

export const ROLES = [
  {
    id: "role_admin",
    name: "Admin",
    description: "Full system access. Manage roles, policies, users, and break-glass access.",
    level: "privileged",
    permissions: ["reports.*", "audit.*", "rbac.*", "policy.*", "break_glass"],
    datasets: ["*"],
    mfa_required: "AAL3",
    sod_conflicts: [],
    users: 2,
  },
  {
    id: "role_analyst",
    name: "Analyst",
    description: "Read and write reports. Access to assigned clinical datasets.",
    level: "standard",
    permissions: ["reports.read", "reports.write", "kpi.read", "schema.read"],
    datasets: ["admissions", "census", "discharges", "revenue"],
    mfa_required: "AAL2",
    sod_conflicts: ["role_auditor"],
    users: 14,
  },
  {
    id: "role_auditor",
    name: "Auditor",
    description: "Read-only access to audit logs and compliance reports. Cannot modify data.",
    level: "standard",
    permissions: ["audit.read", "reports.read", "policy.read"],
    datasets: ["audit_logs", "access_logs"],
    mfa_required: "AAL2",
    sod_conflicts: ["role_analyst"],
    users: 3,
  },
  {
    id: "role_viewer",
    name: "Viewer",
    description: "Read-only access to approved dashboards and summary reports.",
    level: "basic",
    permissions: ["reports.read"],
    datasets: ["census", "admissions"],
    mfa_required: "AAL2",
    sod_conflicts: [],
    users: 28,
  },
];

export const USERS = [
  { id: "usr_a1b2c3", name: "Dr. Alex Donovan", email: "adonovan@acaciahealth.org", role: "Analyst", department: "Clinical Analytics", last_login: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), mfa: "TOTP", status: "active" },
  { id: "usr_b2c3d4", name: "Maria Chen", email: "mchen@acaciahealth.org", role: "Admin", department: "IT Security", last_login: new Date(Date.now() - 30 * 60 * 1000).toISOString(), mfa: "FIDO2", status: "active" },
  { id: "usr_c3d4e5", name: "James Okafor", email: "jokafor@acaciahealth.org", role: "Auditor", department: "Compliance", last_login: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), mfa: "Push", status: "active" },
  { id: "usr_d4e5f6", name: "Sarah Kim", email: "skim@acaciahealth.org", role: "Viewer", department: "Executive", last_login: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), mfa: "TOTP", status: "active" },
  { id: "usr_e5f6g7", name: "Marcus Webb", email: "mwebb@acaciahealth.org", role: "Analyst", department: "Finance", last_login: new Date(Date.now() - 8 * 3600 * 1000).toISOString(), mfa: "TOTP", status: "suspended" },
];

export const CA_POLICIES = [
  { id: "cap_001", name: "Require MFA — All Users", enabled: true, conditions: "All users, all apps", grant: "Require MFA (AAL2)", last_modified: "2024-11-15" },
  { id: "cap_002", name: "Block Non-Compliant Devices", enabled: true, conditions: "Device: Intune non-compliant", grant: "Block access", last_modified: "2024-10-22" },
  { id: "cap_003", name: "Require VPN — External Access", enabled: true, conditions: "Network: outside corporate IP range", grant: "Require compliant network", last_modified: "2025-01-08" },
  { id: "cap_004", name: "Privileged Role Step-Up (AAL3)", enabled: true, conditions: "Role: Admin, accessing /admin/*", grant: "Require FIDO2 or hardware key", last_modified: "2025-03-01" },
  { id: "cap_005", name: "Session Timeout — 60 min inactivity", enabled: true, conditions: "All users", grant: "Sign-out after 60 min idle", last_modified: "2024-09-14" },
];

export async function GET() {
  return NextResponse.json({ roles: ROLES, users: USERS, ca_policies: CA_POLICIES });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  await new Promise((r) => setTimeout(r, 300));
  return NextResponse.json({ updated: true, ...body, modified_at: new Date().toISOString() });
}
