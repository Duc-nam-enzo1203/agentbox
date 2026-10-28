import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../src/gateway/registry.js';
import { MCPServer } from '../src/gateway/mcp_server.js';

describe('MCPServer Protocol Handler', () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: 'Echoes back the message',
    parameters: {
      type: 'object',
      required: ['msg'],
      properties: {
        msg: { type: 'string' },
      },
    },
    execute: async ({ msg }) => `Echo: ${msg}`,
  });

  const server = new MCPServer(registry);

  it('handles initialize handshake', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });

    assert.strictEqual(res.error, undefined);
    assert.deepStrictEqual(res.result, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agentbox', version: '0.1.0' },
    });
  });

  it('handles tools/list', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    assert.strictEqual(res.error, undefined);
    const result = res.result;
    assert.strictEqual(result.tools.length, 1);
    assert.strictEqual(result.tools[0].name, 'echo');
  });

  it('handles valid tools/call', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { msg: 'Hello AgentBox' },
      },
    });

    assert.strictEqual(res.error, undefined);
    const result = res.result;
    assert.strictEqual(result.content[0].text, 'Echo: Hello AgentBox');
  });

  it('returns -32602 on schema validation failure', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {}, // missing required 'msg'
      },
    });

    assert.ok(res.error);
    assert.strictEqual(res.error?.code, -32602);
  });

  it('returns -32601 on unknown tool call', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'non_existent_tool',
        arguments: {},
      },
    });

    assert.ok(res.error);
    assert.strictEqual(res.error?.code, -32601);
  });
});
