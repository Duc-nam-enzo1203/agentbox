import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { 
  ToolRegistry, 
  ProcessSupervisor, 
  PythonSupervisor, 
  PathJail, 
  TokenBudgeter, 
  PolicyEngine, 
  AuditLogger, 
  MetricsCollector, 
  isOk, 
  unwrap 
} from '../src/index.js';

/**
 * Autonomous Agent E2E Harness Demo
 * 
 * Demonstrates a complete ReAct agent workflow running through AgentBox:
 * 1. Policy verification (ABAC/RBAC)
 * 2. Path-jailed file I/O
 * 3. Isolated multi-language sandbox execution (Python 3)
 * 4. Resilient timeout recovery
 * 5. Cryptographic audit trail validation (SHA-256 hash chain)
 */
async function runAutonomousAgentDemo() {
  console.log('\n===============================================================');
  console.log('🤖 AGENTBOX AUTONOMOUS AGENT EXECUTION HARNESS');
  console.log('===============================================================\n');

  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-harness-'));
  const auditLogFile = path.join(tmpWorkspace, 'audit_trail.jsonl');

  try {
    // 1. Initialize Core Systems
    const jail = new PathJail(tmpWorkspace);
    const registry = new ToolRegistry();
    const policy = new PolicyEngine({
      roles: {
        admin: { allow: ['*'] },
        analyst: {
          allow: ['workspace:read_*', 'python:*'],
          deny: ['workspace:write_*', 'bash:*'],
        },
        untrusted: {
          allow: ['python:eval_expression'],
          deny: ['workspace:*', 'bash:*'],
        },
      },
    });
    const audit = new AuditLogger({ logFilePath: auditLogFile });
    const metrics = new MetricsCollector();
    const pySupervisor = new PythonSupervisor({ timeoutMs: 1500, maxMemoryMb: 64, workspaceRoot: tmpWorkspace });

    // Seed mock data
    const sampleCsv = 'timestamp,tokens,latency_ms\n10:00,120,45\n10:01,340,62\n10:02,890,110\n10:03,210,38\n';
    fs.writeFileSync(path.join(tmpWorkspace, 'metrics.csv'), sampleCsv, 'utf8');
    console.log(`[Workspace] Initialized temporary sandbox jail at: ${tmpWorkspace}`);

    // 2. Register Agent Tools
    registry.register({
      name: 'workspace:read_file',
      description: 'Safely read a file within the sandboxed workspace',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      execute: async ({ path: filePath }) => {
        const canonical = unwrap(jail.resolveSafe(filePath));
        return fs.readFileSync(canonical, 'utf8');
      },
    });

    registry.register({
      name: 'workspace:write_file',
      description: 'Safely write a file within the sandboxed workspace',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      execute: async ({ path: filePath, content }) => {
        const canonical = unwrap(jail.resolveSafe(filePath));
        fs.writeFileSync(canonical, content, 'utf8');
        return { bytesWritten: Buffer.byteLength(content) };
      },
    });

    registry.register({
      name: 'python:analyze_data',
      description: 'Execute Python 3 analytical code inside resource-bounded sandbox',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
      execute: async ({ code }) => {
        const res = await pySupervisor.execute(code);
        return res;
      },
    });

    console.log(`[Registry] Registered ${registry.list().length} secure agent tools.\n`);

    // Helper: Secure Agent Tool Invoker with Policy, Metrics, and Audit Trail
    async function invokeAgentTool(agentId, role, toolName, args) {
      console.log(`\n👉 [Agent: ${agentId}] Attempting: ${toolName}...`);

      // Step A: Policy Authorization
      const policyDecision = policy.evaluate({ agentId, role, toolName, args });
      if (!isOk(policyDecision)) {
        metrics.incrementCounter('agentbox_policy_violations_total', 1, { tool: toolName, reason: policyDecision.error.violationType });
        console.log(`   ❌ Policy Blocked: ${policyDecision.error.reason} (${policyDecision.error.violationType})`);
        
        audit.logAction({
          callId: `call-${Date.now()}`,
          agentId,
          toolName,
          args,
          resultSummary: { status: 'policy_denied', durationMs: 0, error: policyDecision.error.reason },
        });
        return { error: policyDecision.error.reason };
      }

      // Step B: Dispatch via Registry
      const tool = registry.get(toolName);
      const start = Date.now();
      let outcome;

      try {
        const data = await tool.execute(args, {
          callId: `call-${Date.now()}`,
          workspaceRoot: tmpWorkspace,
          log: (lvl, msg) => console.log(`   [${lvl}] ${msg}`),
        });
        const durationMs = Date.now() - start;
        metrics.observeHistogram('agentbox_tool_duration_ms', durationMs);
        metrics.incrementCounter('agentbox_tool_calls_total', 1, { tool: toolName, status: 'completed' });

        outcome = { status: 'completed', durationMs, data };
        console.log(`   ✅ Success (${durationMs}ms)`);
      } catch (err) {
        const durationMs = Date.now() - start;
        metrics.observeHistogram('agentbox_tool_duration_ms', durationMs);
        metrics.incrementCounter('agentbox_tool_calls_total', 1, { tool: toolName, status: 'error' });

        outcome = { status: 'error', durationMs, error: err.message };
        console.log(`   ⚠️ Failed: ${err.message}`);
      }

      // Step C: Log to Cryptographic Audit Trail
      audit.logAction({
        callId: `call-${Date.now()}`,
        agentId,
        toolName,
        args,
        resultSummary: {
          status: outcome.status,
          durationMs: outcome.durationMs,
          error: outcome.error,
          outputSnippet: typeof outcome.data === 'string' ? outcome.data : JSON.stringify(outcome.data),
        },
      });

      return outcome;
    }

    // --- SCENARIO EXECUTION ---

    // Turn 1: Analyst reads CSV data
    const readRes = await invokeAgentTool('data-analyst-agent', 'analyst', 'workspace:read_file', { path: 'metrics.csv' });

    // Turn 2: Analyst calculates stats in Python sandbox
    const pythonCode = `
import csv, io
data = """${readRes.data}"""
f = io.StringIO(data.strip())
reader = csv.DictReader(f)
latencies = [int(row['latency_ms']) for row in reader]
avg_lat = sum(latencies) / len(latencies)
print(f"PROCESSED: count={len(latencies)}, avg_latency={avg_lat:.2f}ms")
`;
    const pyRes = await invokeAgentTool('data-analyst-agent', 'analyst', 'python:analyze_data', { code: pythonCode });
    if (pyRes?.data?.stdout) {
      console.log(`   [Sandbox Stdout]: ${pyRes.data.stdout.trim()}`);
    }

    // Turn 3: Destructive attack (blocked by PolicyEngine injection regex)
    await invokeAgentTool('data-analyst-agent', 'analyst', 'workspace:run_script', { command: 'rm -rf /' });

    // Turn 4: Path traversal attack (blocked by PathJail canonical boundary)
    await invokeAgentTool('data-analyst-agent', 'analyst', 'workspace:read_file', { path: '../../etc/passwd' });

    // Turn 5: Untrusted worker unauthorized tool call (blocked by PolicyEngine RBAC)
    await invokeAgentTool('untrusted-agent', 'untrusted', 'workspace:read_file', { path: 'metrics.csv' });

    // Turn 6: Timeout Watchdog test in Python (CPU starvation attack neutralized)
    console.log('\n👉 [Watchdog Test] Running infinite loop in sandbox...');
    const timeoutRes = await invokeAgentTool('data-analyst-agent', 'analyst', 'python:analyze_data', { code: 'while True: pass' });
    console.log(`   [Sandbox Outcome]: status=${timeoutRes.data.status}, error="${timeoutRes.data.error}"`);

    // Turn 6: Verification of Cryptographic Audit Trail
    console.log('\n===============================================================');
    console.log('🔒 VERIFYING CRYPTOGRAPHIC AUDIT TRAIL INTEGRITY');
    console.log('===============================================================');
    const integrity = audit.verifyIntegrity();
    if (isOk(integrity)) {
      const details = unwrap(integrity);
      console.log(`✅ Audit Chain Validated! Total Entries: ${details.verifiedEntries}`);
      console.log(`🔐 Chain Head SHA-256 Hash: ${details.headHash}`);
    } else {
      console.error(`❌ Audit Chain Corrupted: ${integrity.error.error}`);
    }

    // Turn 7: Prometheus Metrics Output
    console.log('\n===============================================================');
    console.log('📊 LIVE PROMETHEUS METRICS EXPOSITION');
    console.log('===============================================================');
    console.log(metrics.renderMetrics());

  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
}

runAutonomousAgentDemo().catch(console.error);
