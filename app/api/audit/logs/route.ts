import { NextRequest, NextResponse } from "next/server";

type Severity = "info" | "warn" | "critical";
type Category = "auth" | "access" | "admin" | "policy" | "anomaly";

interface AuditEntry {
  id: string;
  timestamp: string;
  category: Category;
  event: string;
  user: string;
  role: string;
  resource: string;
  ip: string;
  location: string;
  device: string;
  result: "success" | "failure" | "blocked";
  severity: Severity;
  details: string;
  immutable: boolean;
}

function ts(offsetMs: number) {
  return new Date(Date.now() - offsetMs).toISOString();
}

const AUDIT_LOG: AuditEntry[] = [
  { id: "evt_001", timestamp: ts(2 * 60000), category: "auth", event: "LOGIN_SUCCESS", user: "adonovan@acaciahealth.org", role: "Analyst", resource: "/", ip: "10.0.1.44", location: "Los Angeles, CA", device: "MacBook Pro — Chrome 125", result: "success", severity: "info", details: "AAL2 satisfied via TOTP. Device compliant (Intune). VPN connected.", immutable: true },
  { id: "evt_002", timestamp: ts(4 * 60000), category: "access", event: "REPORT_RUN", user: "adonovan@acaciahealth.org", role: "Analyst", resource: "admissions:weekly_by_branch", ip: "10.0.1.44", location: "Los Angeles, CA", device: "MacBook Pro — Chrome 125", result: "success", severity: "info", details: "Query executed. 42 rows returned. SQL validated, no injection risk.", immutable: true },
  { id: "evt_003", timestamp: ts(12 * 60000), category: "auth", event: "MFA_CHALLENGE", user: "mwebb@acaciahealth.org", role: "Analyst", resource: "/auth/mfa", ip: "198.51.100.22", location: "Unknown", device: "Unknown Windows — Edge", result: "failure", severity: "warn", details: "TOTP code invalid. 2nd consecutive failure. Account lockout threshold: 5.", immutable: true },
  { id: "evt_004", timestamp: ts(18 * 60000), category: "anomaly", event: "IMPOSSIBLE_TRAVEL", user: "adonovan@acaciahealth.org", role: "Analyst", resource: "/auth", ip: "203.0.113.88", location: "Tokyo, JP", device: "Unknown Android", result: "blocked", severity: "critical", details: "Login attempt from Tokyo, JP — 8 hours after LA session. Step-up required. Session blocked by CAE.", immutable: true },
  { id: "evt_005", timestamp: ts(25 * 60000), category: "admin", event: "ROLE_MODIFIED", user: "mchen@acaciahealth.org", role: "Admin", resource: "rbac:role_analyst", ip: "10.0.0.12", location: "Los Angeles, CA", device: "MacBook Air — Safari 17", result: "success", severity: "warn", details: "Analyst role datasets updated: added 'revenue'. Change logged for SoD review.", immutable: true },
  { id: "evt_006", timestamp: ts(40 * 60000), category: "policy", event: "CA_POLICY_UPDATED", user: "mchen@acaciahealth.org", role: "Admin", resource: "policy:cap_003", ip: "10.0.0.12", location: "Los Angeles, CA", device: "MacBook Air — Safari 17", result: "success", severity: "warn", details: "Conditional Access Policy 'Require VPN — External Access' updated. Previous config archived.", immutable: true },
  { id: "evt_007", timestamp: ts(55 * 60000), category: "auth", event: "SESSION_REVOKED", user: "mchen@acaciahealth.org", role: "Admin", resource: "session:sess_i9j0k1l2", ip: "10.0.0.12", location: "Los Angeles, CA", device: "MacBook Air — Safari 17", result: "success", severity: "info", details: "Admin revoked high-risk session (Seattle, WA — no VPN). User notified via email.", immutable: true },
  { id: "evt_008", timestamp: ts(70 * 60000), category: "access", event: "UNAUTHORIZED_DATASET", user: "skim@acaciahealth.org", role: "Viewer", resource: "dataset:revenue", ip: "10.0.2.88", location: "Los Angeles, CA", device: "iPad — Safari 17", result: "blocked", severity: "warn", details: "Viewer role attempted access to 'revenue' dataset. Permission boundary enforced. Access denied.", immutable: true },
  { id: "evt_009", timestamp: ts(90 * 60000), category: "admin", event: "BREAK_GLASS_USED", user: "mchen@acaciahealth.org", role: "Admin", resource: "break_glass:bg_20250629", ip: "10.0.0.12", location: "Los Angeles, CA", device: "MacBook Air — Safari 17", result: "success", severity: "critical", details: "Break-glass emergency access invoked. Reason: 'Production incident — data pipeline failure'. 2nd approver: jokafor@acaciahealth.org. Auto-expires in 4h.", immutable: true },
  { id: "evt_010", timestamp: ts(110 * 60000), category: "auth", event: "STEP_UP_AUTH", user: "mchen@acaciahealth.org", role: "Admin", resource: "/admin/security", ip: "10.0.0.12", location: "Los Angeles, CA", device: "MacBook Air — Safari 17", result: "success", severity: "info", details: "AAL3 step-up required for admin console access. FIDO2 hardware key verified.", immutable: true },
  { id: "evt_011", timestamp: ts(3 * 3600 * 1000), category: "access", event: "REPORT_RUN", user: "jokafor@acaciahealth.org", role: "Auditor", resource: "dataset:audit_logs", ip: "10.0.3.14", location: "Los Angeles, CA", device: "Windows 11 — Chrome 125", result: "success", severity: "info", details: "Compliance audit query. 128 rows returned. Read-only access confirmed.", immutable: true },
  { id: "evt_012", timestamp: ts(5 * 3600 * 1000), category: "anomaly", event: "PRIVILEGE_ESCALATION", user: "mwebb@acaciahealth.org", role: "Analyst", resource: "/admin", ip: "10.0.1.99", location: "Los Angeles, CA", device: "Windows 11 — Edge 124", result: "blocked", severity: "critical", details: "Analyst attempted to access /admin/security. SoD policy violation. Account flagged for review.", immutable: true },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const user = searchParams.get("user");
  const role = searchParams.get("role");
  const category = searchParams.get("category") as Category | null;
  const severity = searchParams.get("severity") as Severity | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let entries = [...AUDIT_LOG];

  if (user) entries = entries.filter((e) => e.user.toLowerCase().includes(user.toLowerCase()));
  if (role) entries = entries.filter((e) => e.role.toLowerCase() === role.toLowerCase());
  if (category) entries = entries.filter((e) => e.category === category);
  if (severity) entries = entries.filter((e) => e.severity === severity);
  if (from) entries = entries.filter((e) => new Date(e.timestamp) >= new Date(from));
  if (to) entries = entries.filter((e) => new Date(e.timestamp) <= new Date(to));

  return NextResponse.json({
    entries,
    total: entries.length,
    retention_policy: "6 years (HIPAA §164.312)",
    immutable: true,
    siem: "Azure Sentinel",
    exported_at: new Date().toISOString(),
  });
}
