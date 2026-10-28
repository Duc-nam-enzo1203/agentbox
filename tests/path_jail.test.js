import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { PathJail } from '../src/sandbox/path_jail.js';
import { isOk, isErr } from '../src/types/result.js';

describe('PathJail Security Boundaries', () => {
  const root = path.resolve(process.cwd(), 'test_workspace');
  const jail = new PathJail(root);

  it('allows safe relative paths inside workspace', () => {
    const res = jail.resolveSafe('src/index.js');
    assert.strictEqual(isOk(res), true);
    if (isOk(res)) {
      assert.strictEqual(res.value, path.join(root, 'src', 'index.js'));
    }
  });

  it('blocks path traversal attacks using dot-dot', () => {
    const attack1 = jail.resolveSafe('../../etc/passwd');
    assert.strictEqual(isErr(attack1), true);
    if (isErr(attack1)) {
      assert.strictEqual(attack1.error.code, 'PATH_ESCAPE');
    }

    const attack2 = jail.resolveSafe('subfolder/../../..');
    assert.strictEqual(isErr(attack2), true);
  });

  it('blocks absolute paths outside workspace', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/shadow';
    const res = jail.resolveSafe(outside);
    assert.strictEqual(isErr(res), true);
    if (isErr(res)) {
      assert.strictEqual(res.error.code, 'PATH_ESCAPE');
    }
  });
});
