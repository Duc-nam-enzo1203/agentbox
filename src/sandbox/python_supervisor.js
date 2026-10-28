import { spawn } from 'node:child_process';

export class PythonSupervisor {
  constructor(defaultOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  async execute(script, overrideOptions = {}, signal) {
    return PythonSupervisor.executeScript(script, { ...this.defaultOptions, ...overrideOptions }, signal);
  }

  static SAFE_DEFAULT_ENV_KEYS = [
    'PATH',
    'SYSTEMROOT',
    'TMPDIR',
    'TEMP',
    'TMP',
    'PYTHONPATH',
  ];

  static async executeScript(script, options, signal) {
    const callId = `py_exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = performance.now();

    // 1. Scrub environment variables
    const allowedKeys = new Set([
      ...this.SAFE_DEFAULT_ENV_KEYS,
      ...(options.allowedEnvVars || []),
    ]);

    const scrubbedEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (allowedKeys.has(key) && value !== undefined) {
        scrubbedEnv[key] = value;
      }
    }

    // 2. Wrap script with memory and output limits where supported
    const memoryLimitBytes = (options.maxMemoryMb || 64) * 1024 * 1024;
    const wrappedScript = `
import sys
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (${memoryLimitBytes}, ${memoryLimitBytes}))
except Exception:
    pass

${script}
`;

    // Try python3, fallback to python
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

    let child;
    try {
      child = spawn(pythonBin, ['-c', wrappedScript], {
        cwd: options.workspaceRoot,
        env: scrubbedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (launchErr) {
      return {
        callId,
        status: 'error',
        error: `Failed to spawn Python runtime (${pythonBin}): ${launchErr.message}`,
        durationMs: performance.now() - startTime,
      };
    }

    let stdoutData = '';
    let stderrData = '';
    let status = 'completed';
    let isTerminated = false;
    let timeoutTimer = null;
    let forceKillTimer = null;

    const cleanupTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    // 3. Timeout Watchdog
    timeoutTimer = setTimeout(() => {
      if (!isTerminated) {
        status = 'timeout';
        isTerminated = true;
        child.kill('SIGTERM');

        forceKillTimer = setTimeout(() => {
          try {
            if (process.platform === 'win32') {
              if (child.pid) spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
            } else {
              child.kill('SIGKILL');
            }
          } catch {
            // Process exited
          }
        }, 250);
      }
    }, options.timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!isTerminated) {
          status = 'cancelled';
          isTerminated = true;
          cleanupTimers();
          child.kill('SIGKILL');
        }
      }, { once: true });
    }

    const maxBytes = options.maxOutputSizeBytes || 1024 * 1024;

    child.stdout?.on('data', (chunk) => {
      if (stdoutData.length < maxBytes) {
        stdoutData += chunk.toString('utf8');
      }
    });

    child.stderr?.on('data', (chunk) => {
      if (stderrData.length < maxBytes) {
        stderrData += chunk.toString('utf8');
      }
    });

    return new Promise((resolve) => {
      child.on('close', (code, killSignal) => {
        cleanupTimers();
        const durationMs = performance.now() - startTime;

        if (status === 'timeout') {
          return resolve({
            callId,
            status: 'timeout',
            error: `Python execution timed out after ${options.timeoutMs}ms.`,
            stderr: stderrData,
            durationMs,
          });
        }

        if (status === 'cancelled') {
          return resolve({
            callId,
            status: 'cancelled',
            error: 'Python execution cancelled by caller.',
            stderr: stderrData,
            durationMs,
          });
        }

        const isOOM = stderrData.includes('MemoryError') || code === 134 || code === 137;
        if (isOOM) {
          return resolve({
            callId,
            status: 'oom_killed',
            error: `Python process exceeded memory ceiling of ${options.maxMemoryMb}MB.`,
            stderr: stderrData,
            durationMs,
          });
        }

        if (code !== 0) {
          return resolve({
            callId,
            status: 'error',
            error: `Python exited with code ${code}${killSignal ? ` (${killSignal})` : ''}`,
            stderr: stderrData,
            data: stdoutData,
            durationMs,
          });
        }

        return resolve({
          callId,
          status: 'completed',
          data: stdoutData,
          stderr: stderrData,
          durationMs,
        });
      });

      child.on('error', (err) => {
        cleanupTimers();
        resolve({
          callId,
          status: 'error',
          error: `Python runtime error: ${err.message}`,
          durationMs: performance.now() - startTime,
        });
      });
    });
  }
}
