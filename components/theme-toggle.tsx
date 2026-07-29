"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = isDark ? "Switch to Acacia light theme" : "Switch to dark theme";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </Button>
  );
}
