"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional fallback UI. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Label shown in the default fallback header. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Top-level React Error Boundary (R-19).
 *
 * Wraps tab-level content in the main shell so a runtime throw in
 * KpiIntelligenceHub, ChartRenderer, or ResultsTable doesn't unmount
 * the entire dashboard.
 *
 * Usage:
 *   <ErrorBoundary label="KPI Intelligence">
 *     <KpiIntelligenceHub ... />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback, label = "this section" } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.reset);

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Something went wrong in {label}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              {error.message || "An unexpected error occurred. Try refreshing or contact support if the problem persists."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={this.reset} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        </div>
      );
    }

    return children;
  }
}
