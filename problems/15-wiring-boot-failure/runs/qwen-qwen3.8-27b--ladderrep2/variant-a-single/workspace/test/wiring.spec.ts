import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Wiring check: build the real application context the same way production
 * does (`tsc -p tsconfig.build.json` + `node dist/main.js`) and prove the app
 * reaches its listening state and serves a real request.
 *
 * This is the guard the incident needs. A constant trapped in an import cycle
 * (temporal-dead-zone crash), a provider missing from `providers`, or a token
 * missing from `exports` all pass `tsc --noEmit` and the fake-based unit
 * suite, but all of them kill exactly this boot.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireModule = createRequire(import.meta.url);
const tscBinary = requireModule.resolve('typescript/bin/tsc');

const PORT = 20000 + Math.floor(Math.random() * 10000);
const LISTEN_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

interface BootReport {
  status: number;
  payload: unknown;
  serverLog: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function compileWithProjectTsc(): void {
  execFileSync(process.execPath, [tscBinary, '-p', 'tsconfig.build.json'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

async function bootApp(): Promise<BootReport> {
  const child = spawn(process.execPath, [resolve(projectRoot, 'dist', 'main.js')], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  const appendLog = (chunk: Buffer): void => {
    serverLog += chunk.toString();
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClosed) => {
    child.on('close', (code, signal) => resolveClosed({ code, signal }));
  });

  const stopChild = async (): Promise<void> => {
    child.kill('SIGTERM');
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
      await sleep(100);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await closed;
  };

  try {
    const startedAt = Date.now();
    for (;;) {
      if (serverLog.includes('listening on')) break;
      const outcome = await Promise.race([
        closed.then((result) => ({ kind: 'closed' as const, ...result })),
        sleep(100).then(() => ({ kind: 'tick' as const })),
      ]);
      if (outcome.kind === 'closed') {
        throw new Error(
          `the app exited before it could listen (exit code ${outcome.code ?? 'n/a'}, signal ${outcome.signal ?? 'n/a'}):\n` +
            serverLog,
        );
      }
      if (Date.now() - startedAt > LISTEN_TIMEOUT_MS) {
        throw new Error(
          `the app did not reach its listening state within ${LISTEN_TIMEOUT_MS} ms:\n` + serverLog,
        );
      }
    }

    let status = 0;
    let payload: unknown;
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedBy: 'wiring-check' }),
      });
      status = response.status;
      payload = await response.json();
    } catch (probeError) {
      throw new Error(`probing the booted server failed: ${String(probeError)}\n--- server log ---\n${serverLog}`);
    }
    return { status, payload, serverLog };
  } finally {
    await stopChild();
  }
}

describe('application wiring (real boot of the compiled entry)', () => {
  it('boots to the listening state and serves the real export route', async () => {
    compileWithProjectTsc();

    const { status, payload, serverLog } = await bootApp();

    expect(serverLog).toContain('listening on');
    expect(status).toBe(201);
    expect(payload).toEqual({ id: 'exp_wiring-check_0', rows: 0 });
  }, 120_000);
});
