import { ok, err } from '../types/result.js';

/**
 * Capability-Based Access Control and Security Policy Engine for AI Agents.
 * 
 * Enforces fine-grained authorization, argument sanitization rules, and
 * dangerous payload prevention before any tool reaches the sandbox.
 */
export class PolicyEngine {
  /**
   * @param {Object} [config]
   * @param {Record<string, { allow: string[], deny?: string[], maxCallsPerMin?: number }>} [config.roles]
   * @param {Array<{ pattern: RegExp | string, toolPattern?: string, reason: string }>} [config.argRules]
   * @param {number} [config.maxArgSizeBytes=1048576] - 1MB default
   */
  constructor(config = {}) {
    this.roles = config.roles || {
      admin: {
        allow: ['*'],
        deny: [],
      },
      developer: {
        allow: ['workspace:*', 'python:*', 'eval:*', 'git:*'],
        deny: ['system:shutdown', 'system:delete_root'],
      },
      analyst: {
        allow: ['workspace:read_*', 'python:eval_expression', 'sql:query'],
        deny: ['workspace:write_*', 'workspace:delete_*', 'bash:*'],
      },
      untrusted: {
        allow: ['python:eval_expression'],
        deny: ['workspace:*', 'bash:*', 'system:*'],
      },
    };

    this.argRules = config.argRules || [
      {
        pattern: /(?:rm\s+-rf|del\s+\/[fq]|format\s+[a-z]:)/i,
        toolPattern: '*',
        reason: 'Destructive deletion command blocked by security policy',
      },
      {
        pattern: /(?:\/etc\/shadow|\/etc\/passwd|c:\\windows\\system32)/i,
        toolPattern: '*',
        reason: 'Sensitive operating system file access prohibited',
      },
      {
        pattern: /(?:curl\s+|wget\s+|Invoke-WebRequest)/i,
        toolPattern: 'bash:*',
        reason: 'Unrestricted egress network access forbidden in sandbox',
      },
    ];

    this.maxArgSizeBytes = config.maxArgSizeBytes || 1024 * 1024; // 1MB
    this.callCounters = new Map(); // agentId -> { count, windowStart }
  }

  /**
   * Matches a tool name against a wildcard pattern like 'workspace:*' or '*'.
   * @private
   */
  _matchPattern(toolName, pattern) {
    if (pattern === '*') return true;
    if (pattern === toolName) return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    return false;
  }

  /**
   * Enforces sliding rate limits per agent.
   * @private
   */
  _checkRateLimit(agentId, maxCallsPerMin) {
    if (!maxCallsPerMin) return true;

    const now = Date.now();
    const windowMs = 60_000;
    const current = this.callCounters.get(agentId) || { count: 0, windowStart: now };

    if (now - current.windowStart > windowMs) {
      current.count = 1;
      current.windowStart = now;
      this.callCounters.set(agentId, current);
      return true;
    }

    current.count++;
    this.callCounters.set(agentId, current);
    return current.count <= maxCallsPerMin;
  }

  /**
   * Recursively inspects argument objects for malicious regex patterns.
   * @private
   */
  _inspectArgs(value, toolName) {
    if (value === null || value === undefined) return null;

    if (typeof value === 'string') {
      for (const rule of this.argRules) {
        if (rule.toolPattern && !this._matchPattern(toolName, rule.toolPattern)) {
          continue;
        }

        const regex = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern, 'i');
        if (regex.test(value)) {
          return rule.reason;
        }
      }
      return null;
    }

    if (typeof value === 'object') {
      for (const val of Object.values(value)) {
        const violation = this._inspectArgs(val, toolName);
        if (violation) return violation;
      }
    }

    return null;
  }

  /**
   * Evaluates whether an agent with a given role is authorized to execute a tool.
   * 
   * @param {Object} context
   * @param {string} [context.agentId='default']
   * @param {string} [context.role='untrusted']
   * @param {string} context.toolName
   * @param {any} [context.args]
   * @returns {import('../types/result.js').Result<{ allowed: true }, { allowed: false, reason: string, violationType: string }>}
   */
  evaluate(context) {
    const agentId = context.agentId || 'default';
    const roleName = context.role || 'untrusted';
    const toolName = context.toolName;
    const args = context.args || {};

    // 1. Role existence check
    const rolePolicy = this.roles[roleName];
    if (!rolePolicy) {
      return err({
        allowed: false,
        violationType: 'UNKNOWN_ROLE',
        reason: `Role '${roleName}' is not defined in policy engine`,
      });
    }

    // 2. Deny list evaluation (Deny rules take strict precedence)
    if (rolePolicy.deny) {
      for (const denyPattern of rolePolicy.deny) {
        if (this._matchPattern(toolName, denyPattern)) {
          return err({
            allowed: false,
            violationType: 'EXPLICIT_DENY',
            reason: `Tool '${toolName}' is explicitly forbidden for role '${roleName}' (matched '${denyPattern}')`,
          });
        }
      }
    }

    // 3. Allow list evaluation
    const isAllowed = (rolePolicy.allow || []).some(allowPattern => this._matchPattern(toolName, allowPattern));
    if (!isAllowed) {
      return err({
        allowed: false,
        violationType: 'NOT_AUTHORIZED',
        reason: `Tool '${toolName}' is not permitted for role '${roleName}'`,
      });
    }

    // 4. Rate limit check
    if (!this._checkRateLimit(agentId, rolePolicy.maxCallsPerMin)) {
      return err({
        allowed: false,
        violationType: 'RATE_LIMIT_EXCEEDED',
        reason: `Agent '${agentId}' exceeded rate limit of ${rolePolicy.maxCallsPerMin} calls/min for role '${roleName}'`,
      });
    }

    // 5. Payload size guard
    const payloadStr = JSON.stringify(args);
    if (payloadStr.length > this.maxArgSizeBytes) {
      return err({
        allowed: false,
        violationType: 'PAYLOAD_TOO_LARGE',
        reason: `Argument payload size (${payloadStr.length} bytes) exceeds maximum ceiling of ${this.maxArgSizeBytes} bytes`,
      });
    }

    // 6. Deep argument pattern inspection (Prevent injection attacks)
    const argViolation = this._inspectArgs(args, toolName);
    if (argViolation) {
      return err({
        allowed: false,
        violationType: 'ARGUMENT_INJECTION_DETECTED',
        reason: argViolation,
      });
    }

    return ok({ allowed: true });
  }
}
