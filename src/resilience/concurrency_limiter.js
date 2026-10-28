import { err, ok } from '../types/result.js';

export class ConcurrencyLimiter {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 8;
    this.maxQueueSize = options.maxQueueSize || 64;
    this.queueTimeoutMs = options.queueTimeoutMs || 5000;

    this.activeCount = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return ok({
        release: () => this._release(),
      });
    }

    if (this.queue.length >= this.maxQueueSize) {
      return err({
        code: 'CAPACITY_EXCEEDED',
        message: `Concurrency queue full (${this.queue.length}/${this.maxQueueSize}). Request rejected.`,
      });
    }

    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Remove from queue
          const idx = this.queue.findIndex(item => item.id === entryId);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve(err({
            code: 'QUEUE_TIMEOUT',
            message: `Request timed out waiting in execution queue after ${this.queueTimeoutMs}ms.`,
          }));
        }
      }, this.queueTimeoutMs);

      const entryId = Symbol('queue_entry');
      this.queue.push({
        id: entryId,
        proceed: () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.activeCount++;
            resolve(ok({
              release: () => this._release(),
            }));
          }
        },
      });
    });
  }

  _release() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next.proceed();
    }
  }

  getStats() {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
    };
  }
}
