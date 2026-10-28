# ADR 003: Tamper-Evident Cryptographic Audit Trail (WAL)

## Status
Accepted

## Context & Problem Statement
Autonomous AI agents are increasingly authorized to manipulate files, execute code in sandboxes, and make external API calls. In autonomous operations, critical failures (such as unintended deletions, data corruption, or policy bypasses) require forensic investigation.

Standard application logs (e.g., Syslog, stdout, or traditional non-crypto database tables) suffer from key vulnerabilities:
1. **Malleability**: A compromised agent running in a sandbox or a local process could edit, truncate, or inject fake historical log entries.
2. **Repudiation**: Without verifiable linkage between actions, proving the exact sequence of tool calls that triggered an outage is ambiguous.
3. **Recovery Gaps**: Replaying agent workflows to isolate non-deterministic LLM behavior requires an immutable trace of tool arguments and responses.

## Decision Drivers
- **Cryptographic Immutability**: Any modification, insertion, or deletion of log entries must be immediately detectable mathematically.
- **Append-Only Performance**: Appending an action must be an $O(1)$ disk operation using standard JSON Lines (`.jsonl`).
- **Zero Heavy Infrastructure**: No dependency on external blockchains, distributed ledgers, or heavy database daemons.
- **Offline Deterministic Replay**: Developers must be able to verify and replay past agent sessions locally.

## Considered Options
1. **Standard Unstructured JSON File / SQLite**: Simple, but vulnerable to silent record alterations and truncation.
2. **External Cloud Audit Service (AWS CloudTrail / Datadog)**: Adds network latency, external dependencies, and credential exposure risks for local-first agent workflows.
3. **SHA-256 Hash-Chained Write-Ahead Log (WAL)**: Cryptographic linking in an append-only JSONL structure.

## Decision
We implemented an in-process **Cryptographic Hash-Chained Audit Trail** (`AuditLogger`):

### 1. Hash-Chain Specification
- The log originates with a fixed 64-character `GENESIS_HASH` (`0000...0000`).
- Each entry $E_i$ contains an incrementing index $i$, timestamp, call ID, agent identity, tool name, sanitized argument object, result summary, and the previous hash $H_{i-1}$.
- The cryptographic seal for entry $E_i$ is computed as:
  $$H_i = \text{SHA-256}(H_{i-1} \mathbin{\Vert} \text{CanonicalJSON}(\text{Payload}_i))$$
- When an HMAC secret key is provided, the hash calculation upgrades to HMAC-SHA-256, binding the audit chain to a specific authority.

### 2. Fast Verification Algorithm
The verification procedure sequentially reads entries from disk:
- Checks that $index_i == i$.
- Checks that $E_i.prevHash == H_{i-1}$.
- Recomputes $H'_i$ over $Payload_i$ and asserts $H'_i == E_i.hash$.
- Any corrupted bit immediately breaks all downstream hashes and yields the exact line number of tampering.

## Consequences

### Positive
- **Guaranteed Non-Repudiation**: Proves mathematically that the recorded sequence of tool invocations has not been altered since generation.
- **High Throughput**: Appending an audit record takes $<0.05\text{ms}$ on standard NVMe drives.
- **Forensic Deterministic Replay**: Supports replaying historical tool outputs into an agent loop to pinpoint regression points.

### Negative / Trade-offs
- File compaction/pruning is restricted because pruning older records invalidates the hash chain down to the genesis block. Archival must be done by finalizing sealed epoch chunks.
