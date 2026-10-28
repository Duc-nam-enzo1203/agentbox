import { err, ok } from '../types/result.js';

export class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.capacity = options.capacity || 30; // Max tokens (burst)
    this.refillRatePerSec = options.refillRatePerSec || 10; // Tokens added per second
    this.buckets = new Map(); // key -> { tokens, lastRefillTime }
  }

  check(key = 'default') {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillTime: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSec = (now - bucket.lastRefillTime) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillRatePerSec);
    bucket.lastRefillTime = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return ok({
        remaining: Math.floor(bucket.tokens),
        capacity: this.capacity,
      });
    }

    const waitSec = ((1 - bucket.tokens) / this.refillRatePerSec).toFixed(2);
    return err({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for key '${key}'. Capacity: ${this.capacity}. Wait ${waitSec}s.`,
      retryAfterSeconds: Math.ceil(Number(waitSec)),
    });
  }

  // Periodic cleanup of stale buckets
  pruneStale(maxIdleMs = 60000) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefillTime > maxIdleMs) {
        this.buckets.delete(key);
      }
    }
  }
}
