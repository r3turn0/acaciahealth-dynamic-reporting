import { NextRequest, NextResponse } from "next/server";

function buildSessions(email: string) {
  return [
    {
      id: "sess_a1b2c3d4",
      user: email,
      device: "MacBook Pro 14\u2033 \u2014 Chrome 125",
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
      user: email,
      device: "iPhone 15 Pro \u2014 Safari",
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
      user: email,
      device: "Windows 11 \u2014 Edge 124",
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
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "user@acaciahealth.org";
  return NextResponse.json({ sessions: buildSessions(email) });
}

export async function DELETE(req: NextRequest) {
  const { session_id } = await req.json().catch(() => ({}));
  await new Promise((r) => setTimeout(r, 400));
  return NextResponse.json({
    revoked: session_id,
    message: "Session revoked. User will be prompted to re-authenticate.",
  });
}
