import { NextRequest, NextResponse } from "next/server";

// Demo credential store — in production these would be validated against Azure AD / directory
const DEMO_USERS: Record<string, { password: string; user: object }> = {
  "admin@acaciahealth.org": {
    password: "admin123",
    user: {
      id: "usr_admin_001",
      name: "Dr. Sarah Mitchell",
      email: "admin@acaciahealth.org",
      role: "Admin",
      department: "Health Information Management",
      device_compliant: true,
      last_login: new Date().toISOString(),
    },
  },
  "analyst@acaciahealth.org": {
    password: "analyst123",
    user: {
      id: "usr_analyst_001",
      name: "Dr. Alex Donovan",
      email: "analyst@acaciahealth.org",
      role: "Analyst",
      department: "Clinical Analytics",
      device_compliant: true,
      last_login: new Date().toISOString(),
    },
  },
};

// Simulate network/device checks (always pass in demo — set to false to test blocked states)
const DEVICE_COMPLIANT = true;
const NETWORK_ALLOWED = true;

function conditionalAccessChecks() {
  if (!DEVICE_COMPLIANT) {
    return NextResponse.json(
      { error: "DEVICE_NON_COMPLIANT", message: "Device does not meet Intune compliance policy." },
      { status: 403 }
    );
  }
  if (!NETWORK_ALLOWED) {
    return NextResponse.json(
      { error: "NETWORK_NOT_ALLOWED", message: "Access is restricted to the corporate network." },
      { status: 403 }
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { method, token, mfa_code, email, password } = body as {
    method?: string;
    token?: string;
    mfa_code?: string;
    email?: string;
    password?: string;
  };

  // Simulate auth latency
  await new Promise((r) => setTimeout(r, 500));

  const blocked = conditionalAccessChecks();
  if (blocked) return blocked;

  // ── SSO / Passwordless (no credentials needed — simulates Entra ID token validation) ──
  if (method === "sso" || method === "passwordless") {
    const aal = method === "passwordless" ? "AAL3" : "AAL2";
    const mfaLabel = method === "passwordless" ? "FIDO2 / Passkey" : "Azure AD SSO";
    return NextResponse.json({
      access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock",
      token_type: "Bearer",
      expires_in: 3600,
      user: {
        id: "usr_sso_001",
        name: "Dr. Sarah Mitchell",
        email: "smitchell@acaciahealth.org",
        role: "Admin",
        department: "Health Information Management",
        mfa_method: mfaLabel,
        aal,
        device_compliant: true,
        last_login: new Date().toISOString(),
      },
      session_id: `sess_${Math.random().toString(36).slice(2, 10)}`,
    });
  }

  // ── Email + password (credential validation step) ─────────────────────────────
  if (method === "credentials") {
    if (!email || !password) {
      return NextResponse.json(
        { error: "INVALID_CREDENTIALS", message: "Email and password are required." },
        { status: 400 }
      );
    }
    const record = DEMO_USERS[email.toLowerCase()];
    if (!record || record.password !== password) {
      return NextResponse.json(
        { error: "INVALID_CREDENTIALS", message: "Invalid email or password." },
        { status: 401 }
      );
    }
    // Credentials OK — client proceeds to MFA step
    return NextResponse.json({ ok: true, mfa_required: true });
  }

  // ── MFA verification (totp / push / fido2) ────────────────────────────────────
  if (method === "totp" || method === "push" || method === "fido2") {
    // In demo mode: any 6-digit code or the "mock_approved" sentinel is accepted
    const codeOk = mfa_code === "mock_approved" || /^\d{6}$/.test(mfa_code ?? "");
    if (!codeOk) {
      return NextResponse.json(
        { error: "MFA_FAILED", message: "Invalid code. Please try again." },
        { status: 401 }
      );
    }

    const aal = method === "fido2" ? "AAL3" : "AAL2";
    const mfaLabel: Record<string, string> = {
      totp: "Authenticator App (TOTP)",
      push: "Push Notification",
      fido2: "Hardware Key (FIDO2)",
    };

    // Resolve the user — email was sent alongside mfa_code in MFA step
    const record = email ? DEMO_USERS[email.toLowerCase()] : null;
    const baseUser = record?.user as Record<string, unknown> | undefined;

    return NextResponse.json({
      access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock",
      token_type: "Bearer",
      expires_in: 3600,
      user: {
        id: baseUser?.id ?? "usr_a1b2c3d4",
        name: baseUser?.name ?? "Dr. Alex Donovan",
        email: baseUser?.email ?? email ?? "adonovan@acaciahealth.org",
        role: baseUser?.role ?? "Analyst",
        department: baseUser?.department ?? "Clinical Analytics",
        mfa_method: mfaLabel[method] ?? method,
        aal,
        device_compliant: true,
        last_login: new Date().toISOString(),
      },
      session_id: `sess_${Math.random().toString(36).slice(2, 10)}`,
    });
  }

  return NextResponse.json({ error: "INVALID_METHOD", message: "Unknown auth method." }, { status: 400 });
}
