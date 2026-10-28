import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../src/security/policy_engine.js';
import { isOk, isErr, unwrap } from '../src/types/result.js';

describe('PolicyEngine Capability-Based Security', () => {
  const policy = new PolicyEngine();

  it('permits authorized roles to invoke matching tools', () => {
    // Analyst can read workspace
    const res1 = policy.evaluate({
      role: 'analyst',
      toolName: 'workspace:read_file',
      args: { path: 'data.csv' },
    });
    assert.ok(isOk(res1));
    assert.equal(unwrap(res1).allowed, true);

    // Analyst can eval python expression
    const res2 = policy.evaluate({
      role: 'analyst',
      toolName: 'python:eval_expression',
      args: { expr: 'sum([1, 2, 3])' },
    });
    assert.ok(isOk(res2));
  });

  it('rejects unauthorized tools for restricted roles', () => {
    // Analyst cannot write files
    const res = policy.evaluate({
      role: 'analyst',
      toolName: 'workspace:write_file',
      args: { path: 'hack.sh', content: 'echo 1' },
    });
    assert.ok(isErr(res));
    assert.equal(res.error.violationType, 'EXPLICIT_DENY');
  });

  it('blocks dangerous argument patterns (command injection / deletion)', () => {
    // Attempt rm -rf inside code or arguments
    const res = policy.evaluate({
      role: 'developer',
      toolName: 'workspace:run_script',
      args: { command: 'rm -rf /var/data' },
    });
    assert.ok(isErr(res));
    assert.equal(res.error.violationType, 'ARGUMENT_INJECTION_DETECTED');
    assert.match(res.error.reason, /Destructive deletion command/);
  });

  it('blocks egress network tools in bash', () => {
    const res = policy.evaluate({
      role: 'admin',
      toolName: 'bash:run',
      args: { command: 'curl http://malicious-exfiltration.com' },
    });
    assert.ok(isErr(res));
    assert.equal(res.error.violationType, 'ARGUMENT_INJECTION_DETECTED');
    assert.match(res.error.reason, /Unrestricted egress network/);
  });

  it('blocks payloads exceeding size ceiling', () => {
    const tinyPolicy = new PolicyEngine({ maxArgSizeBytes: 50 });
    const res = tinyPolicy.evaluate({
      role: 'admin',
      toolName: 'test_tool',
      args: { data: 'A'.repeat(100) },
    });
    assert.ok(isErr(res));
    assert.equal(res.error.violationType, 'PAYLOAD_TOO_LARGE');
  });
});
