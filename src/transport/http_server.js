import http from 'node:http';
import { globalMetrics } from '../observability/metrics.js';
import { ConcurrencyLimiter } from '../resilience/concurrency_limiter.js';
import { TokenBucketRateLimiter } from '../resilience/rate_limiter.js';
import { isErr } from '../types/result.js';

export class MCPHttpGateway {
  constructor(mcpServer, options = {}) {
    this.mcpServer = mcpServer;
    this.port = options.port || 3000;
    this.host = options.host || '127.0.0.1';

    this.concurrencyLimiter = new ConcurrencyLimiter(options.concurrency);
    this.rateLimiter = new TokenBucketRateLimiter(options.rateLimit);

    this.sessions = new Map(); // sessionId -> http.ServerResponse
    this.server = null;
    this.heartbeatTimer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleHttpRequest(req, res));

      // Periodic SSE heartbeat every 15 seconds
      this.heartbeatTimer = setInterval(() => {
        for (const [id, sseRes] of this.sessions.entries()) {
          try {
            sseRes.write(': ping\n\n');
          } catch {
            this.sessions.delete(id);
          }
        }
      }, 15000);

      this.server.listen(this.port, this.host, () => {
        globalMetrics.setGauge('agentbox_gateway_status', 1);
        resolve({ port: this.port, host: this.host });
      });

      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

      for (const res of this.sessions.values()) {
        try {
          res.end();
        } catch {
          // Ignore
        }
      }
      this.sessions.clear();

      if (this.server) {
        this.server.close(() => {
          globalMetrics.setGauge('agentbox_gateway_status', 0);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async _handleHttpRequest(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // 1. Health check probes
    if (pathname === '/health/live' || pathname === '/health/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    }

    // 2. Prometheus Metrics
    if (pathname === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return res.end(globalMetrics.renderMetrics());
    }

    // Rate limit check
    const rateCheck = this.rateLimiter.check(clientIp);
    if (isErr(rateCheck)) {
      globalMetrics.incrementCounter('agentbox_rate_limit_exceeded_total', 1, { client: clientIp });
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateCheck.error.retryAfterSeconds),
      });
      return res.end(JSON.stringify({ error: rateCheck.error.message }));
    }

    // 3. MCP SSE Stream Handshake
    if (pathname === '/sse' && req.method === 'GET') {
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      this.sessions.set(sessionId, res);
      globalMetrics.setGauge('agentbox_active_sse_sessions', this.sessions.size);

      // Send initial endpoint announcement per MCP spec
      const endpointUri = `/messages?sessionId=${sessionId}`;
      res.write(`event: endpoint\ndata: ${endpointUri}\n\n`);

      req.on('close', () => {
        this.sessions.delete(sessionId);
        globalMetrics.setGauge('agentbox_active_sse_sessions', this.sessions.size);
      });
      return;
    }

    // 4. MCP Messages Endpoint
    if (pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const body = await this._readBody(req);

      let rpcRequest;
      try {
        rpcRequest = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      }

      // Concurrency bound acquisition
      const permit = await this.concurrencyLimiter.acquire();
      if (isErr(permit)) {
        globalMetrics.incrementCounter('agentbox_concurrency_rejected_total', 1);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpcRequest.id ?? null,
          error: { code: -32000, message: permit.error.message },
        }));
      }

      const t0 = performance.now();
      try {
        const rpcResponse = await this.mcpServer.handleRequest(rpcRequest);
        const duration = performance.now() - t0;

        globalMetrics.observeHistogram('agentbox_request_duration_ms', duration);
        globalMetrics.incrementCounter('agentbox_requests_total', 1, { method: rpcRequest.method });

        // If client is listening over SSE session, dispatch event
        const sseRes = sessionId ? this.sessions.get(sessionId) : null;
        if (sseRes) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'dispatched_to_sse' }));
        }

        // Direct HTTP POST response fallback
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(rpcResponse));
      } finally {
        permit.value.release();
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) {
          reject(new Error('Payload Too Large'));
        }
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
}
