import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../src/gateway/registry.js';
import { isOk, isErr } from '../src/types/result.js';

describe('ToolRegistry', () => {
  it('registers tools and retrieves them', () => {
    const registry = new ToolRegistry();
    const regResult = registry.register({
      name: 'calculate_sum',
      description: 'Adds two numbers together',
      parameters: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
      },
      execute: async ({ a, b }) => a + b,
    });

    assert.strictEqual(isOk(regResult), true);
    assert.strictEqual(registry.list().length, 1);
    assert.ok(registry.get('calculate_sum'));
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    const tool = {
      name: 'ping',
      description: 'ping tool',
      parameters: {},
      execute: async () => 'pong',
    };

    assert.strictEqual(isOk(registry.register(tool)), true);
    const dup = registry.register(tool);
    assert.strictEqual(isErr(dup), true);
    if (isErr(dup)) {
      assert.strictEqual(dup.error.code, 'DUPLICATE_TOOL');
    }
  });

  it('validates required fields and argument types', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'greet',
      description: 'Greets someone',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
      execute: async () => 'ok',
    });

    // Missing required
    const missing = registry.validateArguments('greet', {});
    assert.strictEqual(isErr(missing), true);

    // Wrong type
    const wrongType = registry.validateArguments('greet', { name: 123 });
    assert.strictEqual(isErr(wrongType), true);

    // Valid
    const valid = registry.validateArguments('greet', { name: 'Alice', age: 30 });
    assert.strictEqual(isOk(valid), true);
  });
});
