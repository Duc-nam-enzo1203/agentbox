import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../src/gateway/registry.js';
import { MCPServer } from '../src/gateway/mcp_server.js';
import { TokenBudgeter } from '../src/budgeter/pruner.js';

describe('Performance & Latency Benchmarks', () => {
  it('measures gateway dispatch latency (p50, p95, p99)', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'fast_op',
      description: 'Micro operation',
      parameters: { type: 'object' },
      execute: async () => ({ ok: true }),
    });

    const server = new MCPServer(registry);
    const iterations = 100;
    const latencies = [];

    // Warm-up
    for (let i = 0; i < 5; i++) {
      await server.handleRequest({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fast_op', arguments: {} },
      });
    }

    // Benchmark loop
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await server.handleRequest({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fast_op', arguments: {} },
      });
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.50)].toFixed(3);
    const p95 = latencies[Math.floor(iterations * 0.95)].toFixed(3);
    const p99 = latencies[Math.floor(iterations * 0.99)].toFixed(3);

    console.log(`\n================ AGENTBOX BENCHMARK RESULTS ================`);
    console.log(`Iterations: ${iterations}`);
    console.log(`Gateway Dispatch Latency: p50 = ${p50}ms | p95 = ${p95}ms | p99 = ${p99}ms`);
    console.log(`============================================================\n`);

    // Senior standard: Gateway overhead must be sub-5ms for in-process dispatch
    assert.ok(Number(p50) < 5);
  });

  it('measures token budgeter throughput', () => {
    const largeMessageHistory = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `This is simulated dialogue turn #${i} discussing distributed systems, consensus algorithms, raft, and vector clocks with detailed code snippets.`,
    }));

    const t0 = performance.now();
    const runs = 200;
    for (let i = 0; i < runs; i++) {
      TokenBudgeter.prune(largeMessageHistory, {
        maxContextTokens: 500,
        reserveTokensForOutput: 100,
        strategy: 'priority-cascade',
      });
    }
    const elapsed = performance.now() - t0;
    const opsPerSec = Math.round((runs / elapsed) * 1000);

    console.log(`Token Pruning Throughput: ${opsPerSec} prunes/sec (${(elapsed / runs).toFixed(3)}ms per 50-turn prune)`);
    assert.ok(opsPerSec > 100);
  });
});
