# repair1-set

## reasoning

```
Let me analyze the errors in `test/wiring.spec.ts`:

1. `test/wiring.spec.ts(59,5): error TS2322: Type 'ChildProcessByStdio<null, Readable, Readable>' is not assignable to type 'ChildProcessWithoutNullStreams'.`
   - This is because `stdio: ['ignore', 'pipe', 'pipe']` creates a `ChildProcessByStdio<null, Readable, Readable>` (stdin is null because of 'ignore'), but the variable is typed as `ChildProcessWithoutNullStreams`.

2. `test/wiring.spec.ts(63,5): error TS18048: 'child' is possibly 'undefined'.`
3. `test/wiring.spec.ts(66,5): error TS18048: 'child' is possibly 'undefined'.`
4. `test/wiring.spec.ts(71,7): error TS18048: 'child' is possibly 'undefined'.`

These are all in the `beforeAll` block where `child` is assigned and then used. TypeScript's control flow analysis doesn't narrow the type after assignment in this context because `child` is declared with `| undefined` at the top.

Let me look at the code:

```ts
let child: ChildProcessWithoutNullStreams | undefined;

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
      child.on('exit', (code) => resolve(code ?? -1));
    });
    ...
```

The distinct mistakes:

1. **Type mismatch on `child`**: The `stdio` option uses `'ignore'` for stdin, which means the returned type is `ChildProcessByStdio<null, Readable, Readable>`, not `ChildProcessWithoutNullStreams`. The fix is to change the type annotation to match what `spawn` actually returns, or use the correct type.

   The correct type would be `ChildProcessByStdio<null, Readable, Readable>` or we could use a simpler approach. Actually, looking at Node.js types, `ChildProcessByStdio<null, Readable, Readable>` is what you get when stdin is `'ignore'`. 

   Alternatively, we could just type it as `ChildProcess` which is the base type that all variants extend.

   Wait, let me think about this more carefully. The simplest fix that aligns with the code's intent:
   - The variable is declared as `ChildProcessWithoutNullStreams | undefined`
   - The actual return type from `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` is `ChildProcessByStdio<null, Readable, Readable>`

   The fix: change the type to match. We need to import `ChildProcessByStdio` and `Readable`, or we can use a different approach.

   Actually, the simplest approach: since we're using `stdio: ['ignore', 'pipe', 'pipe']`, the type is `ChildProcessByStdio<null, Readable, Readable>`. We need to import `Readable` from `node:stream` and `ChildProcessByStdio` from `node:child_process`.

   Or even simpler: just use `ChildProcess` as the type since we only need `.stdout`, `.stderr`, `.on`, `.kill`, and `.exitCode`.

   Wait, but the constraint says "Change exactly what the compiler requires." Let me think about what's minimal.

   Option A: Change the type annotation to `ChildProcessByStdio<null, Readable, Readable> | undefined` and import the needed types.

   Option B: Change the type annotation to `ChildProcess | undefined` and import `ChildProcess`.

   Option B is simpler and sufficient since we only use `.stdout`, `.stderr`, `.on('exit', ...)`, `.kill()`, and `.exitCode` — all of which are on `ChildProcess`.

   Actually wait, `ChildProcess` has `stdout` and `stderr` as `Readable | null`. So when we do `child.stdout.on(...)`, TypeScript would complain that `stdout` could be null.

   Hmm, so maybe we need to be more precise. Let me reconsider.

   With `ChildProcessByStdio<null, Readable, Readable>`, stdout and stderr are typed as `Readable` (non-null), so `.on` works directly.

   With `ChildProcess`, stdout and stderr are `Readable | null`, so we'd need null checks.

   So Option A is better. Let me go with that.

   Actually, wait. Let me re-read the errors. The error is at line 59 which is the assignment `child = spawn(...)`. The type of `spawn(...)` with that stdio config is `ChildProcessByStdio<null, Readable, Readable>`, and it can't be assigned to `ChildProcessWithoutNullStreams`.

   So the fix for error 1 is: change the declared type of `child` from `ChildProcessWithoutNullStreams | undefined` to something compatible.

   For errors 2-4 (TS18048: 'child' is possibly 'undefined'), these are at lines 63, 66, 71. Looking at the code:
   - Line 63: `child.stdout.on('data', ...)`
   - Line 66: `child.stderr.on('data', ...)`
   - Line 71: `child.on('exit', ...)`

   These are all after the assignment `child = spawn(...)` in the same function. TypeScript should narrow this... unless the issue is that `child` is a `let` at module level and the assignment is inside a closure.

   Actually, TypeScript does narrow `let` variables after assignment within the same scope. But the issue might be that the assignment is in an `async` function (the `beforeAll` callback), and the `child` variable is declared at module scope. In that case, TypeScript's control flow analysis should still work within the function body.

   Wait, let me look more carefully. The variable is:
   ```ts
   let child: ChildProcessWithoutNullStreams | undefined;
   ```

   And in `beforeAll`:
   ```ts
   child = spawn('node', ['dist/main.js'], { ... });
   child.stdout.on(...)  // line 63
   child.stderr.on(...)  // line 66
   ```

   TypeScript should narrow `child` after the assignment. But wait — the error at line 59 says the assignment itself fails (type mismatch). If the assignment fails typechecking, then TypeScript might not perform the narrowing after it, because it considers the assignment as potentially not succeeding or the type is incompatible.

   Actually no, that's not how TypeScript works. Even if there's a type error on the assignment, TypeScript still narrows based on the declared type. Hmm, but actually if the type of the right-hand side is not assignable to the left-hand side, TypeScript might not narrow.

   Let me think differently. The root cause is error 1 (the type mismatch). If we fix error 1 by making the types compatible, then errors 2-4 should resolve because TypeScript will properly narrow `child` after the assignment.

   Wait, but TypeScript narrowing of a `let` variable after assignment to a `let` that's in an outer scope... Let me think. Actually, TypeScript does narrow `let` variables. After `child = spawn(...)`, the type of `child` is narrowed to the type of the right-hand side (intersected with the declared type). If the declared type is `ChildProcessByStdio<null, Readable, Readable> | undefined`, then after assignment, `child` is narrowed to `ChildProcessByStdio<null, Readable, Readable>`.

   But wait — there's a subtlety. The `child` variable is used in a callback (the `beforeAll` callback). And it's also used in `afterAll`. TypeScript's narrowing works within a function body. Since the assignment and the uses are in the same function (the `beforeAll` callback), narrowing should work.

   Actually, I just realized: the issue might be that TypeScript doesn't narrow across the `await` boundary or something. Let me look at the code again:

   ```ts
   beforeAll(async () => {
     execSync('pnpm build', { stdio: 'pipe' });
     port = await findFreePort();
     child = spawn('node', ['dist/main.js'], { ... });  // line ~57-59
     child.stdout.on('data', (chunk: Buffer) => { ... });  // line 63
     child.stderr.on('data', (chunk: Buffer) => { ... });  // line 66
     const exited = new Promise<number>((resolve) => {
       child.on('exit', (code) => resolve(code ?? -1));  // line 71
     });
   ```

   Hmm, actually I think the issue is simpler. When there's a type error on the assignment (error 1), TypeScript's control flow analysis gets confused. The variable's type after the "failed" assignment is still `ChildProcessWithoutNullStreams | undefined` because the assignment's type doesn't match. So subsequent uses see it as possibly `undefined`.

   So the fix is: change the declared type of `child` to match what `spawn` returns. This fixes all 4 errors at once.

   Let me determine the correct type. With `stdio: ['ignore', 'pipe', 'pipe']`:
   - stdin: `'ignore'` → `null`
   - stdout: `'pipe'` → `Readable`
   - stderr: `'pipe'` → `Readable`

   So the return type is `ChildProcessByStdio<null, Readable, Readable>`.

   I need to import:
   - `ChildProcessByStdio` from `node:child_process`
   - `Readable` from `node:stream`

   And change the declaration to:
   ```ts
   let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
   ```

   And remove the import of `ChildProcessWithoutNullStreams`.

   Let me write the complete file now.

   Actually, wait. Let me double-check: does `ChildProcessByStdio` export from `node:child_process`? Yes, it does. It's a type exported from that module.

   And `Readable` is from `node:stream`.

   Let me write the full file:

```ts
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
      child.on('exit', (code) => resolve(code ?? -1));
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
```

Wait, I need to double-check: does `ChildProcessByStdio` have a `kill` method and `exitCode` property? Yes, it extends `ChildProcess` which has both.

Does it have `.on('exit', ...)`? Yes, it extends `ChildProcess` which extends `EventEmitter`.

OK, this should work. Let me verify the import style. The original file imports:
```ts
import { execSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
```

So it uses separate value and type imports. I'll follow the same pattern:
```ts
import { execSync, spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
```

This looks correct. The only file that needs changing is `test/wiring.spec.ts`.
```

## reply

Looking at the four errors, they all trace to one root cause: the variable `child` is declared as `ChildProcessWithoutNullStreams | undefined`, but `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` returns `ChildProcessByStdio<null, Readable, Readable>`. The type mismatch on the assignment (error 1) prevents TypeScript from narrowing, which cascades into the three "possibly undefined" errors (errors 2–4).

**One distinct mistake:** the type annotation on `child` doesn't match the actual return type of `spawn`. Fix it by using the correct type.

### test/wiring.spec.ts
```ts
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
      child.on('exit', (code) => resolve(code ?? -1));
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
```
