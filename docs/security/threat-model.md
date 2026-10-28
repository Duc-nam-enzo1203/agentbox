# AgentBox Threat Model & Security Posture (STRIDE)

## 1. Executive Summary
AgentBox provides an isolated execution boundary for Autonomous AI Agents interacting with local tool ecosystems and executing code. Because autonomous agents generate code dynamically and interpret untrusted user input, the sandbox represents the primary security perimeter against malicious lateral movement, data exfiltration, and resource exhaustion.

This document details the threat landscape using the **STRIDE** methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).

---

## 2. Threat Analysis Matrix

| Threat Category | Attack Vector / Scenario | Potential Impact | AgentBox Mitigation | Verification Test |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Rogue agent claims admin identity to invoke privileged tools. | Unauthorized system-level tool execution. | Capability-Based Access Control (`PolicyEngine`). Role validation with explicit deny lists and token-bucket keys. | `tests/policy_engine.test.js` |
| **Tampering** | Rogue agent edits or truncates execution logs to cover tracks. | Inability to audit security breaches or data deletion. | Append-Only Cryptographic Write-Ahead Log (`AuditLogger`) using SHA-256 hash chaining. Modifying 1 byte breaks downstream hashes. | `tests/audit_logger.test.js` |
| **Repudiation** | Operator or agent disavows catastrophic actions taken. | Disputed responsibility for data modifications. | Signed HMAC audit entries linking exact `callId`, input arguments, timestamp, and status. | `tests/audit_logger.test.js` |
| **Information Disclosure** | Agent executes shell/code to read parent environment variables (e.g., `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`). | Credential exfiltration to external attackers. | Strict environment variable scrubbing (`ProcessSupervisor` / `PythonSupervisor`). Only explicitly whitelisted keys (`PATH`, `TEMP`) pass to child processes. | `tests/supervisor.test.js`, `tests/python_supervisor.test.js` |
| **Denial of Service** | Agent writes infinite loops (`while(true)`) or allocates multi-gigabyte memory arrays (OOM bomb). | Node process crash, CPU starvation, host freeze. | Dual-stage asynchronous watchdog timer (SIGTERM $\rightarrow$ SIGKILL) and V8/Python virtual memory ceilings (`--max-old-space-size`, `resource.setrlimit`). | `tests/supervisor.test.js`, `tests/python_supervisor.test.js` |
| **Elevation of Privilege** | Agent uses path traversal (`../../etc/passwd`) or symlink trickery to escape workspace. | Overwriting host operating system files or reading private keys. | Canonical Path Jail (`PathJail`) enforcing strict root prefix containment using `fs.realpathSync`. | `tests/path_jail.test.js` |

---

## 3. Defense-in-Depth Architecture

```
[ Incoming LLM Tool Call / MCP Message ]
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 1. Rate Limiter             │ ──> [429 Too Many Requests]
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 2. Policy Engine (ABAC)     │ ──> [Forbidden: Role/Arg Regex Violation]
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 3. Concurrency Semaphore    │ ──> [Queue Backpressure / Slot Limit]
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 4. Path Jail Normalization  │ ──> [Path Traversal Violation: Canonical Check]
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 5. Isolated Subprocess      │
   │    - Scrubbed Env Vars      │
   │    - Memory Limit Ceiling   │
   │    - Dual-Stage Watchdog    │
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ 6. Cryptographic Audit WAL  │ ──> [Append to SHA-256 Chained Log]
   └─────────────────────────────┘
```

---

## 4. Residual Risks & Future Hardening
- **Kernel-level 0-day exploits**: In extremely hostile environments, child processes should execute inside microVMs (e.g. Firecracker) or WebAssembly sandboxes (e.g. Wasmtime).
- **Network Egress**: The current process supervisor scrubs environment credentials; production deployments should run in network-isolated Docker containers with `network_mode: none`.
