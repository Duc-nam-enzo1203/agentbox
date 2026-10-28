import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PythonSupervisor } from '../src/sandbox/python_supervisor.js';

describe('PythonSupervisor Isolated Execution', () => {
  const options = {
    timeoutMs: 2000,
    maxMemoryMb: 64,
    workspaceRoot: process.cwd(),
  };

  it('executes safe Python mathematical code', async () => {
    const res = await PythonSupervisor.executeScript(
      'print(2 ** 16)',
      options
    );

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.data?.trim(), '65536');
  });

  it('kills Python infinite loops via timeout watchdog', async () => {
    const res = await PythonSupervisor.executeScript(
      'while True: pass',
      { ...options, timeoutMs: 300 }
    );

    assert.strictEqual(res.status, 'timeout');
    assert.ok(res.error?.includes('timed out'));
  });

  it('scrubs ambient parent environment secrets from Python os.environ', async () => {
    process.env['PYTHON_PARENT_SECRET'] = 'classified_key_xyz';

    const res = await PythonSupervisor.executeScript(
      'import os; print(os.environ.get("PYTHON_PARENT_SECRET", "SCRUBBED"))',
      options
    );

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.data?.trim(), 'SCRUBBED');

    delete process.env['PYTHON_PARENT_SECRET'];
  });
});
