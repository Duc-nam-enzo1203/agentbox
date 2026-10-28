import { Result } from '../types/result.js';
import { AuditRecord } from '../types/domain.js';

export const GENESIS_HASH: string;

export interface AuditLoggerOptions {
  readonly logFilePath?: string | null;
  readonly secretKey?: string | null;
}

export interface LogActionParams {
  readonly callId: string;
  readonly agentId?: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly resultSummary?: {
    readonly status: string;
    readonly durationMs?: number;
    readonly error?: string | null;
    readonly outputSnippet?: string | null;
  };
}

export interface AuditQueryFilter {
  readonly agentId?: string;
  readonly toolName?: string;
  readonly status?: string;
  readonly limit?: number;
}

export interface VerificationSuccess {
  readonly verifiedEntries: number;
  readonly headHash: string;
}

export interface VerificationFailure {
  readonly error: string;
  readonly corruptedIndex: number;
}

export class AuditLogger {
  constructor(options?: AuditLoggerOptions);
  logAction(params: LogActionParams): AuditRecord;
  verifyIntegrity(customPath?: string | null): Result<VerificationSuccess, VerificationFailure>;
  query(filter?: AuditQueryFilter): readonly AuditRecord[];
  replay(params: {
    readonly agentId?: string;
    readonly executor: (call: { toolName: string; args: unknown; originalResult: unknown }) => Promise<unknown>;
  }): Promise<readonly { index: number; toolName: string; passed: boolean; diff?: unknown }[]>;
}
