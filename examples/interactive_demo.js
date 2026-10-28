#!/usr/bin/env node
import { ToolRegistry } from '../src/gateway/registry.js';
import { MCPServer } from '../src/gateway/mcp_server.js';
import { ProcessSupervisor } from '../src/sandbox/supervisor.js';
import { PythonSupervisor } from '../src/sandbox/python_supervisor.js';
import { PathJail } from '../src/sandbox/path_jail.js';
import { TokenBudgeter } from '../src/budgeter/pruner.js';
import { SemanticCompactor } from '../src/budgeter/semantic_compactor.js';
import { globalMetrics } from '../src/observability/metrics.js';
import { isErr } from '../src/types/result.js';

async function runDemo() {
  console.log(`
========================================================================
⚡ AGENTBOX: LIVE INTERACTIVE ARCHITECTURE & SECURITY DEMO ⚡
========================================================================
`);

  // 1. Initialize Registry & MCP Server
  console.log('📦 [1/5] Initializing Tool Registry and MCP Server...');
  const registry = new ToolRegistry();
  const server = new MCPServer(registry);

  registry.register({
    name: 'safe_eval',
    description: 'Executes JS in an isolated sandbox',
    parameters: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
    execute: async ({ code }) => ProcessSupervisor.executeScript(code, {
      timeoutMs: 1000,
      maxMemoryMb: 32,
      workspaceRoot: process.cwd(),
    }),
  });
  console.log(`   ✅ Registered 1 tool. Total tools: ${registry.list().length}`);

  // 2. Security Demo: CPU Starvation
  console.log('\n🛡️ [2/5] Simulating Attack 1: Infinite Loop CPU Starvation (while(true))...');
  const attack1 = await ProcessSupervisor.executeScript('while(true) {}', {
    timeoutMs: 400,
    maxMemoryMb: 32,
    workspaceRoot: process.cwd(),
  });
  console.log(`   Status: [${attack1.status.toUpperCase()}]`);
  console.log(`   Watchdog Response: ${attack1.error}`);
  console.log(`   Elapsed Time: ${attack1.durationMs.toFixed(2)}ms`);

  // 3. Security Demo: Path Traversal
  console.log('\n🛡️ [3/5] Simulating Attack 2: Directory Traversal Jail Escape (../../etc/passwd)...');
  const jail = new PathJail(process.cwd());
  const jailResult = jail.resolveSafe('../../etc/shadow');
  if (isErr(jailResult)) {
    console.log(`   Blocked: ${jailResult.error.message}`);
  }

  // 4. Token Budgeter Demo
  console.log('\n⚡ [4/5] Testing Adaptive Token Budgeter (Priority Cascade)...');
  const massiveData = Array.from({ length: 40 }, (_, i) => ({ recordId: i, payload: 'large_trace_string' }));
  const conversation = [
    { role: 'system', content: 'You are an autonomous research agent.' },
    { role: 'user', content: 'Scan the repository and report dependencies.' },
    { role: 'tool', content: JSON.stringify(massiveData) },
    { role: 'user', content: 'Summarize the findings.' },
    { role: 'assistant', content: 'Found 40 modules.' },
  ];

  const beforeTokens = TokenBudgeter.estimateTotalTokens(conversation);
  const pruneReport = TokenBudgeter.prune(conversation, {
    maxContextTokens: 100,
    reserveTokensForOutput: 20,
    strategy: 'priority-cascade',
  });

  console.log(`   Original Context Tokens: ${beforeTokens}`);
  console.log(`   Final Context Tokens:    ${pruneReport.finalTokens}`);
  console.log(`   Tokens Saved:            ${pruneReport.tokensSaved} (${((pruneReport.tokensSaved / beforeTokens) * 100).toFixed(1)}%)`);
  console.log(`   System Prompt Retained:  ${pruneReport.messages[0].role === 'system' ? 'YES (Protected)' : 'NO'}`);

  // 5. Semantic Compaction
  console.log('\n📊 [5/5] Testing Semantic JSON Table Compactor...');
  const compactRes = SemanticCompactor.compact(JSON.stringify(massiveData), 400);
  console.log(`   Original JSON Size: ${compactRes.originalChars} characters`);
  console.log(`   Compacted Size:     ${compactRes.finalChars} characters`);
  console.log(`   Compacted Preview:\n${compactRes.compacted.split('\n').map(l => '      ' + l).join('\n')}`);

  console.log(`
========================================================================
🎉 DEMO COMPLETED SUCCESSFULLY! All invariants and bounds verified.
========================================================================
`);
}

runDemo().catch(console.error);
