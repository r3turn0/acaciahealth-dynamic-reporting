/**
 * middleware.ts
 *
 * Dev / preview (AZURE_AD_CLIENT_ID absent): all requests pass through.
 * The app's /api/auth/validate flow handles login in this mode and
 * NEXTAUTH_SECRET is not required.
 *
 * Production (AZURE_AD_CLIENT_ID present): manually checks for a valid
 * next-auth JWT using getToken and redirects to /login when missing.
 *
 * Public paths always bypass auth:
 *   /api/auth/*  — NextAuth callbacks / CSRF
 *   /api/health  — uptime probe
 *   /login       — login page
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PREFIXES = ["/api/auth/", "/api/health", "/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

const isAzureConfigured =
  !!process.env.AZURE_AD_CLIENT_ID &&
  !!process.env.AZURE_AD_CLIENT_SECRET &&
  !!process.env.AZURE_AD_TENANT_ID;

export default async function middleware(req: NextRequest) {
  // Dev / preview: no auth check needed
  if (!isAzureConfigured) return NextResponse.next();

  // Public paths: always allow
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  // Production: verify next-auth JWT
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
