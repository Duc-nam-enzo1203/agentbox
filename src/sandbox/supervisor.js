import { spawn } from 'node:child_process';

export class ProcessSupervisor {
  constructor(defaultOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  async execute(script, overrideOptions = {}, signal) {
    return ProcessSupervisor.executeScript(script, { ...this.defaultOptions, ...overrideOptions }, signal);
  }

  static SAFE_DEFAULT_ENV_KEYS = [
    'PATH',
    'NODE_ENV',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
  ];

  static async executeScript(script, options, signal) {
    const callId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
    scrubbedEnv['NODE_ENV'] = scrubbedEnv['NODE_ENV'] || 'production';

    // 2. Prepare isolated Node CLI arguments
    const nodeArgs = [
      `--max-old-space-size=${options.maxMemoryMb}`,
      '--no-deprecation',
      '-e',
      script,
    ];

    let child;
    try {
      child = spawn(process.execPath, nodeArgs, {
        cwd: options.workspaceRoot,
        env: scrubbedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (launchErr) {
      return {
        callId,
        status: 'error',
        error: launchErr instanceof Error ? launchErr.message : String(launchErr),
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

    // 3. Dual-stage Timeout Watchdog
    timeoutTimer = setTimeout(() => {
      if (!isTerminated) {
        status = 'timeout';
        isTerminated = true;
        child.kill('SIGTERM');

        // Grace period before uncatchable kill
        forceKillTimer = setTimeout(() => {
          try {
            if (process.platform === 'win32') {
              if (child.pid) spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
            } else {
              child.kill('SIGKILL');
            }
          } catch {
            // Process might have already exited
          }
        }, 250);
      }
    }, options.timeoutMs);

    // 4. AbortSignal listener for caller cancellation
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

    const maxBytes = options.maxOutputSizeBytes || 1024 * 1024; // 1MB default

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
            error: `Execution timed out after ${options.timeoutMs}ms.`,
            stderr: stderrData,
            durationMs,
          });
        }

        if (status === 'cancelled') {
          return resolve({
            callId,
            status: 'cancelled',
            error: 'Execution cancelled by caller.',
            stderr: stderrData,
            durationMs,
          });
        }

        // Detect Out-of-Memory / Heap / Buffer allocation crashes
        const isOOM = 
          stderrData.includes('JavaScript heap out of memory') ||
          stderrData.includes('Allocation failed - JavaScript heap out of memory') ||
          stderrData.includes('Array buffer allocation failed') ||
          stderrData.includes('Ineffective mark-compacts near heap limit') ||
          code === 134 || code === 137;

        if (isOOM) {
          return resolve({
            callId,
            status: 'oom_killed',
            error: `Process exceeded memory ceiling of ${options.maxMemoryMb}MB and was killed.`,
            stderr: stderrData,
            durationMs,
          });
        }

        if (code !== 0) {
          return resolve({
            callId,
            status: 'error',
            error: `Process exited with code ${code}${killSignal ? ` (signal: ${killSignal})` : ''}`,
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
          error: err.message,
          durationMs: performance.now() - startTime,
        });
      });
    });
  }
}
