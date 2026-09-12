import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { createServer } from 'node:net';

const BOOT_TIMEOUT_MS = 30_000;

/**
 * Boot check for the real application.
 *
 * Builds the app exactly like `pnpm start` does (`pnpm build && node
 * dist/main.js`) and starts the compiled process on an ephemeral port. This
 * fails when:
 *  - module evaluation crashes before Nest can start (e.g. a circular import
 *    that reads a binding before initialization — the original failure);
 *  - any provider is unresolvable: a provider no module owns, or a provider
 *    used across a module boundary that is not exported (Nest aborts
 *    bootstrap and the process never logs "listening");
 *  - the exports route no longer reaches ExportService through UsersModule.
 *
 * A typecheck is not this check (module wiring is runtime metadata), and a
 * unit test with the repository faked is not this check (it never loads the
 * module graph).
 */
describe('boot: compiled app starts with a resolvable module graph', () => {
  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  let port = 0;
  let output = '';

  const findFreePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const resolved = address && typeof address === 'object' ? address.port : 0;
        server.close(() => resolve(resolved));
      });
    });

  const waitUntil = (predicate: () => boolean, timeoutMs: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }
      }, 50);
    });

  beforeAll(async () => {
    execSync('pnpm build', { stdio: 'pipe' });
    port = await findFreePort();
    child = spawn('node', ['dist/main.js'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const exited = new Promise<number>((resolve) => {
      child!.on('exit', (code) => resolve(code ?? -1));
    });
    const ready = waitUntil(() => output.includes('listening on'), BOOT_TIMEOUT_MS).then(
      () => 'ready' as const,
    );

    const outcome = await Promise.race([ready, exited.then((code) => code)]);
    if (outcome !== 'ready') {
      throw new Error(`application did not start (exit ${outcome}):\n${output}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });

  it('serves POST /exports through the ExportsModule -> UsersModule boundary', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestedBy: 'u1' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'exp_u1_0', rows: 0 });
  });

  it('keeps serving after the first request, with requestedBy flowing into the job id', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestedBy: 'u2' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'exp_u2_0', rows: 0 });
  });
});
