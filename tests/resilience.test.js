import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConcurrencyLimiter } from '../src/resilience/concurrency_limiter.js';
import { CircuitBreaker } from '../src/resilience/circuit_breaker.js';
import { TokenBucketRateLimiter } from '../src/resilience/rate_limiter.js';
import { isOk, isErr } from '../src/types/result.js';

describe('Resilience & Concurrency Subsystem', () => {
  it('ConcurrencyLimiter enforces slot limit and queues pending requests', async () => {
    const limiter = new ConcurrencyLimiter({
      maxConcurrent: 2,
      maxQueueSize: 5,
      queueTimeoutMs: 1000,
    });

    const permit1 = await limiter.acquire();
    const permit2 = await limiter.acquire();
    assert.strictEqual(isOk(permit1), true);
    assert.strictEqual(isOk(permit2), true);
    assert.strictEqual(limiter.getStats().activeCount, 2);

    // 3rd acquire will be queued
    let permit3Acquired = false;
    const p3Promise = limiter.acquire().then(res => {
      permit3Acquired = true;
      return res;
    });

    assert.strictEqual(permit3Acquired, false);
    assert.strictEqual(limiter.getStats().queuedCount, 1);

    // Release slot 1
    if (isOk(permit1)) permit1.value.release();

    const permit3 = await p3Promise;
    assert.strictEqual(isOk(permit3), true);
    assert.strictEqual(permit3Acquired, true);

    // Cleanup
    if (isOk(permit2)) permit2.value.release();
    if (isOk(permit3)) permit3.value.release();
  });

  it('CircuitBreaker trips to OPEN on consecutive failures and resets in HALF_OPEN', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 50,
    });

    assert.strictEqual(isOk(breaker.canExecute()), true);

    // Record failures
    breaker.recordFailure();
    breaker.recordFailure();
    assert.strictEqual(breaker.getState().state, 'CLOSED');

    breaker.recordFailure(); // 3rd failure
    assert.strictEqual(breaker.getState().state, 'OPEN');

    // Execution should now be rejected
    const blocked = breaker.canExecute();
    assert.strictEqual(isErr(blocked), true);
    if (isErr(blocked)) {
      assert.strictEqual(blocked.error.code, 'CIRCUIT_OPEN');
    }
  });

  it('TokenBucketRateLimiter limits bursts and refills tokens', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 3,
      refillRatePerSec: 5,
    });

    // 3 immediate calls should succeed
    assert.strictEqual(isOk(limiter.check('user_1')), true);
    assert.strictEqual(isOk(limiter.check('user_1')), true);
    assert.strictEqual(isOk(limiter.check('user_1')), true);

    // 4th call exceeds capacity
    const denied = limiter.check('user_1');
    assert.strictEqual(isErr(denied), true);
    if (isErr(denied)) {
      assert.strictEqual(denied.error.code, 'RATE_LIMIT_EXCEEDED');
    }
  });
});
