"use client";

/**
 * components/AuthButtons.tsx
 * Session-aware sign-in / sign-out buttons using next-auth.
 * Shows the authenticated user email and a Sign Out button when signed in,
 * or a "Sign in with Microsoft" button when signed out.
 */

import { signIn, signOut, useSession } from "next-auth/react";
import { LogIn, LogOut, Loader2 } from "lucide-react";

interface AuthButtonsProps {
  /** Compact mode — icon only with tooltip, used in tight headers */
  compact?: boolean;
}

export function AuthButtons({ compact = false }: AuthButtonsProps) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {!compact && <span className="text-xs">Loading session…</span>}
      </div>
    );
  }

  if (session) {
    return (
      <div className="flex items-center gap-3">
        {!compact && (
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-xs font-medium text-foreground leading-none">
              {session.user?.name ?? session.user?.email}
            </span>
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {session.user?.email}
            </span>
          </div>
        )}
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0 select-none">
          {(session.user?.name ?? session.user?.email ?? "?")
            .split(" ")
            .map((n: string) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Sign out"
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Signed out
  return (
    <button
      onClick={() => signIn("azure-ad")}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
    >
      <LogIn className="w-3.5 h-3.5" />
      {!compact && "Sign in with Microsoft"}
    </button>
  );
}
