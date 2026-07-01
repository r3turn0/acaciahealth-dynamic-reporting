/**
 * middleware.ts
 * Protects /dashboard/* and /api/protected/* routes.
 * Unauthenticated requests are redirected to /login.
 * Uses next-auth withAuth() — validates the JWT stored in the HTTP-only cookie.
 */

export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/protected/:path*",
  ],
};
