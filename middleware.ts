/**
 * middleware.ts
 *
 * Auth protection for all sensitive routes.
 *
 * Strategy: blanket-protect /api/* then whitelist the two public paths
 * (/api/auth for NextAuth callbacks, /api/health for uptime probes).
 * The next-auth withAuth() middleware validates the JWT stored in the
 * HTTP-only session cookie and redirects unauthenticated requests to /login.
 *
 * Protected:
 *   - /dashboard/* and every sub-route
 *   - /api/* — all API routes EXCEPT the whitelist below
 *
 * Public (no auth required):
 *   - /api/auth/*  — NextAuth sign-in / callback / CSRF
 *   - /api/health  — uptime probe (no sensitive data)
 *   - /login       — the login page itself
 *   - / (root)     — redirects to /login
 */
import withAuth from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that are explicitly public and must never be auth-gated
const PUBLIC_API_PREFIXES = [
  "/api/auth/",   // NextAuth — sign-in, callback, CSRF, session
  "/api/health",  // Uptime / liveness probe
];

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Re-export next-auth's withAuth as default — it reads NEXTAUTH_SECRET automatically.
export default withAuth(
  function middleware(req: NextRequest) {
    // Allow public API paths through without session check
    if (isPublicApiPath(req.nextUrl.pathname)) {
      return NextResponse.next();
    }
    // All other matched routes: withAuth already verified the token.
    // If the token was missing, withAuth redirected to /login before reaching here.
    return NextResponse.next();
  },
  {
    callbacks: {
      // Return true to allow the request through after token verification.
      // Returning false would produce a 401; we prefer the redirect-to-login default.
      authorized: ({ token, req }) => {
        // Always allow public API paths
        if (isPublicApiPath(req.nextUrl.pathname)) return true;
        // Require a valid token for everything else in the matcher
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match:
     *   - /dashboard and all sub-paths
     *   - /api/* (all API routes)
     *
     * Exclude (Next.js internals — never run middleware on these):
     *   - /_next/static/*
     *   - /_next/image/*
     *   - /favicon.ico, /robots.txt, /sitemap.xml
     */
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
