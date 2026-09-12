# repair1-set

## reasoning

```
The error is in `test/wiring.spec.ts` at line 159, column 51. The error is:

```
Property 'port' does not exist on type 'string | AddressInfo'.
Property 'port' does not exist on type 'string'.
```

Looking at the reference file, the relevant code is in the `freePort` function:

```typescript
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = address === null ? 0 : address.port;
      server.close(() => resolve(port));
    });
  });
}
```

The issue is that `server.address()` can return `string | AddressInfo | null`. When it's a `string` (which happens when listening on a pipe/unix socket), it doesn't have a `.port` property.

The fix is to narrow the type properly. We need to check that `address` is an `AddressInfo` before accessing `.port`. We can use a type guard:

```typescript
const address = server.address();
const port = address === null || typeof address === 'string' ? 0 : address.port;
```

This is the minimal fix. Let me look at the full file to make sure I return it correctly.

Looking at the reference, the file is `test/wiring.spec.ts`. Let me reconstruct it with the fix applied.

The only change is on line 159 (in the reference numbering), changing:
```typescript
const port = address === null ? 0 : address.port;
```
to:
```typescript
const port = address === null || typeof address === 'string' ? 0 : address.port;
```

Let me write out the complete file with this one change.
```

## reply

There is one distinct mistake: `server.address()` returns `string | AddressInfo | null`, and the code only guards against `null`, not against the `string` case (unix socket path). The fix is to also check for `typeof address === 'string'`.

### test/wiring.spec.ts
```ts
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Wiring check for the application graph.
 *
 * A passing typecheck is not a wiring check: provider registration is runtime
 * metadata, and the original boot crash was an ESM evaluation-order problem.
 * A unit test with a faked repository is not one either: it never builds a
 * container. This spec therefore compiles the app with the project's tsc —
 * the same transform `pnpm start` uses, and, unlike vitest's esbuild
 * transform, it emits the `design:paramtypes` metadata that Nest's
 * constructor injection depends on — and then exercises the compiled output
 * the way the runtime does.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const distUrl = (rel: string): string => new URL(`../dist/${rel}`, import.meta.url).href;

/**
 * Builds the real Nest container from the compiled output and asserts that
 * every cross-module provider is resolvable. Catches a provider dropped from
 * its owning module, a cross-module export that is missing, and a module
 * orphaned from AppModule — including providers with no route, which a pure
 * boot check cannot see.
 */
const CONTAINER_CHECK = `
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

const [
  appMod,
  exportServiceMod,
  usersModuleMod,
  notificationsServiceMod,
  notificationsModuleMod,
  deliveryRepoMod,
  jobsModuleMod,
  retryProcessorMod,
] = await Promise.all(process.argv.slice(1).map((p) => import(p)));

const app = await NestFactory.create(appMod.AppModule, { logger: false });

function resolveToken(token, moduleRef) {
  const candidates = [];
  try {
    candidates.push(app.get(token));
  } catch (err) {
    candidates.push(null);
  }
  if (moduleRef) {
    try {
      const moduleInstance = app.get(moduleRef);
      candidates.push(typeof moduleInstance.get === 'function' ? moduleInstance.get(token) : null);
    } catch (err) {
      candidates.push(null);
    }
  }
  return candidates.some((instance) => instance instanceof token);
}

const checks = [
  [exportServiceMod.ExportService, 'ExportService', usersModuleMod.UsersModule],
  [notificationsServiceMod.NotificationsService, 'NotificationsService', notificationsModuleMod.NotificationsModule],
  [deliveryRepoMod.DeliveryRepository, 'DeliveryRepository', notificationsModuleMod.NotificationsModule],
  [retryProcessorMod.RetryProcessor, 'RetryProcessor', jobsModuleMod.JobsModule],
];

let failed = false;
for (const [token, name, moduleRef] of checks) {
  if (!resolveToken(token, moduleRef)) {
    console.error('wiring check failed: ' + name + ' is not resolvable in the container');
    failed = true;
  }
}

await app.close();
if (failed) {
  process.exitCode = 1;
} else {
  console.log('wiring ok');
}
`;

beforeAll(
  () => {
    execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], { cwd: root });
  },
  120_000,
);

describe('application wiring', () => {
  it('resolves every cross-module provider through the real Nest container', async () => {
    const { code, output } = await runNode(CONTAINER_CHECK, [
      distUrl('app.module.js'),
      distUrl('users/export.service.js'),
      distUrl('users/users.module.js'),
      distUrl('notifications/notifications.service.js'),
      distUrl('notifications/notifications.module.js'),
      distUrl('notifications/delivery.repository.js'),
      distUrl('jobs/jobs.module.js'),
      distUrl('jobs/retry.processor.js'),
    ]);
    if (code !== 0) {
      throw new Error(`container check exited with code ${String(code)}:\n${output}`);
    }
    expect(output).toContain('wiring ok');
  }, 60_000);

  it('boots the compiled app end to end and serves POST /exports', async () => {
    const port = await freePort();
    const { child, output } = startApp(port);
    try {
      await waitForListening(child, port, output);

      const res = await fetch(`http://127.0.0.1:${port}/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedBy: 'wiring-check' }),
      });
      expect(res.status).toBe(201);
      const job = (await res.json()) as { id: string; rows: number };
      expect(job.id).toBe(`exp_wiring-check_${job.rows}`);
      expect(Number.isInteger(job.rows)).toBe(true);
    } finally {
      killApp(child);
    }
  }, 90_000);
});

function runNode(script: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
      cwd: root,
      env: process.env,
    });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, output: out });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = address === null || typeof address === 'string' ? 0 : address.port;
      server.close(() => resolve(port));
    });
  });
}

function startApp(port: number): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe',
  });
  let out = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    out += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    out += chunk.toString();
  });
  return { child, output: () => out };
}

function waitForListening(child: ChildProcess, port: number, output: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const marker = `listening on ${port}`;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`app did not reach "${marker}" within 45s\n--- app output ---\n${output()}`));
      }
    }, 45_000);
    child.stdout?.on('data', (_chunk: Buffer) => {
      if (settled) {
        return;
      }
      if (output().includes(marker)) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`app exited with code ${String(code)} before listening\n--- app output ---\n${output()}`));
    });
  });
}

function killApp(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const escalate = setTimeout(() => child.kill('SIGKILL'), 3_000);
  escalate.unref();
  child.once('close', () => clearTimeout(escalate));
}
```
