/**
 * /app/api/auth/[...nextauth]/route.ts
 * Auth.js v4 — Azure AD (Microsoft Entra ID) primary provider.
 *
 * In production (AZURE_AD_CLIENT_ID present): Azure AD SSO only.
 * In development / preview (AZURE_AD_CLIENT_ID absent): a CredentialsProvider
 * bypass is activated so the app is usable without real Azure credentials.
 * The bypass accepts any non-empty email + password and mints a local session.
 */

import NextAuth, { type AuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";

const isAzureConfigured =
  !!process.env.AZURE_AD_CLIENT_ID &&
  !!process.env.AZURE_AD_CLIENT_SECRET &&
  !!process.env.AZURE_AD_TENANT_ID;

const isDev = process.env.NODE_ENV === "development" || !isAzureConfigured;

// ─── Provider list ────────────────────────────────────────────────────────────
const providers: AuthOptions["providers"] = [];

if (isAzureConfigured) {
  providers.push(
    AzureADProvider({
      clientId:     process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId:     process.env.AZURE_AD_TENANT_ID!,
    })
  );
}

if (isDev) {
  /**
   * Dev / preview bypass — accepts any non-empty email + password.
   * Signs in as "Demo Analyst" so every UI surface is reachable.
   * This provider is NEVER registered when AZURE_AD_CLIENT_ID is present.
   */
  providers.push(
    CredentialsProvider({
      id: "dev-bypass",
      name: "Dev Login",
      credentials: {
        email:    { label: "Email",    type: "email",    placeholder: "analyst@demo.local" },
        password: { label: "Password", type: "password", placeholder: "Any password" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        return {
          id:    "dev-user-001",
          name:  "Demo Analyst",
          email: credentials.email,
          image: null,
          // Extra fields surfaced via JWT callback below
          role:  "analyst",
          roles: ["Analyst"],
        };
      },
    })
  );
}

// ─── Auth options ─────────────────────────────────────────────────────────────
export const authOptions: AuthOptions = {
  providers,

  session: {
    strategy: "jwt",
    maxAge:   8 * 60 * 60, // 8-hour sessions
  },

  callbacks: {
    async jwt({ token, account, user }) {
      // Azure AD: persist provider tokens into the JWT on initial sign-in
      if (account?.id_token) {
        token.accessToken = account.access_token;
        token.idToken     = account.id_token;
        try {
          const payload = JSON.parse(
            Buffer.from(account.id_token.split(".")[1], "base64url").toString()
          );
          token.roles = payload.roles ?? payload.wids ?? [];
        } catch {
          token.roles = [];
        }
      }
      // Dev bypass: copy role fields from the authorize() return value
      if (user && "role" in user) {
        token.role  = (user as { role?: string }).role  ?? "analyst";
        token.roles = (user as { roles?: string[] }).roles ?? ["Analyst"];
      }
      return token;
    },

    async session({ session, token }) {
      return {
        ...session,
        accessToken: token.accessToken as string | undefined,
        roles:       token.roles       as string[] | undefined,
        user: {
          ...session.user,
          id:   token.sub,
          role: token.role as string | undefined,
        },
      };
    },
  },

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  // Keep local development deterministic even when NEXTAUTH_SECRET is absent.
  // Production must still provide a strong secret through the environment.
  secret: process.env.NEXTAUTH_SECRET ?? (isDev ? "acacia-local-development-only-secret" : undefined),

  debug: false,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
