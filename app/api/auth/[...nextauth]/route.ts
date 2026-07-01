/**
 * /app/api/auth/[...nextauth]/route.ts
 * Auth.js v4 — Azure AD (Microsoft Entra ID) provider, stateless JWT only.
 * No database adapter. Tokens stored in HTTP-only cookies.
 */

import NextAuth, { type AuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

export const authOptions: AuthOptions = {
  // ─── Provider ────────────────────────────────────────────────────────────
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!, // single-tenant restriction
    }),
  ],

  // ─── Session ─────────────────────────────────────────────────────────────
  session: {
    strategy: "jwt", // stateless — no DB adapter
    maxAge: 8 * 60 * 60, // 8-hour sessions
  },

  // ─── JWT callbacks ────────────────────────────────────────────────────────
  callbacks: {
    async jwt({ token, account }) {
      // On initial sign-in, persist provider tokens into the JWT
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        // Extract role claims from the Azure AD ID token if present
        if (account.id_token) {
          try {
            const payload = JSON.parse(
              Buffer.from(account.id_token.split(".")[1], "base64url").toString()
            );
            token.roles = payload.roles ?? payload.wids ?? [];
          } catch {
            token.roles = [];
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      // Expose accessToken and roles to the client session object
      return {
        ...session,
        accessToken: token.accessToken as string | undefined,
        roles: token.roles as string[] | undefined,
        user: {
          ...session.user,
          id: token.sub,
        },
      };
    },
  },

  // ─── Pages ────────────────────────────────────────────────────────────────
  pages: {
    signIn: "/login",
    error: "/login",
  },

  // ─── Security ─────────────────────────────────────────────────────────────
  secret: process.env.NEXTAUTH_SECRET,

  debug: process.env.NODE_ENV === "development",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
