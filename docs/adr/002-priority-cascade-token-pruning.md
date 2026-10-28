# ADR 002: Priority Cascade Token Pruning vs. Vector Summarization

## Status
Accepted

## Context & Problem Statement
Autonomous AI agents accumulate large context footprints during multi-step reasoning loops. A single agent trajectory may involve dozens of tool calls that generate verbose JSON payloads, compiler errors, or shell outputs. As context approaches the model's context window limit ($L$), the agent suffers from:
1. Skyrocketing token latency and inference costs.
2. "Lost in the Middle" syndrome, degrading agent reasoning fidelity.
3. Hard context truncation errors from the model provider.

Existing approaches either perform naive FIFO truncation (dropping the earliest messages, which loses the initial user prompt and system persona) or vector-based summarization (making an asynchronous LLM call to summarize conversation history).

Vector-based summarization introduces significant latency (500ms - 2000ms), additional token cost, and risks hallucinating or omitting critical tool return values.

## Decision Drivers
- **Zero-Latency In-Process Operation**: Pruning must execute in under 1ms to prevent gating real-time tool loops.
- **Deterministic Preservation**: Critical instructions (system prompts, current active working memory, and immediate parent turn) must never be pruned.
- **Tool Payload Degradation**: Verbose tool outputs (e.g., massive database rows or raw HTML) have high token density but rapid obsolescence once processed by the agent.

## Considered Options
1. **FIFO Drop-Oldest Windowing**: Dropping messages once budget is exceeded.
2. **LLM Vector Re-summarization**: Invoking a lighter model (e.g. GPT-4o-mini / Haiku) to periodically summarize turns.
3. **Priority Cascade Token Pruner**: Deterministic multi-stage degradation algorithm.

## Decision
We adopted the **Priority Cascade Token Pruner**. The cascade executes in three distinct stages:

### Stage 1: Tool Output Compression (Lossless & Schema Summarization)
Historical tool messages older than 2 turns are condensed:
- JSON arrays are compacted into schema summaries with sample head/tail elements.
- Multi-line outputs are compressed to preserve initial header lines and termination status.
- Exact diffs replace redundant raw file dumps.

### Stage 2: Historical Dialogue Turn Eviction
If context remains above $(MaxTokens - ReservedOutput)$, intermediate dialogue turns (assistant $\leftrightarrow$ user turns between the initial instruction and current turn) are evicted oldest-first.

### Stage 3: Immutable Anchor Preservation
- **System Prompt (Turn 0)**: Preserved at priority 100.
- **Initial User Objective (Turn 1)**: Preserved at priority 95.
- **Immediate Working Context (Turns $N-1$, $N$)**: Preserved at priority 90.

## Consequences

### Positive
- **Extreme Speed**: Benchmarked at $5,800+$ prunes/sec ($0.17\text{ms}$ per 50-turn prune).
- **Zero Financial Cost**: No secondary LLM calls required.
- **100% Deterministic**: Given the same history and token ceiling, output is identical and reproducible in tests.

### Negative / Trade-offs
- Intermediate dialogue rationale is dropped rather than semantically synthesized. For tasks requiring long-range conversational memory spanning dozens of steps, agents must explicitly save intermediate state to files or scratchpads.
