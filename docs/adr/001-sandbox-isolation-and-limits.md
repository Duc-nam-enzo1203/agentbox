# ADR 001: Execution Sandbox Isolation Strategy and Resource Bounds

## Status
Accepted

## Context
Autonomous AI Agents running tools or evaluating dynamically generated code pose critical security and reliability challenges:
1. **Malicious or Erratic Execution:** AI-generated scripts can enter infinite loops (`while(true)`), allocate unbounded heap memory, or attempt fork-bombs.
2. **Environment & Secret Exfiltration:** Unsafe processes inherit ambient parent environment variables (`OPENAI_API_KEY`, database credentials, cloud access tokens).
3. **Filesystem Escape:** Tools can attempt path traversal (`../../etc/passwd` or `C:\Windows`) outside the intended workspace jail.
4. **Latency vs. Security Trade-off:** Launching a full Docker container on every tool invocation imposes 500ms–2000ms latency overhead, which ruins real-time agent UX. Conversely, running scripts via `eval()` or `vm.runInContext()` offers zero security isolation (V8 context escape vulnerabilities are well-documented).

## Decision Drivers
- **Startup Latency:** Must initiate and respond in `< 25ms` for micro-tasks.
- **Hard Resource Bounds:** Forceful termination on CPU timeout and heap ceiling exhaustion.
- **Zero Ambient Leakage:** The child process must have an explicitly scrubbed environment.
- **Cross-Platform Support:** Must function seamlessly across Linux, macOS, and Windows.

## Considered Options

| Option | Startup Latency | Memory Ceiling | Process Isolation | Escape Vulnerability |
| :--- | :--- | :--- | :--- | :--- |
| **1. Node.js `vm` module** | $< 1\text{ms}$ | ❌ Shared Heap | ❌ Same Process | 🚨 High (Prototype pollution & context escape) |
| **2. `worker_threads`** | $\sim 10\text{ms}$ | ⚠️ Shared Process Limits | ⚠️ In-process thread | ⚠️ Can crash main process on OOM |
| **3. Isolated Child Process** | $\sim 20\text{ms}$ | ✅ `--max-old-space-size` + Watchdog | ✅ Separate OS PID | ✅ Low (Hardened isolation boundary) |
| **4. Docker Container per call**| $800\text{ms} - 2500\text{ms}$ | ✅ Hard cgroups | ✅ Container namespace | ✅ Minimal |

## Decision
We select **Option 3: Isolated Child Process with Watchdog Supervisor & Scrubbed Environment** as the default runtime engine for AgentBox, with an abstraction layer allowing pluggable containerized execution for high-untrusted multi-tenant workloads.

### Architectural Invariants:
1. **Scrubbed Environment:** The execution child process receives ONLY a strictly declared whitelist of variables (e.g. `NODE_ENV=production`, `TMPDIR`). All parent API keys and secrets are scrubbed.
2. **Dual-Stage Timeout Watchdog:**
   - At $T_{\text{timeout}}$: Dispatch `SIGTERM` to allow graceful finalization.
   - At $T_{\text{timeout}} + 500\text{ms}$: If still responsive, dispatch uncatchable `SIGKILL` (or `taskkill /F /T` on Windows) to terminate the complete process tree.
3. **Memory Ceiling:** Enforce Node V8 flag `--max-old-space-size=<megabytes>` to trigger deterministic termination before host exhaustion.
4. **Jailed Path Resolution:** Canonical path resolution prevents symlink and `..` escape outside the designated workspace root.

## Consequences
- **Positive:** Sub-25ms execution startup, robust prevention of denial-of-service and secret leakage, works out-of-the-box on developer workstations without requiring Docker daemon.
- **Negative:** OS-level kernel-level syscall blocking (e.g., `seccomp-bpf`) requires root/Linux-specific primitives, which will be provided as an optional Linux extension.
