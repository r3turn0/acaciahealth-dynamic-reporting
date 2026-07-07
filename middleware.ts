/**
 * middleware.ts
 * Protects /dashboard/* and /api/protected/* routes.
 * Unauthenticated requests are redirected to /login.
 * Uses next-auth withAuth() — validates the JWT stored in the HTTP-only cookie.
 */
import withAuth from "next-auth/middleware";

// Re-export the next-auth middleware as an explicit named `middleware` function
// so Next.js 16's build-time analyzer can detect the function export.
export default withAuth;

export const config = {
  matcher: ["/dashboard/:path*", "/api/protected/:path*"],
};
