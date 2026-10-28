import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../src/gateway/registry.js';
import { MCPServer } from '../src/gateway/mcp_server.js';
import { ConcurrencyLimiter } from '../src/resilience/concurrency_limiter.js';
import { isOk } from '../src/types/result.js';

describe('Security Fuzzing & Chaos Stress Test Suite', () => {
  it('defends against prototype pollution payloads in tool execution', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'pollute_target',
      description: 'Target of pollution probe',
      parameters: { type: 'object' },
      execute: async (args) => args,
    });

    const server = new MCPServer(registry);

    // Send payload attempting prototype pollution
    const maliciousPayload = JSON.parse('{"__proto__": {"admin": true}, "constructor": {"prototype": {"hacked": true}}}');

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 999,
      method: 'tools/call',
      params: {
        name: 'pollute_target',
        arguments: maliciousPayload,
      },
    });

    assert.strictEqual(res.error, undefined);
    // Verify global Object prototype was NOT polluted
    const cleanObject = {};
    assert.strictEqual(cleanObject['admin'], undefined);
    assert.strictEqual(cleanObject['hacked'], undefined);
  });

  it('stress tests concurrency limiter with 50 parallel requests', async () => {
    const limiter = new ConcurrencyLimiter({
      maxConcurrent: 5,
      maxQueueSize: 100,
      queueTimeoutMs: 2000,
    });

    let completed = 0;
    const tasks = Array.from({ length: 50 }, async (_, i) => {
      const permit = await limiter.acquire();
      assert.strictEqual(isOk(permit), true);

      // Simulate micro workload
      await new Promise(r => setTimeout(r, 10));

      if (isOk(permit)) permit.value.release();
      completed++;
    });

    await Promise.all(tasks);
    assert.strictEqual(completed, 50);
    assert.strictEqual(limiter.getStats().activeCount, 0);
    assert.strictEqual(limiter.getStats().queuedCount, 0);
  });

  it('handles random fuzz payloads with null bytes, emojis, and deep recursion without crashing', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo_fuzz',
      description: 'Fuzz target',
      parameters: { type: 'object' },
      execute: async (args) => ({ echoedLength: JSON.stringify(args).length }),
    });

    const server = new MCPServer(registry);

    // Deeply nested JSON with special chars and null bytes
    let payload = { level: 0, text: 'Hello \x00\x1f\u{1F4A9} Null & Unicode!' };
    for (let i = 1; i <= 20; i++) {
      payload = { level: i, child: payload, random: Math.random().toString(36) };
    }

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 'fuzz-test',
      method: 'tools/call',
      params: {
        name: 'echo_fuzz',
        arguments: payload,
      },
    });

    assert.strictEqual(res.error, undefined);
    const output = JSON.parse(res.result.content[0].text);
    assert.strictEqual(typeof output.echoedLength, 'number');
  });
});

