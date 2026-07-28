/**
 * In-process sliding-window rate limiter.
 *
 * Designed for use in Next.js API route handlers running in a single
 * serverless instance (one instance per Vercel function invocation).
 * For multi-instance deployments, replace the Map with Upstash Redis.
 *
 * Usage:
 *   const result = rateLimiter.check(req, { limit: 20, window: 60 });
 *   if (!result.success) return result.response;
 */

import { NextRequest, NextResponse } from "next/server";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();

// Evict expired entries every 5 minutes to prevent unbounded growth.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitOptions {
  /** Max requests allowed within the window. Default: 30 */
  limit?: number;
  /** Sliding window duration in seconds. Default: 60 */
  window?: number;
  /** Key prefix to namespace per-route limits. Default: "global" */
  prefix?: string;
}

export interface RateLimitResult {
  success: true;
  remaining: number;
  reset: number;
}

export interface RateLimitDenied {
  success: false;
  remaining: 0;
  reset: number;
  response: NextResponse;
}

function getClientId(req: NextRequest): string {
  // Prefer Vercel's forwarded IP; fall back to a fixed key in dev.
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function checkRateLimit(
  req: NextRequest,
  options: RateLimitOptions = {}
): RateLimitResult | RateLimitDenied {
  const { limit = 30, window: windowSecs = 60, prefix = "global" } = options;
  const windowMs = windowSecs * 1000;
  const clientId = getClientId(req);
  const key = `${prefix}:${clientId}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const reset = Math.ceil(entry.resetAt / 1000);

  if (entry.count > limit) {
    const headers = {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(reset),
      "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
      "Content-Type": "application/json",
    };
    return {
      success: false,
      remaining: 0,
      reset,
      response: new NextResponse(
        JSON.stringify({ error: "Too many requests", retry_after: reset }),
        { status: 429, headers }
      ),
    };
  }

  return { success: true, remaining, reset };
}
