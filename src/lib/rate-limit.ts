// In-memory sliding-window rate limiter, keyed by API key prefix.
//
// Simple enough for single-container deploys. When we scale to multiple web
// containers this must move to Redis (per-key counter with TTL) — the
// per-container Maps below would let each container get its own budget,
// effectively multiplying the true limit by the container count.
//
// Bookkeeping runs on demand (no timer): each check drops timestamps older
// than the window. Long-idle keys get GC'd by the size limiter at 1000 keys.

const MAX_TRACKED_KEYS = 1000;

interface Bucket {
  timestamps: number[];
  windowMs: number;
  limit: number;
}

const buckets = new Map<string, Bucket>();

function keyFor(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function evictOldestIfFull() {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  const firstKey = buckets.keys().next().value;
  if (firstKey) buckets.delete(firstKey);
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec?: number;
}

/**
 * Check + record. Returns whether the request is allowed. If not, includes
 * `retryAfterSec` so callers can surface a helpful "wait N seconds" message.
 */
export function checkRate(
  scope: string,
  id: string,
  limitPerWindow: number,
  windowMs: number,
): RateResult {
  const key = keyFor(scope, id);
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    evictOldestIfFull();
    bucket = { timestamps: [], windowMs, limit: limitPerWindow };
    buckets.set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limitPerWindow) {
    const oldest = bucket.timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.timestamps.push(now);
  return { allowed: true, remaining: limitPerWindow - bucket.timestamps.length };
}
