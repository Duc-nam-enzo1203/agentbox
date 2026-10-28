import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ProcessSupervisor } from '../src/sandbox/supervisor.js';

describe('ProcessSupervisor Sandbox Execution', () => {
  const defaultOptions = {
    timeoutMs: 1500,
    maxMemoryMb: 64,
    workspaceRoot: process.cwd(),
  };

  it('successfully executes safe JavaScript code', async () => {
    const res = await ProcessSupervisor.executeScript(
      'console.log("hello" + " world");',
      defaultOptions
    );

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.data?.trim(), 'hello world');
    assert.ok(res.durationMs > 0);
  });

  it('enforces timeout watchdog on infinite loops (CPU Starvation Attack)', async () => {
    const res = await ProcessSupervisor.executeScript(
      'while(true) {}',
      { ...defaultOptions, timeoutMs: 300 }
    );

    assert.strictEqual(res.status, 'timeout');
    assert.ok(res.error?.includes('timed out'));
  });

  it('enforces memory limits on heap bombs (Out-of-Memory Attack)', async () => {
    const res = await ProcessSupervisor.executeScript(
      `
      const buffers = [];
      while(true) {
        buffers.push(Buffer.alloc(10 * 1024 * 1024));
      }
      `,
      { ...defaultOptions, maxMemoryMb: 32, timeoutMs: 4000 }
    );

    assert.strictEqual(res.status, 'oom_killed');
    assert.ok(res.error?.includes('memory ceiling'));
  });

  it('scrubs ambient parent secrets from execution environment', async () => {
    process.env['AGENTBOX_SECRET_KEY'] = 'super-secret-token-123';

    const res = await ProcessSupervisor.executeScript(
      'console.log(process.env.AGENTBOX_SECRET_KEY || "NOT_FOUND");',
      defaultOptions
    );

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.data?.trim(), 'NOT_FOUND');

    delete process.env['AGENTBOX_SECRET_KEY'];
  });
});
