# repair1-set

## reasoning

```
Let me analyze the errors:

1. `test/app.wiring.spec.ts(97,26)`: `ChildProcessByStdio<null, Readable, Readable>` is not assignable to `ChildProcessWithoutNullStreams` - because `stdin` is `null` (from `stdio: ['ignore', 'pipe', 'pipe']`) but `ChildProcessWithoutNullStreams` expects `stdin` to be `Writable`.

2. `test/app.wiring.spec.ts(110,23)`: Same issue.

The problem is clear: `stdio: ['ignore', 'pipe', 'pipe']` makes `stdin` null, which gives type `ChildProcessByStdio<null, Readable, Readable>`. But the functions `awaitStartup` and `stopChild` expect `ChildProcessWithoutNullStreams` which requires `stdin` to be a `Writable`.

The fix: The functions `awaitStartup` and `stopChild` only use `stdout`, `stderr`, and process events (`exit`, `error`). They don't use `stdin` at all. So the correct type to use is `ChildProcessByStdio<null, Readable, Readable>` or more generically we could use `ChildProcess` (the base type).

Wait, let me look more carefully. The `spawn` call uses `stdio: ['ignore', 'pipe', 'pipe']` which gives `ChildProcessByStdio<null, Readable, Readable>`. The functions are typed to accept `ChildProcessWithoutNullStreams` which expects all three to be streams.

The simplest fix that changes exactly what the compiler requires: change the type annotations on `awaitStartup` and `stopChild` from `ChildProcessWithoutNullStreams` to `ChildProcessByStdio<null, Readable, Readable>`, or better, use the base `ChildProcess` type since they only access `stdout`, `stderr`, `exit`, `error`, `kill`, `exitCode`, `signalCode`.

Actually, looking at what properties are used:
- `child.stdout.on('data', ...)` and `child.stdout.off('data', ...)`
- `child.stderr.on('data', ...)` and `child.stderr.off('data', ...)`
- `child.on('exit', ...)`
- `child.on('error', ...)`
- `child.once('exit', ...)`
- `child.kill('SIGTERM')`
- `child.exitCode`
- `child.signalCode`

All of these are available on the base `ChildProcess` type. But `child.stdout` and `child.stderr` on the base `ChildProcess` are typed as `Readable` (not nullable), so that works.

Actually wait - let me check. In Node's type definitions, `ChildProcess` has:
- `stdout: Readable`
- `stderr: Readable`
- `stdin: Writable`

But when stdio is `['ignore', 'pipe', 'pipe']`, the actual type is `ChildProcessByStdio<null, Readable, Readable>` where `stdin` is `null`.

The base `ChildProcess` type should work since we're not accessing `stdin`. Let me use `ChildProcess` from `node:child_process`.

Wait, but `ChildProcess` in the type definitions - let me think about this more carefully. In `@types/node`, `ChildProcess` has `stdout: Readable` and `stderr: Readable` as non-nullable. But `ChildProcessByStdio<null, Readable, Readable>` has `stdin: null` and `stdout: Readable` and `stderr: Readable`.

So the fix is to change the type parameter from `ChildProcessWithoutNullStreams` to `ChildProcessByStdio<null, Readable, Readable>`, or simply `ChildProcess`.

Actually, the cleanest fix that's minimal: change the type to `ChildProcess` since that's the base type and all the properties accessed are on it. But wait - does `ChildProcess` have `stdout` and `stderr` as non-nullable? Let me check...

In Node.js type definitions, `ChildProcess` extends `stream.Duplex` and has:
- `readonly stdout: Readable`  
- `readonly stderr: Readable`
- `readonly stdin: Writable`

Hmm, but `ChildProcessByStdio<null, Readable, Readable>` would have `stdin: null`. The base `ChildProcess` interface might have `stdin: Writable` which would be a lie for our case but since we don't access `stdin`, it doesn't matter for type checking.

Actually, the simplest and most correct fix: use `ChildProcessByStdio<null, Readable, Readable>`. But that requires importing `Readable` from `node:stream`.

Alternatively, the even simpler fix: just use `ChildProcess` from `node:child_process`. All the properties we access (`stdout`, `stderr`, `on`, `once`, `off`, `kill`, `exitCode`, `signalCode`) are on `ChildProcess`.

Wait, does `ChildProcess` have `.off()`? Let me think... `ChildProcess` extends `Duplex` which extends `Stream` which has `.off()`. Yes, it does.

So the fix is:
1. Import `ChildProcess` instead of (or in addition to) `ChildProcessWithoutNullStreams`
2. Change the type annotations on `awaitStartup` and `stopChild` from `ChildProcessWithoutNullStreams` to `ChildProcess`

Let me write the complete file with this fix applied.
```

## reply

### test/app.wiring.spec.ts
```ts
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
  return new Promise<void>((resolve, reject) => {
    let output = '';
    let settled = false;

    const settle = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
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

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
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
```
