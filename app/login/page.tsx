"use client";

/**
 * app/login/page.tsx
 * Public login page — triggers Azure AD OAuth flow via next-auth.
 * Shown when unauthenticated users hit a protected route.
 */

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogIn, Loader2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Already authenticated — send to dashboard
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="bg-card border border-border rounded-xl shadow-lg p-8 flex flex-col gap-6">
          {/* Logo / heading */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">AcaciaHealth</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dynamic Reporting Engine
              </p>
            </div>
          </div>

          {/* Sign-in button */}
          <button
            onClick={() => signIn("azure-ad", { callbackUrl: "/dashboard" })}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            {/* Microsoft icon */}
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </button>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Authentication is handled by Microsoft Entra ID.
            Your credentials are never stored by this application.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground mt-4">
          AcaciaHealth &copy; {new Date().getFullYear()} &middot; HIPAA-compliant
        </p>
      </div>
    </div>
  );
}
