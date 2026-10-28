import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuditLogger, GENESIS_HASH } from '../src/audit/audit_logger.js';
import { isOk, isErr, unwrap } from '../src/types/result.js';

describe('AuditLogger Cryptographic Hash Chaining', () => {
  it('initializes with genesis hash and computes linked sha256 hashes', () => {
    const logger = new AuditLogger();

    const e1 = logger.logAction({
      callId: 'call-001',
      agentId: 'agent-alpha',
      toolName: 'python:eval',
      args: { code: '2 + 2' },
      resultSummary: { status: 'completed', durationMs: 12, outputSnippet: '4' },
    });

    assert.equal(e1.index, 0);
    assert.equal(e1.prevHash, GENESIS_HASH);
    assert.equal(typeof e1.hash, 'string');
    assert.equal(e1.hash.length, 64);

    const e2 = logger.logAction({
      callId: 'call-002',
      agentId: 'agent-alpha',
      toolName: 'workspace:write_file',
      args: { path: 'result.txt', content: 'hello' },
      resultSummary: { status: 'completed', durationMs: 5 },
    });

    assert.equal(e2.index, 1);
    assert.equal(e2.prevHash, e1.hash);

    const verification = logger.verifyIntegrity();
    assert.ok(isOk(verification));
    assert.equal(unwrap(verification).verifiedEntries, 2);
  });

  it('detects payload tampering on file storage', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-audit-'));
    const logPath = path.join(tmpDir, 'audit.jsonl');

    try {
      const logger = new AuditLogger({ logFilePath: logPath });

      logger.logAction({
        callId: 'c1',
        toolName: 'eval',
        args: { val: 100 },
        resultSummary: { status: 'completed', durationMs: 2 },
      });

      logger.logAction({
        callId: 'c2',
        toolName: 'eval',
        args: { val: 200 },
        resultSummary: { status: 'completed', durationMs: 3 },
      });

      // Verification before tampering must pass
      const initialCheck = logger.verifyIntegrity();
      assert.ok(isOk(initialCheck));

      // Tamper: maliciously edit line 0 in the file (change val: 100 to val: 999)
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      const tamperedRecord = JSON.parse(lines[0]);
      tamperedRecord.args.val = 999; // Corrupt payload without updating hash
      lines[0] = JSON.stringify(tamperedRecord);
      fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');

      // Verification must fail and pinpoint row 0
      const tamperedCheck = logger.verifyIntegrity(logPath);
      assert.ok(isErr(tamperedCheck));
      assert.equal(tamperedCheck.error.corruptedIndex, 0);
      assert.match(tamperedCheck.error.error, /Tampering detected/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('queries logs by agentId and toolName', () => {
    const logger = new AuditLogger();
    logger.logAction({ callId: '1', agentId: 'bot-1', toolName: 'tool_a', args: {} });
    logger.logAction({ callId: '2', agentId: 'bot-2', toolName: 'tool_b', args: {} });
    logger.logAction({ callId: '3', agentId: 'bot-1', toolName: 'tool_b', args: {} });

    const bot1Entries = logger.query({ agentId: 'bot-1' });
    assert.equal(bot1Entries.length, 2);

    const toolBEntries = logger.query({ toolName: 'tool_b' });
    assert.equal(toolBEntries.length, 2);
  });
});
