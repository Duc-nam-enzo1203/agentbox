import { Result } from '../types/result.js';
import { PolicyRoleConfig, PolicyDecision } from '../types/domain.js';

export interface ArgRule {
  readonly pattern: RegExp | string;
  readonly toolPattern?: string;
  readonly reason: string;
}

export interface PolicyEngineConfig {
  readonly roles?: Record<string, PolicyRoleConfig>;
  readonly argRules?: readonly ArgRule[];
  readonly maxArgSizeBytes?: number;
}

export interface PolicyEvaluationContext {
  readonly agentId?: string;
  readonly role?: string;
  readonly toolName: string;
  readonly args?: unknown;
}

export class PolicyEngine {
  constructor(config?: PolicyEngineConfig);
  evaluate(context: PolicyEvaluationContext): Result<{ readonly allowed: true }, { readonly allowed: false; readonly reason: string; readonly violationType: string }>;
}
