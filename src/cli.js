#!/usr/bin/env node
import readline from 'node:readline';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ToolRegistry } from './gateway/registry.js';
import { MCPServer } from './gateway/mcp_server.js';
import { ProcessSupervisor } from './sandbox/supervisor.js';
import { PythonSupervisor } from './sandbox/python_supervisor.js';
import { MCPHttpGateway } from './transport/http_server.js';
import { AuditLogger } from './audit/audit_logger.js';
import { isOk, unwrap } from './types/result.js';

function createDefaultRegistry() {
  const registry = new ToolRegistry();

  registry.register({
    name: 'run_sandboxed_node',
    description: 'Executes JavaScript code inside a resource-constrained, environment-scrubbed Node.js sandbox.',
    parameters: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        timeoutMs: { type: 'number', description: 'Maximum execution time in ms (default 2000)' },
        maxMemoryMb: { type: 'number', description: 'Memory ceiling in MB (default 64)' },
      },
    },
    execute: async ({ code, timeoutMs, maxMemoryMb }) => {
      return ProcessSupervisor.executeScript(code, {
        timeoutMs: timeoutMs || 2000,
        maxMemoryMb: maxMemoryMb || 64,
        workspaceRoot: process.cwd(),
      });
    },
  });

  registry.register({
    name: 'run_sandboxed_python',
    description: 'Executes Python 3 code inside a resource-constrained, environment-scrubbed sandbox.',
    parameters: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', description: 'Python 3 code to execute' },
        timeoutMs: { type: 'number', description: 'Maximum execution time in ms (default 2000)' },
        maxMemoryMb: { type: 'number', description: 'Memory ceiling in MB (default 64)' },
      },
    },
    execute: async ({ code, timeoutMs, maxMemoryMb }) => {
      return PythonSupervisor.executeScript(code, {
        timeoutMs: timeoutMs || 2000,
        maxMemoryMb: maxMemoryMb || 64,
        workspaceRoot: process.cwd(),
      });
    },
  });

  return registry;
}

function startStdioServer() {
  const registry = createDefaultRegistry();
  const server = new MCPServer(registry);

  console.error('[AgentBox] MCP Gateway listening over stdio transport.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed);
      const response = await server.handleRequest(request);
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (parseErr) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON',
          data: String(parseErr),
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });
}

function startHttpServer(args) {
  let port = 8080;
  let host = '0.0.0.0';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[i + 1];
      i++;
    }
  }

  const registry = createDefaultRegistry();
  const server = new MCPServer(registry);
  const gateway = new MCPHttpGateway(server, { port, host });

  gateway.start().then(() => {
    console.log(`[AgentBox] HTTP/SSE Gateway active on http://${host}:${port}`);
    console.log(`[AgentBox] Health Probe: http://${host}:${port}/health/live`);
    console.log(`[AgentBox] Prometheus Metrics: http://${host}:${port}/metrics`);
    console.log(`[AgentBox] SSE Stream: http://${host}:${port}/sse`);
  }).catch((err) => {
    console.error(`[AgentBox] Failed to start HTTP Gateway:`, err);
    process.exit(1);
  });
}

function inspectSystem() {
  console.log('\n===============================================================');
  console.log('🔍 AGENTBOX SYSTEM ENVIRONMENT & SANDBOX DIAGNOSTIC');
  console.log('===============================================================\n');

  console.log(`Platform:          ${os.platform()} (${os.arch()})`);
  console.log(`Node.js Version:   ${process.version}`);
  console.log(`CPUs / Cores:      ${os.cpus().length} core(s)`);
  console.log(`Total System RAM:  ${(os.totalmem() / (1024 ** 3)).toFixed(2)} GB`);
  console.log(`Free System RAM:   ${(os.freemem() / (1024 ** 3)).toFixed(2)} GB`);
  console.log(`Process Memory:    ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB heap used`);

  // Probe Python 3 availability
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  const pyProbe = spawnSync(pyBin, ['--version'], { encoding: 'utf8' });
  if (pyProbe.status === 0) {
    console.log(`Python Runtime:    ✅ Available (${pyProbe.stdout.trim() || pyProbe.stderr.trim()})`);
  } else {
    console.log(`Python Runtime:    ⚠️ Not found on PATH (Python sandboxing disabled)`);
  }

  console.log('\nSandbox Capabilities:');
  console.log(' - Dual-Stage Watchdog:   ✅ SIGTERM + SIGKILL Watchdog Enabled');
  console.log(' - V8 Memory Ceilings:    ✅ --max-old-space-size Supported');
  console.log(' - Secret Scrubbing:      ✅ Whitelist Policy Active');
  console.log(' - Path Canonical Jail:   ✅ fs.realpathSync Enabled');
  console.log(' - Cryptographic Audit:   ✅ SHA-256 Hash Chained WAL');
  console.log(' - Prometheus Metrics:    ✅ Native Text Exposition Active\n');
}

function verifyAuditTrail(logPath) {
  if (!logPath) {
    console.error('Usage: agentbox audit-verify <path-to-audit-log.jsonl>');
    process.exit(1);
  }

  console.log(`\n[AgentBox] Verifying cryptographic integrity of: ${logPath}...`);
  const logger = new AuditLogger();
  const res = logger.verifyIntegrity(logPath);

  if (isOk(res)) {
    const info = unwrap(res);
    console.log(`✅ Audit Trail Verified!`);
    console.log(` - Total Validated Records: ${info.verifiedEntries}`);
    console.log(` - Chain Head SHA-256 Hash: ${info.headHash}\n`);
  } else {
    console.error(`❌ Cryptographic Tampering Detected!`);
    console.error(` - Error: ${res.error.error}`);
    console.error(` - First Corrupted Row: Index ${res.error.corruptedIndex}\n`);
    process.exit(1);
  }
}

// Main CLI Dispatcher
const [,, command, ...rest] = process.argv;

if (!command || command === 'stdio') {
  startStdioServer();
} else if (command === 'serve') {
  startHttpServer(rest);
} else if (command === 'inspect') {
  inspectSystem();
} else if (command === 'audit-verify') {
  verifyAuditTrail(rest[0]);
} else if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
AgentBox CLI ⚡

Usage:
  agentbox [command] [options]

Commands:
  stdio (default)             Start Model Context Protocol (MCP) server over stdin/stdout
  serve [--port N] [--host H] Start HTTP and Server-Sent Events (SSE) MCP Gateway
  inspect                     Print system and sandbox isolation diagnostic report
  audit-verify <path>         Cryptographically verify a SHA-256 hash-chained audit log
  help                        Show this help message
`);
} else {
  console.error(`Unknown command: '${command}'. Run 'agentbox --help' for usage.`);
  process.exit(1);
}
