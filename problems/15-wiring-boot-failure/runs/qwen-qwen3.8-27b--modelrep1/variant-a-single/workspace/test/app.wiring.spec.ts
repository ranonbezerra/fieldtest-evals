import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Wiring check.
 *
 * A passing typecheck only proves that names resolve to types, and a unit
 * test with a faked repository only proves one class works with
 * hand-built collaborators. Neither links the compiled module graph, and
 * neither runs Nest's injector over the real module tree. This spec does:
 * it builds with the project's own tsconfig, spawns the compiled
 * `dist/main.js` — the exact path `pnpm start` uses — waits for the
 * listen log, and round-trips `POST /exports`, a route whose controller
 * crosses a module boundary (`ExportsModule` consuming `UsersModule`).
 *
 * It fails when:
 * - the module graph crashes during evaluation (the original
 *   "Cannot access 'QUEUES' before initialization" reaches stderr and the
 *   child exits non-zero before the listen log),
 * - a provider is missing or a cross-module provider is not exported
 *   (Nest throws "Nest can't resolve dependencies of ..." at startup),
 * - a controller is not declared by its module (the probe gets 404),
 * - an injected collaborator is not live (the probe gets 500).
 */

const BOOT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 180_000;
const SHUTDOWN_GRACE_MS = 5_000;

function pickPort(): number {
  return 31_000 + Math.floor(Math.random() * 10_000);
}

function awaitStartup(child: ChildProcess, marker: string, timeoutMs: number): Promise<void> {
  const stdout = child.stdout!;
  const stderr = child.stderr!;

  return new Promise<void>((resolve, reject) => {
    let output = '';
    let settled = false;

    const settle = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.off('data', onData);
      stderr.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      done();
    };

    const timer = setTimeout(
      () => settle(() => reject(new Error(`boot timed out after ${timeoutMs} ms waiting for "${marker}".\n---\n${output}`))),
      timeoutMs,
    );

    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes(marker)) settle(() => resolve());
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      settle(() => reject(new Error(`application exited before startup (code=${code}, signal=${signal}).\n---\n${output}`)));

    const onError = (error: Error): void => settle(() => reject(error));

    stdout.on('data', onData);
    stderr.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const fallback = setTimeout(() => resolve(), SHUTDOWN_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(fallback);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

describe('application wiring', () => {
  it('boots the compiled app and serves a cross-module route', async () => {
    // Real tsc emit: Nest's constructor injection relies on the decorator
    // metadata that only the compiler emits.
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);

    const port = pickPort();
    const app = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await awaitStartup(app, `listening on ${port}`, BOOT_TIMEOUT_MS);

      const res = await fetch(`http://127.0.0.1:${port}/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedBy: 'wiring-check' }),
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { id: unknown; rows: unknown };
      expect(typeof body.id).toBe('string');
      expect(typeof body.rows).toBe('number');
    } finally {
      await stopChild(app);
    }
  }, TEST_TIMEOUT_MS);
});
