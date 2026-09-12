# repair2-set

## reasoning

```
Let me analyze the error:

```
test/wiring.spec.ts(72,7): error TS18048: 'child' is possibly 'undefined'.
```

Looking at the file, line 72 is:
```ts
    child.stdout.on('data', (chunk: Buffer) => {
```

The issue is that `child` is declared as `let child: ChildProcessByStdio<null, Readable, Readable> | undefined;` and while it's assigned in the `beforeAll` block, TypeScript's control flow analysis doesn't narrow it within the nested callback/closure contexts properly. Actually, let me look more carefully.

Looking at the code:

```ts
let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
...
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
```

The problem is that `child` is a `let` variable with type `ChildProcessByStdio<null, Readable, Readable> | undefined`. Even though we assign it right before, TypeScript still considers it possibly undefined because it's a mutable variable that could be reassigned. The narrowing from the assignment `child = spawn(...)` should work for the immediately following line, but...

Wait, actually in TypeScript, after `child = spawn(...)`, the variable IS narrowed to the non-undefined type for the rest of the block. So `child.stdout.on(...)` should be fine.

Let me re-read the error: `test/wiring.spec.ts(72,7): error TS18048: 'child' is possibly 'undefined'.`

Let me count lines more carefully:

1: `import { afterAll, beforeAll, describe, expect, it } from 'vitest';`
2: `import { execSync, spawn } from 'node:child_process';`
3: `import type { ChildProcessByStdio } from 'node:child_process';`
4: `import type { Readable } from 'node:stream';`
5: `import { once } from 'node:events';`
6: `import { createServer } from 'node:net';`
7: (empty)
8: `const BOOT_TIMEOUT_MS = 30_000;`
9: (empty)
10: `/**`
11: ` * Boot check for the real application.`
12: ` *`
13: ` * Builds the app exactly like \`pnpm start\` does (\`pnpm build && node`
14: ` * dist/main.js\`) and starts the compiled process on an ephemeral port. This`
15: ` * fails when:`
16: ` *  - module evaluation crashes before Nest can start (e.g. a circular import`
17: ` *    that reads a binding before initialization — the original failure);`
18: ` *  - any provider is unresolvable: a provider no module owns, or a provider`
19: ` *    used across a module boundary that is not exported (Nest aborts`
20: ` *    bootstrap and the process never logs "listening");`
21: ` *  - the exports route no longer reaches ExportService through UsersModule.`
22: ` *`
23: ` * A typecheck is not this check (module wiring is runtime metadata), and a`
24: ` * unit test with the repository faked is not this check (it never loads the`
25: ` * module graph).`
26: ` */`
27: `describe('boot: compiled app starts with a resolvable module graph', () => {`
28: `  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;`
29: `  let port = 0;`
30: `  let output = '';`
31: (empty)
32: `  const findFreePort = (): Promise<number> =>`
33: `    new Promise((resolve, reject) => {`
34: `      const server = createServer();`
35: `      server.on('error', reject);`
36: `      server.listen(0, '127.0.0.1', () => {`
37: `        const address = server.address();`
38: `        const resolved = address && typeof address === 'object' ? address.port : 0;`
39: `        server.close(() => resolve(resolved));`
40: `      });`
41: `    });`
42: (empty)
43: `  const waitUntil = (predicate: () => boolean, timeoutMs: number): Promise<void> =>`
44: `    new Promise((resolve, reject) => {`
45: `      const startedAt = Date.now();`
46: `      const timer = setInterval(() => {`
47: `        if (predicate()) {`
48: `          clearInterval(timer);`
49: `          resolve();`
50: `        } else if (Date.now() - startedAt > timeoutMs) {`
51: `          clearInterval(timer);`
52: `          reject(new Error(\`timed out after ${timeoutMs}ms\`));`
53: `        }`
54: `      }, 50);`
55: `    });`
56: (empty)
57: `  beforeAll(async () => {`
58: `    execSync('pnpm build', { stdio: 'pipe' });`
59: `    port = await findFreePort();`
60: `    child = spawn('node', ['dist/main.js'], {`
61: `      env: { ...process.env, PORT: String(port) },`
62: `      stdio: ['ignore', 'pipe', 'pipe'],`
63: `    });`
64: `    child.stdout.on('data', (chunk: Buffer) => {`
65: `      output += chunk.toString();`
66: `    });`
67: `    child.stderr.on('data', (chunk: Buffer) => {`
68: `      output += chunk.toString();`
69: `    });`
70: (empty)
71: `    const exited = new Promise<number>((resolve) => {`
72: `      child.on('exit', (code) => resolve(code ?? -1));`
73: `    });`

Ah, line 72 is `child.on('exit', (code) => resolve(code ?? -1));`

The issue is that inside a closure (the arrow function `(code) => resolve(code ?? -1)` passed to `child.on`), TypeScript doesn't maintain the narrowing from the outer scope for mutable variables. The `child` was narrowed after the assignment on line 60, but inside a closure, TypeScript reverts to the declared type for `let` variables because they could be reassigned.

Wait, actually that's not quite right either. The narrowing should persist for the `child.on(...)` call itself (line 71's `child` in `child.on`), but the issue is that the callback `(code) => resolve(code ?? -1)` doesn't reference `child`... 

Wait, let me re-read. The error is at line 72, column 7. Let me recount:

Line 71: `    const exited = new Promise<number>((resolve) => {`
Line 72: `      child.on('exit', (code) => resolve(code ?? -1));`

Column 7 would be `child` (0-indexed: 6 spaces then `child` starts at position 6... hmm, 0-indexed column 7 is the 7th character which would be `c` of `child` if 0-indexed, or the space before it if 1-indexed).

Actually in TypeScript errors, columns are 1-based. So column 7 on line 72 means the 7th character. Let me count: `      child.on(...)` - 6 spaces + `child` starts at position 7. Yes, that's `child`.

So the issue is: `child` is a `let` variable of type `ChildProcessByStdio<null, Readable, Readable> | undefined`. It's assigned on line 60. Lines 64 and 67 use `child.stdout` and `child.stderr` which work fine because the narrowing is maintained in the same block. But line 72 uses `child` inside a closure passed to `new Promise<number>((resolve) => { ... })`. 

Actually wait - the `child.on` is NOT inside a closure. It's directly in the `beforeAll(async () => { ... })` callback. The `new Promise<number>((resolve) => { child.on(...) })` - the `child.on` IS inside the executor function of the Promise constructor, which is a closure.

In TypeScript, for `let` variables, narrowing is not maintained inside closures because the variable could be reassigned between the narrowing and the closure execution. This is the well-known behavior.

The fix: Since we already know `child` is assigned (it was just assigned a few lines above), we can either:
1. Use a local const: `const proc = spawn(...)` and use `proc` instead of `child` in that block.
2. Add a non-null assertion: `child!.on(...)`
3. Restructure to avoid the closure issue.

The cleanest fix that "changes exactly what the compiler requires" is to use a local variable. Let me look at the structure:

```ts
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
```

The simplest fix: assign to a local const and use that for the immediate operations, while still assigning to `child` for the `afterAll` cleanup.

```ts
const proc = spawn('node', ['dist/main.js'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child = proc;
proc.stdout.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
proc.stderr.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});

const exited = new Promise<number>((resolve) => {
  proc.on('exit', (code) => resolve(code ?? -1));
});
```

Wait, but `proc` is a `const` so its narrowing is maintained inside closures. This should work.

Alternatively, the minimal change: just add a non-null assertion on line 72. But the instructions say "Change exactly what the compiler requires" - a non-null assertion is the most minimal fix.

Actually, let me reconsider. The most minimal fix is `child!.on('exit', ...)`. But using a local const is cleaner and avoids the assertion. Let me go with the local const approach since it's more robust and doesn't use `!`.

Wait, the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise." Using a local const is a small restructuring. The non-null assertion `child!` is the most minimal change.

Let me go with `child!` - it's a single character addition that fixes the type error without changing any logic or structure.

Actually, I'll use the local const approach. It's cleaner and the change is still minimal - just introducing a local to capture the value. The `child` variable is still used in `afterAll` for cleanup, so we still need it.

Hmm, but "do not reorganise" suggests I should keep changes minimal. Let me just use `child!` on line 72.

Wait, but will there be other errors too? The error list only shows one error. Let me just fix that one.

The fix: change `child.on('exit', (code) => resolve(code ?? -1));` to `child!.on('exit', (code) => resolve(code ?? -1));`

That's the minimal fix. Let me write out the complete file with just that one character added.
```

## reply

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
```
