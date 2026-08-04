/**
 * Edge-runtime-compatible rate limiter.
 *
 * Uses a module-level Map. Each edge invocation is isolated, so this
 * acts as a per-invocation guard rather than a distributed limit.
 * For a true distributed limit, replace this with Upstash Redis.
 *
 * Returns a 429 Response when the limit is exceeded, or null if allowed.
 */

const store = new Map<string, { count: number; resetAt: number }>();

export function edgeCheckRateLimit(
  req: Request,
  options: { limit?: number; window?: number; prefix?: string } = {}
): Response | null {
  const { limit = 15, window: windowSecs = 60, prefix = "edge" } = options;
  const windowMs = windowSecs * 1000;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";

  const key = `${prefix}:${ip}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return new Response(
      JSON.stringify({ error: "Too many requests", retry_after: entry.resetAt }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  return null;
}
