import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Fixed-window rate limiting, backed by the rate_limits table so it works across serverless
// invocations (in-memory wouldn't). Soft limit: a rare race can let a couple extra requests
// through under burst, which is fine for protecting paid AI endpoints from abuse.

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super('rate limited');
    this.name = 'RateLimitError';
  }
}

/**
 * Allow up to `max` requests per `windowSec` for `bucket` (e.g. `gen:<creatorId>`).
 * Returns true if allowed; throws RateLimitError if over the limit. Never blocks the request
 * on its own DB error — a limiter outage shouldn't take the feature down.
 */
export async function rateLimit(bucket: string, max: number, windowSec: number): Promise<true> {
  const windowMs = windowSec * 1000;
  try {
    const [row] = await db
      .select({ count: schema.rateLimits.count, windowStart: schema.rateLimits.windowStart })
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.bucket, bucket))
      .limit(1);

    const now = Date.now();
    const expired = !row || now - row.windowStart.getTime() > windowMs;

    if (expired) {
      // Start a fresh window. defaultNow() stamps window_start server-side.
      await db
        .insert(schema.rateLimits)
        .values({ bucket, count: 1 })
        .onConflictDoUpdate({ target: schema.rateLimits.bucket, set: { count: 1, windowStart: sql`now()` } });
      return true;
    }

    if (row.count >= max) {
      const retry = Math.ceil((windowMs - (now - row.windowStart.getTime())) / 1000);
      throw new RateLimitError(Math.max(1, retry));
    }

    await db
      .update(schema.rateLimits)
      .set({ count: sql`${schema.rateLimits.count} + 1` })
      .where(eq(schema.rateLimits.bucket, bucket));
    return true;
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    return true; // fail open — never let a limiter hiccup break the endpoint
  }
}

/**
 * One-liner for endpoints: returns a 429 Response if over the limit, else null.
 *   const limited = await guardRate(`gen:${user.id}`, 30, 60); if (limited) return limited;
 */
export async function guardRate(bucket: string, max: number, windowSec: number): Promise<Response | null> {
  try {
    await rateLimit(bucket, max, windowSec);
    return null;
  } catch (e) {
    if (e instanceof RateLimitError) {
      return Response.json(
        { error: 'rate_limited', retryAfter: e.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(e.retryAfterSec) } },
      );
    }
    return null;
  }
}
