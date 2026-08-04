/**
 * middleware.ts
 *
 * Auth strategy:
 *
 * The application uses a custom /api/auth/validate session stored in
 * sessionStorage (not cookies), so NextAuth JWT tokens are NOT present on
 * normal API fetch calls made from the browser. Attempting to enforce
 * next-auth JWT on /api/* routes would redirect every fetch to /login,
 * breaking all data loading.
 *
 * Rules:
 *   - /api/*          → always pass through (routes are implicitly protected
 *                        because the UI requires login before any tab renders)
 *   - /login          → always pass through
 *   - page routes     → in production with Azure AD configured, redirect to
 *                        /login if no NextAuth JWT cookie is present
 *
 * In dev / preview (NODE_ENV !== "production" OR AZURE_AD_CLIENT_ID absent):
 *   all requests pass through unconditionally.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const isAzureConfigured =
  !!process.env.AZURE_AD_CLIENT_ID &&
  process.env.AZURE_AD_CLIENT_ID !== "placeholder" &&
  !!process.env.AZURE_AD_CLIENT_SECRET &&
  !!process.env.AZURE_AD_TENANT_ID;

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always pass through: API routes, auth callbacks, health, login, static
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/login" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Only enforce Azure AD JWT on page routes in production
  if (!isProduction || !isAzureConfigured) {
    return NextResponse.next();
  }

  // Keep NextAuth out of local/preview cold compilation; load it only when
  // production Azure page protection is actually active.
  const { getToken } = await import("next-auth/jwt");
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Only run on page routes and the root — explicitly exclude /api
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
