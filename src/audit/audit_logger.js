import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ok, err } from '../types/result.js';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Cryptographic Append-Only Audit Logger for Autonomous Agent Actions.
 * 
 * Implements a SHA-256 hash-chained Write-Ahead Log (WAL) to provide
 * tamper-evident record keeping for all agent tool invocations, inputs,
 * outputs, and sandbox execution metrics.
 */
export class AuditLogger {
  /**
   * @param {Object} [options]
   * @param {string} [options.logFilePath] - Path to append-only JSONL log file (or in-memory if omitted)
   * @param {string} [options.secretKey] - Optional HMAC secret key for signed audit entries
   */
  constructor(options = {}) {
    this.logFilePath = options.logFilePath || null;
    this.secretKey = options.secretKey || null;
    this.lastHash = GENESIS_HASH;
    this.entryIndex = 0;
    this.inMemoryEntries = [];

    if (this.logFilePath) {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this._initializeFromExistingLog();
    }
  }

  /**
   * Reads existing log to recover lastHash and index on startup.
   * @private
   */
  _initializeFromExistingLog() {
    if (!fs.existsSync(this.logFilePath)) return;

    const content = fs.readFileSync(this.logFilePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        this.entryIndex = record.index + 1;
        this.lastHash = record.hash;
        this.inMemoryEntries.push(record);
      } catch (e) {
        // Skip corrupted trailing lines during warm recovery
      }
    }
  }

  /**
   * Computes SHA-256 or HMAC-SHA-256 over entry payload.
   * @private
   */
  _computeHash(prevHash, payload) {
    const raw = `${prevHash}:${JSON.stringify(payload)}`;
    if (this.secretKey) {
      return crypto.createHmac('sha256', this.secretKey).update(raw).digest('hex');
    }
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Appends an agent action to the audit log with cryptographic chaining.
   * 
   * @param {Object} params
   * @param {string} params.callId
   * @param {string} [params.agentId='anonymous-agent']
   * @param {string} params.toolName
   * @param {any} params.args
   * @param {Object} params.resultSummary
   * @param {string} params.resultSummary.status - e.g. 'completed', 'timeout', 'oom_killed'
   * @param {number} params.resultSummary.durationMs
   * @param {string} [params.resultSummary.error]
   * @param {any} [params.resultSummary.outputSnippet]
   * @returns {Object} The sealed audit entry
   */
  logAction(params) {
    const index = this.entryIndex++;
    const timestamp = new Date().toISOString();

    const payload = {
      index,
      timestamp,
      callId: params.callId,
      agentId: params.agentId || 'anonymous-agent',
      toolName: params.toolName,
      args: params.args,
      resultSummary: {
        status: params.resultSummary?.status || 'unknown',
        durationMs: params.resultSummary?.durationMs || 0,
        error: params.resultSummary?.error || null,
        outputSnippet: typeof params.resultSummary?.outputSnippet === 'string'
          ? params.resultSummary.outputSnippet.slice(0, 500)
          : null,
      },
    };

    const hash = this._computeHash(this.lastHash, payload);
    const entry = {
      ...payload,
      prevHash: this.lastHash,
      hash,
    };

    this.lastHash = hash;
    this.inMemoryEntries.push(entry);

    if (this.logFilePath) {
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf8');
    }

    return entry;
  }

  /**
   * Verifies the cryptographic integrity of the entire audit chain.
   * Detects any altered records, deletions, or injected entries.
   * 
   * @param {string} [customPath]
   * @returns {import('../types/result.js').Result<{ verifiedEntries: number, headHash: string }, { error: string, corruptedIndex: number }>}
   */
  verifyIntegrity(customPath = null) {
    const targetPath = customPath || this.logFilePath;
    let records = [];

    if (targetPath && fs.existsSync(targetPath)) {
      const content = fs.readFileSync(targetPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      records = lines.map((l, i) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          throw new Error(`Malformed JSON on line ${i + 1}: ${e.message}`);
        }
      });
    } else {
      records = [...this.inMemoryEntries];
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      if (record.index !== i) {
        return err({
          error: `Index sequence broken at row ${i}: expected ${i}, found ${record.index}`,
          corruptedIndex: i,
        });
      }

      if (record.prevHash !== expectedPrevHash) {
        return err({
          error: `Hash chain broken at row ${i}: record.prevHash does not match previous entry's hash`,
          corruptedIndex: i,
        });
      }

      const { prevHash, hash, ...payload } = record;
      const recomputedHash = this._computeHash(prevHash, payload);

      if (recomputedHash !== hash) {
        return err({
          error: `Tampering detected at row ${i}: record payload does not match cryptographic hash`,
          corruptedIndex: i,
        });
      }

      expectedPrevHash = hash;
    }

    return ok({
      verifiedEntries: records.length,
      headHash: expectedPrevHash,
    });
  }

  /**
   * Queries audit records with filtering.
   * 
   * @param {Object} [filter]
   * @param {string} [filter.agentId]
   * @param {string} [filter.toolName]
   * @param {string} [filter.status]
   * @param {number} [filter.limit=100]
   * @returns {Array<Object>}
   */
  query(filter = {}) {
    let results = [...this.inMemoryEntries];

    if (filter.agentId) {
      results = results.filter(e => e.agentId === filter.agentId);
    }
    if (filter.toolName) {
      results = results.filter(e => e.toolName === filter.toolName);
    }
    if (filter.status) {
      results = results.filter(e => e.resultSummary?.status === filter.status);
    }

    if (typeof filter.limit === 'number' && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Replays recorded tool calls against a handler function.
   * Useful for deterministic regression testing and offline debugging.
   * 
   * @param {Object} params
   * @param {string} [params.agentId]
   * @param {(call: { toolName: string, args: any, originalResult: any }) => Promise<any>} params.executor
   * @returns {Promise<Array<{ index: number, toolName: string, passed: boolean, diff?: any }>>}
   */
  async replay(params) {
    const records = this.query({ agentId: params.agentId });
    const replayResults = [];

    for (const record of records) {
      const outcome = await params.executor({
        toolName: record.toolName,
        args: record.args,
        originalResult: record.resultSummary,
      });

      replayResults.push({
        index: record.index,
        toolName: record.toolName,
        passed: outcome?.status === record.resultSummary.status,
        diff: outcome,
      });
    }

    return replayResults;
  }
}
