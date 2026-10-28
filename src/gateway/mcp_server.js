import { isErr } from '../types/result.js';

export class MCPServer {
  constructor(registry, sandboxOptions) {
    this.registry = registry;
    this.sandboxOptions = sandboxOptions;
  }

  async handleRequest(request) {
    if (!request || request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0".' },
      };
    }

    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'agentbox',
                version: '0.1.0',
              },
            },
          };

        case 'ping':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {},
          };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              tools: this.registry.toMCPToolList(),
            },
          };

        case 'tools/call': {
          const params = request.params;
          if (!params || !params.name) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32602, message: 'Missing "name" in tools/call params.' },
            };
          }

          const tool = this.registry.get(params.name);
          if (!tool) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `Tool "${params.name}" not found.` },
            };
          }

          const validationResult = this.registry.validateArguments(params.name, params.arguments || {});
          if (isErr(validationResult)) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: validationResult.error.code === 'TOOL_NOT_FOUND' ? -32601 : -32602,
                message: validationResult.error.message,
                data: validationResult.error,
              },
            };
          }

          const startTime = performance.now();
          const executionContext = {
            callId: `mcp_${Date.now()}`,
            workspaceRoot: this.sandboxOptions?.workspaceRoot || process.cwd(),
            log: (level, msg) => console.error(`[${level.toUpperCase()}] ${msg}`),
          };

          try {
            const resultData = await tool.execute(validationResult.value, executionContext);
            const durationMs = performance.now() - startTime;

            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2),
                  },
                ],
                _agentbox: {
                  durationMs,
                  status: 'completed',
                },
              },
            };
          } catch (execErr) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: execErr instanceof Error ? execErr.message : String(execErr),
                  },
                ],
              },
            };
          }
        }

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: `Method "${request.method}" not found.` },
          };
      }
    } catch (unexpected) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal JSON-RPC Error',
          data: unexpected instanceof Error ? unexpected.message : String(unexpected),
        },
      };
    }
  }
}
