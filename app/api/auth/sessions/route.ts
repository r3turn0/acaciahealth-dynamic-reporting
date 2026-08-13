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
  if (email.length > 254 || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  return NextResponse.json({ sessions: buildSessions(email), authoritative: false });
}

export async function DELETE(req: NextRequest) {
  const { session_id } = await req.json().catch(() => ({})) as { session_id?: unknown };
  if (typeof session_id !== "string" || !/^sess_[a-z0-9]+$/i.test(session_id)) {
    return NextResponse.json({ error: "A valid session_id is required" }, { status: 400 });
  }
  const session = buildSessions("user@acaciahealth.org").find((candidate) => candidate.id === session_id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.current) return NextResponse.json({ error: "The current browser session cannot be revoked from this inventory" }, { status: 409 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return NextResponse.json({
    revoked: session_id,
    authoritative: false,
    message: "Session removed from the reporting inventory. Configure an identity-provider integration for authoritative revocation.",
  });
}
