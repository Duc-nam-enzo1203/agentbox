import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TokenBudgeter } from '../src/budgeter/pruner.js';

describe('TokenBudgeter Context Pruner', () => {
  it('estimates token counts with consistent ratios', () => {
    const text = 'Hello world, this is a test of token estimation for AgentBox.';
    const tokens = TokenBudgeter.estimateTokens(text);
    assert.ok(tokens > 10);
    assert.ok(tokens < 30);
  });

  it('preserves all messages when within budget', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful coding assistant.' },
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', content: '4' },
    ];

    const report = TokenBudgeter.prune(messages, {
      maxContextTokens: 1000,
      reserveTokensForOutput: 200,
      strategy: 'priority-cascade',
    });

    assert.strictEqual(report.droppedMessagesCount, 0);
    assert.strictEqual(report.messages.length, 3);
    assert.strictEqual(report.tokensSaved, 0);
  });

  it('compresses historical tool outputs and preserves system + latest turn', () => {
    const massiveToolOutput = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, payload: 'data' })));

    const messages = [
      { role: 'system', content: 'System instruction: always be concise.' },
      { role: 'user', content: 'First user prompt' },
      { role: 'tool', content: massiveToolOutput },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent response' },
    ];

    const report = TokenBudgeter.prune(messages, {
      maxContextTokens: 120,
      reserveTokensForOutput: 30,
      strategy: 'priority-cascade',
    });

    assert.ok(report.finalTokens <= 90);
    assert.ok(report.tokensSaved > 0);
    assert.strictEqual(report.messages[0].role, 'system');
    const lastMsg = report.messages[report.messages.length - 1];
    assert.strictEqual(lastMsg.content, 'Recent response');
  });
});
