/**
 * lib/rateLimit.js
 * Lightweight in-memory rate limiter for Next.js API routes.
 * No external service required — uses a sliding-window Map per IP.
 *
 * Suitable for single-instance or Vercel Edge deployments.
 * For multi-instance production (Docker Swarm / K8s), upgrade to @upstash/ratelimit + Redis.
 */

// Store: Map<identifier, { count: number, resetAt: number }>
const rateLimitStore = new Map();

// Cleanup stale entries every 5 minutes to prevent memory leaks
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetAt < now) rateLimitStore.delete(key);
    }
  }, 5 * 60 * 1000);
}

/**
 * Check if a request is within the rate limit.
 *
 * @param {Request} request - The incoming Next.js request object
 * @param {object} options
 * @param {number} options.limit     - Max requests allowed per window (default: 10)
 * @param {number} options.windowMs  - Window size in milliseconds (default: 60_000 = 1 min)
 * @param {string} [options.prefix]  - Optional prefix to namespace limits per endpoint
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export function checkRateLimit(request, { limit = 10, windowMs = 60_000, prefix = 'rl' } = {}) {
  // Extract client IP from standard headers (works behind Vercel, Nginx, Cloudflare)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const key = `${prefix}:${ip}`;
  const now = Date.now();

  const record = rateLimitStore.get(key);

  if (!record || record.resetAt < now) {
    // First request in window or window expired — start fresh
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count += 1;
  return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt };
}

/**
 * Returns a standard rate-limit-exceeded NextResponse.
 * @param {number} resetAt - Timestamp (ms) when the window resets
 * @returns {Response}
 */
export function rateLimitExceededResponse(resetAt) {
  const retryAfterSecs = Math.ceil((resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down and try again shortly.',
      retryAfterSeconds: retryAfterSecs,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSecs),
        'X-RateLimit-Limit': String(10),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    }
  );
}
