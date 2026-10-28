import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { ToolRegistry } from '../src/gateway/registry.js';
import { MCPServer } from '../src/gateway/mcp_server.js';
import { MCPHttpGateway } from '../src/transport/http_server.js';

describe('MCPHttpGateway Network Transport', () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'ping_network',
    description: 'Network ping test tool',
    parameters: { type: 'object' },
    execute: async () => ({ status: 'pong', timestamp: Date.now() }),
  });

  const mcpServer = new MCPServer(registry);
  const gateway = new MCPHttpGateway(mcpServer, { port: 3099, host: '127.0.0.1' });

  it('starts gateway and responds to health and metrics probes', async () => {
    await gateway.start();

    // 1. Health check
    const healthRes = await fetchJson('http://127.0.0.1:3099/health/live');
    assert.strictEqual(healthRes.status, 'ok');

    // 2. Prometheus metrics
    const metricsRes = await fetchText('http://127.0.0.1:3099/metrics');
    assert.ok(metricsRes.includes('agentbox_gateway_status 1'));

    // 3. Post JSON-RPC request to /messages
    const rpcRes = await postJson('http://127.0.0.1:3099/messages', {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: { name: 'ping_network', arguments: {} },
    });

    assert.strictEqual(rpcRes.id, 101);
    assert.ok(rpcRes.result);
    assert.strictEqual(rpcRes.result._agentbox.status, 'completed');

    await gateway.stop();
  });
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
