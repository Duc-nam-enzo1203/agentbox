/**
 * Core Domain Interfaces & Contracts for AgentBox
 */

export type JSONSchema = Record<string, unknown>;

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  readonly execute: (args: TArgs, ctx: ExecutionContext) => Promise<TResult>;
}

export interface ExecutionContext {
  readonly callId: string;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
  readonly log: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
}

export type ExecutionStatus = 
  | 'completed'
  | 'timeout'
  | 'oom_killed'
  | 'security_violation'
  | 'cancelled'
  | 'error';

export interface SandboxOptions {
  readonly timeoutMs: number;
  readonly maxMemoryMb: number;
  readonly workspaceRoot: string;
  readonly allowedEnvVars?: readonly string[];
  readonly maxOutputSizeBytes?: number;
}

export interface ToolExecutionResponse<T = unknown> {
  readonly callId: string;
  readonly status: ExecutionStatus;
  readonly data?: T;
  readonly error?: string;
  readonly durationMs: number;
  readonly memoryUsedBytes?: number;
  readonly stderr?: string;
}

export type PruningStrategy = 'drop-oldest' | 'summarize-history' | 'priority-cascade';

export interface TokenBudgetOptions {
  readonly maxContextTokens: number;
  readonly reserveTokensForOutput: number;
  readonly strategy: PruningStrategy;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly tool_call_id?: string;
}

export interface PruningReport {
  readonly originalTokens: number;
  readonly finalTokens: number;
  readonly tokensSaved: number;
  readonly droppedMessagesCount: number;
  readonly messages: readonly ChatMessage[];
}

export interface AuditRecord {
  readonly index: number;
  readonly timestamp: string;
  readonly callId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly resultSummary: {
    readonly status: string;
    readonly durationMs: number;
    readonly error?: string | null;
    readonly outputSnippet?: string | null;
  };
  readonly prevHash: string;
  readonly hash: string;
}

export interface PolicyRoleConfig {
  readonly allow: readonly string[];
  readonly deny?: readonly string[];
  readonly maxCallsPerMin?: number;
}

export interface PolicyViolation {
  readonly allowed: false;
  readonly violationType: 'UNKNOWN_ROLE' | 'EXPLICIT_DENY' | 'NOT_AUTHORIZED' | 'RATE_LIMIT_EXCEEDED' | 'PAYLOAD_TOO_LARGE' | 'ARGUMENT_INJECTION_DETECTED';
  readonly reason: string;
}

export interface PolicyAuthorization {
  readonly allowed: true;
}

export type PolicyDecision = PolicyAuthorization | PolicyViolation;
