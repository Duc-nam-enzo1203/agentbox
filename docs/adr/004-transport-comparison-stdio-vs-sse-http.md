# ADR 004: Dual Transport Architecture: Stdio vs. HTTP/SSE

## Status
Accepted

## Context & Problem Statement
The Model Context Protocol (MCP) specification defines two standard transport mechanisms for tool and context interchange:
1. **Stdio Transport**: JSON-RPC messages transmitted over standard input and standard output streams (`stdin` / `stdout`).
2. **HTTP with Server-Sent Events (SSE)**: Client posts JSON-RPC payloads over HTTP `POST /messages?sessionId=...` and receives streaming server responses over an HTTP `GET /sse` persistent channel.

Agent applications operate in two distinct runtime paradigms:
- **Local Developer Environments**: Desktop clients like Claude Desktop, Cursor, and terminal CLI agents run tool gateways as local child processes on `localhost`.
- **Distributed Agent Clusters**: Containerized Kubernetes clusters or remote VM sandboxes where agents communicate with tool backends over internal networks.

Supporting only one transport severely restricts deployment flexibility.

## Decision Drivers
- **Seamless Local Tooling**: Direct compatibility with Claude Desktop and Cursor via standard stdio subprocessing.
- **Enterprise Network Isolation**: Remote agents running on worker nodes must connect over HTTP/SSE with TLS and health check endpoints.
- **Protocol Symmetry**: The core dispatch pipeline (`MCPServer` & `ToolRegistry`) must be decoupled from the network/transport layer.

## Decision
We implemented a **Dual-Transport Architecture** with clean adapter boundaries:

```
                  +--------------------------------+
                  |    Model Context Protocol      |
                  |     JSON-RPC 2.0 Handler       |
                  +---------------+----------------+
                                  |
            +---------------------+---------------------+
            |                                           |
  +---------v----------+                     +----------v---------+
  |  Stdio Transport   |                     |  HTTP/SSE Transport|
  | (MCPStdioTransport)|                     |  (MCPHttpGateway)  |
  +---------+----------+                     +----------+---------+
            |                                           |
  [Claude / Cursor]                          [Remote Web / Microservices]
```

### Transport Features
1. **Stdio (`src/cli.js`)**:
   - Zero network ports required; immune to port-binding collisions.
   - Child process lifecycle tied directly to host editor process lifetime.
   - Robust line-buffered JSON parsing handling chunked `stdin` frames.

2. **HTTP/SSE (`src/transport/http_server.js`)**:
   - Native Node.js `node:http` (zero external dependencies like Express).
   - `GET /sse`: Persistent Server-Sent Events stream with connection keep-alive heartbeats every 15s.
   - `POST /messages`: JSON-RPC endpoint routing requests to the target SSE session.
   - `/health/live` & `/health/ready`: Kubernetes readiness and liveness probes.
   - `/metrics`: Standard Prometheus exposition endpoint.

## Consequences

### Positive
- Works out-of-the-box as a local CLI tool or as a production containerized service.
- Clean architectural decoupling: adding a third transport (e.g., WebSockets or gRPC) requires zero changes to the underlying `MCPServer`, `ToolRegistry`, or `ProcessSupervisor`.

### Negative / Trade-offs
- HTTP/SSE requires session management in memory (managing connection map and cleanup on client disconnect).
