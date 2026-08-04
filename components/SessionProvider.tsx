"use client";

/**
 * components/SessionProvider.tsx
 * Thin client wrapper so the next-auth SessionProvider can be used
 * inside the RSC-by-default App Router layout.
 */

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_AZURE_AUTH_ENABLED !== "true") return children;

  return (
    <NextAuthSessionProvider
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
