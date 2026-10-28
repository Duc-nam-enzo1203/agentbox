import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SemanticCompactor } from '../src/budgeter/semantic_compactor.js';

describe('SemanticCompactor', () => {
  it('compacts massive tabular JSON arrays into schema summaries', () => {
    const rawData = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      username: `user_${i}`,
      email: `user_${i}@example.com`,
      score: Math.random() * 100,
    }));
    const rawJson = JSON.stringify(rawData);

    const res = SemanticCompactor.compact(rawJson, 500);

    assert.ok(res.finalChars < res.originalChars);
    assert.ok(res.compacted.includes('Summary of 50 tabular items'));
    assert.ok(res.compacted.includes('Fields: id, username, email, score'));
  });

  it('compacts long multi-line outputs while preserving head and tail', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Log line #${i}: Operation completed successfully.`);
    const rawText = lines.join('\n');

    const res = SemanticCompactor.compact(rawText, 500);

    assert.ok(res.finalChars < res.originalChars);
    assert.ok(res.compacted.includes('Log line #0'));
    assert.ok(res.compacted.includes('Log line #59'));
    assert.ok(res.compacted.includes('Omitted'));
  });

  it('generates line-level diff summaries', () => {
    const original = 'line 1\nline 2\nline 3';
    const modified = 'line 1\nline 2 edited\nline 3\nline 4 added';

    const diff = SemanticCompactor.generateDiffSummary(original, modified);
    assert.ok(diff.summary.includes('+2 lines, -1 lines'));
    assert.ok(diff.diff.includes('- line 2'));
    assert.ok(diff.diff.includes('+ line 2 edited'));
    assert.ok(diff.diff.includes('+ line 4 added'));
  });
});
