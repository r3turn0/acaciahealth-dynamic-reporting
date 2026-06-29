import { NextRequest, NextResponse } from "next/server";

const MOCK_SESSIONS = [
  {
    id: "sess_a1b2c3d4",
    user: "adonovan@acaciahealth.org",
    device: "MacBook Pro 14\" — Chrome 125",
    os: "macOS 14.4",
    location: "Los Angeles, CA",
    ip: "10.0.1.44",
    vpn: true,
    mfa: "TOTP",
    aal: "AAL2",
    started: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    last_active: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    expires: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    risk: "low",
    current: true,
  },
  {
    id: "sess_e5f6g7h8",
    user: "adonovan@acaciahealth.org",
    device: "iPhone 15 Pro — Safari",
    os: "iOS 17.4",
    location: "Los Angeles, CA",
    ip: "10.0.1.61",
    vpn: false,
    mfa: "Push",
    aal: "AAL2",
    started: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    last_active: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    risk: "medium",
    current: false,
  },
  {
    id: "sess_i9j0k1l2",
    user: "adonovan@acaciahealth.org",
    device: "Windows 11 — Edge 124",
    os: "Windows 11",
    location: "Seattle, WA",
    ip: "203.0.113.52",
    vpn: false,
    mfa: "TOTP",
    aal: "AAL2",
    started: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    last_active: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    expires: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    risk: "high",
    current: false,
  },
];

export async function GET() {
  return NextResponse.json({ sessions: MOCK_SESSIONS });
}

export async function DELETE(req: NextRequest) {
  const { session_id } = await req.json().catch(() => ({}));
  await new Promise((r) => setTimeout(r, 400));
  return NextResponse.json({ revoked: session_id, message: "Session revoked. User will be prompted to re-authenticate." });
}
