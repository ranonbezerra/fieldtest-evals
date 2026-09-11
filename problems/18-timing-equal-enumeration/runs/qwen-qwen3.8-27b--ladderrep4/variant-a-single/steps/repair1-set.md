# repair1-set

## reasoning

```
Let me analyze the two errors:

1. `src/auth/auth.service.ts(2,10): error TS2305: Module '"@node-rs/argon2"' has no exported member 'argon2id'.`

Looking at the reference code, it imports `argon2id` from `@node-rs/argon2`. Let me check what `@node-rs/argon2` actually exports. The `@node-rs/argon2` package exports:
- `hash`
- `verify`
- `raw`
- `generichash`
- `Argon2id` (as an enum value or constant)

Actually, looking at the `@node-rs/argon2` package documentation, the correct export is `argon2id` as a constant... let me think more carefully.

The `@node-rs/argon2` package exports:
- `hash(password: string, params: Params): Promise<string>`
- `verify(hash: string, password: string, params?: Params): Promise<boolean>`
- `raw(algorithm: Algorithm, password: string, salt: string, params: RawParams): Promise<Buffer>`

And for the algorithm parameter, you use `Argon2id` from the package. Let me check...

Actually, looking at the npm package `@node-rs/argon2`, the exports are:
- `hash`
- `verify`  
- `raw`
- `generichash`
- `Argon2id` (number/enum)
- `Argon2i`
- `Argon2d`

Wait, let me reconsider. The `@node-rs/argon2` package (by node-rs) has these exports based on its TypeScript definitions:

```ts
export declare function hash(password: string, params: Params): Promise<string>;
export declare function verify(hash: string, password: string, params?: Params): Promise<boolean>;
```

And `Params` includes:
```ts
interface Params {
  type?: number; // or ArgonType
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  outputLength: number;
}
```

Hmm, but actually looking at the `@node-rs/argon2` package more carefully:

From the npm package `@node-rs/argon2`, the types are:

```ts
export declare const Argon2id: number;
export declare const Argon2i: number;
export declare const Argon2d: number;
```

So the correct import would be `Argon2id` (PascalCase), not `argon2id` (camelCase).

Wait, let me reconsider. Different versions might have different exports. Let me think about what's most likely.

Looking at the actual `@node-rs/argon2` package on npm/GitHub:

The package exports:
- `hash`
- `verify`
- `raw`
- `generichash`
- `Argon2id` (a constant, value 2)
- `Argon2i` (a constant, value 1)
- `Argon2d` (a constant, value 0)

So the fix is: change `argon2id` to `Argon2id` in the import.

2. `test/auth.spec.ts(88,7): error TS2339: Property 'overrideProvider' does not exist on type 'INestApplication<any>'.`

The `overrideProvider` method is on `Test` from `@nestjs/testing`, not on `INestApplication`. The test is using `NestFactory.create(AppModule)` which returns an `INestApplication`, and then trying to call `app.overrideProvider(MAIL_PORT).useValue(mail)`.

The fix is to use `@nestjs/testing`'s `Test.createTestingModule()` instead, which returns a `TestingModuleBuilder` that has `overrideProvider`.

Wait, but the instruction says "Change exactly what the compiler requires." and "Do not add features, do not rename anything the errors do not mention, do not reorganise."

So I need to fix the test to properly override the provider. The cleanest fix that changes the least is to use `Test` from `@nestjs/testing`:

```ts
import { Test } from '@nestjs/testing';

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(MAIL_PORT)
  .useValue(mail)
  .compile();
const app = moduleRef.createNestApplication();
await app.init();
```

Let me write the complete files.

For `auth.service.ts`:
- Change `import { argon2id, hash, verify } from '@node-rs/argon2'` to `import { Argon2id, hash, verify } from '@node-rs/argon2'`
- Change `type: argon2id` to `type: Argon2id`

For `test/auth.spec.ts`:
- Add `import { Test } from '@nestjs/testing';`
- Replace the `beforeAll` block to use `Test.createTestingModule` instead of `NestFactory.create`

Let me write out the complete files now.

Actually wait - I need to be careful. The error says `Property 'overrideProvider' does not exist on type 'INestApplication<any>'`. The fix is to use the testing module builder. Let me write the full test file.

Let me reconstruct the test file with the fix applied:

```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { MAIL_PORT, type MailPort } from '../src/auth/mail.port.js';
```

And in `beforeAll`:
```ts
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mail)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 120_000);
```

This is the minimal fix. I'm removing the `NestFactory` import since it's no longer needed, and adding `Test` from `@nestjs/testing`.

Wait, actually I should check - does `NestFactory` need to stay? No, because we're replacing `NestFactory.create(AppModule, { logger: false })` with the test module approach. The `{ logger: false }` option was for NestFactory. With Test.createTestingModule, logging is already off by default (or I can just leave it).

Let me finalize both files.
```

## reply

### src/auth/auth.service.ts
```ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Argon2id, hash, verify } from '@node-rs/argon2';
import { ApiException } from '../common/api-error.js';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from './mail.port.js';

/**
 * Canonical KDF parameters. Every argon2 call in this service — stored hashes
 * and the decoy — uses exactly these, so no code path can perform a different
 * amount of KDF work than any other.
 */
const KDF_PARAMS = {
  type: Argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  outputLength: 32,
} as const;

// The decoy's plaintext is public and irrelevant: its value is that verifying
// against it costs a full argon2id run, not that it is secret.
const DUMMY_SEED = 'timing-equalization-decoy';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(
    @Inject(AuthRepository) private readonly users: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(DUMMY_SEED, KDF_PARAMS);
  }

  async signUp(email: string, password: string): Promise<{ status: string }> {
    const normalized = this.normalizeEmail(email);

    // Timing equalisation: both outcomes perform exactly one argon2id run with
    // KDF_PARAMS. A new address needs the hash to store it; an existing
    // address pays the identical cost because the insert below fails on the
    // unique constraint and the hash is discarded. The branch with nothing to
    // check does not skip the work — it throws the result away.
    const passwordHash = await hash(password, KDF_PARAMS);
    const { created } = await this.users.createIfAbsent(normalized, passwordHash);

    // The real outcome reaches the owner out of band: the send is fired, its
    // errors are swallowed, and nothing on the response path awaits it, so a
    // mail failure changes nothing the caller observes.
    this.notifyOwner(normalized, created ? 'account-verification' : 'sign-up-attempt');

    return { status: 'ok' };
  }

  async signIn(email: string, password: string): Promise<{ status: string }> {
    const normalized = this.normalizeEmail(email);
    const user = await this.users.findByEmail(normalized);

    // Timing equalisation: an unknown address has no stored hash to check, so
    // it verifies against a decoy hash built at startup with identical
    // parameters. Both branches execute exactly one argon2id run.
    const target: string = user ? user.passwordHash : this.dummyHash;
    let verified = false;
    try {
      verified = await verify(target, password);
    } catch {
      verified = false; // malformed hash or argon2 failure: treat as mismatch
    }

    if (!verified) {
      throw new ApiException(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    return { status: 'ok' };
  }

  private notifyOwner(to: string, template: string): void {
    this.mail.sendEmail(to, template, { email: to }).catch((error: unknown) => {
      // Deliberate: delivery failures are invisible to the caller by design.
      // (A production port would also log or metric the failure internally.)
      void error;
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
```

### test/auth.spec.ts
```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { MAIL_PORT, type MailPort } from '../src/auth/mail.port.js';

// These tests measure the properties the way an attacker would: over the real
// HTTP stack, against a real PostgreSQL database (Prisma). The suite requires
// a migrated database: DATABASE_URL=... pnpm exec prisma migrate deploy.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a migrated PostgreSQL database.');
}

const PASSWORD = 'correct-horse-battery-1';
const OTHER_PASSWORD = 'wrong-horse-battery-9';
// Headers that legitimately vary between two responses and say nothing about
// the branch. content-length stays in the comparison on purpose: a length
// difference is a leak.
const VOLATILE_HEADERS = ['date', 'connection', 'keep-alive'];

const newEmail = (): string => `user-${randomUUID()}@example.com`;
const meanOf = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const medianOf = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function stableHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const stable: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || VOLATILE_HEADERS.includes(key.toLowerCase())) continue;
    stable[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return stable;
}

async function elapsedMs(pending: PromiseLike<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await pending;
  return Number(process.hrtime.bigint() - start) / 1e6;
}

class FakeMailPort implements MailPort {
  sent: Array<{ to: string; template: string; vars: Record<string, unknown> }> = [];
  inFlight = 0;
  delayMs = 0;
  fail = false;
  private settled: Promise<void>[] = [];

  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void> {
    this.inFlight += 1;
    const run = async (): Promise<void> => {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.fail) throw new Error('mail transport unavailable');
      this.sent.push({ to, template, vars });
    };
    const done = run().finally(() => {
      this.inFlight -= 1;
    });
    this.settled.push(done.catch(() => undefined));
    return done;
  }

  async waitUntilIdle(): Promise<void> {
    for (;;) {
      const snapshot = [...this.settled];
      await Promise.all(snapshot);
      if (this.inFlight === 0) return;
    }
  }

  templatesFor(email: string): string[] {
    return this.sent.filter((entry) => entry.to === email).map((entry) => entry.template);
  }
}

let app: INestApplication;
let server: Server;
const mail = new FakeMailPort();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mail)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 120_000);

afterAll(async () => {
  await mail.waitUntilIdle();
  if (app) await app.close();
}, 120_000);

describe('POST /auth/sign-up', () => {
  it('creates the account and the owner receives a verification mail', async () => {
    const email = newEmail();
    const res = await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'ok' });

    await mail.waitUntilIdle();
    expect(mail.templatesFor(email)).toEqual(['account-verification']);

    // The account is real: signing in with the same credentials succeeds.
    const signIn = await request(server).post('/auth/sign-in').send({ email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.body).toEqual({ status: 'ok' });
  });

  it('returns the response before the mail send completes (out of band)', async () => {
    mail.delayMs = 1200;
    try {
      const email = newEmail();
      const res = await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });
      expect(res.status).toBe(201);
      // The response is back while the send is still in flight: nothing on the
      // response path awaits the mail.
      expect(mail.inFlight).toBeGreaterThan(0);
      await mail.waitUntilIdle();
      expect(mail.inFlight).toBe(0);
      expect(mail.templatesFor(email)).toEqual(['account-verification']);
    } finally {
      mail.delayMs = 0;
    }
  });

  it('new and existing addresses produce byte-identical responses', async () => {
    const email = newEmail();
    const fresh = await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });
    const taken = await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });

    expect(fresh.status).toBe(201);
    expect(taken.status).toBe(201);
    // Byte comparison of the two response bodies...
    expect(Buffer.from(taken.text)).toEqual(Buffer.from(fresh.text));
    // ...and of the headers, including content-length.
    expect(stableHeaders(taken.headers)).toEqual(stableHeaders(fresh.headers));

    // The duplicate attempt reached the owner, and the account still belongs
    // to the original credentials (the duplicate did not overwrite it).
    await mail.waitUntilIdle();
    expect(mail.templatesFor(email)).toEqual(['account-verification', 'sign-up-attempt']);
    const signIn = await request(server).post('/auth/sign-in').send({ email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    const wrongSignIn = await request(server).post('/auth/sign-in').send({ email, password: OTHER_PASSWORD });
    expect(wrongSignIn.status).toBe(401);
  });

  it('a mail failure is invisible to the caller', async () => {
    const email = newEmail();
    const healthy = await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });

    mail.fail = true;
    const brokenMail = await request(server).post('/auth/sign-up').send({ email, password: OTHER_PASSWORD });
    mail.fail = false;

    expect(brokenMail.status).toBe(201);
    expect(Buffer.from(brokenMail.text)).toEqual(Buffer.from(healthy.text));
    expect(stableHeaders(brokenMail.headers)).toEqual(stableHeaders(healthy.headers));

    // The attempt notification is delivered once mail recovers, still with a
    // byte-identical response.
    const recovered = await request(server).post('/auth/sign-up').send({ email, password: OTHER_PASSWORD });
    await mail.waitUntilIdle();
    expect(mail.templatesFor(email)).toEqual(['account-verification', 'sign-up-attempt']);
    expect(Buffer.from(recovered.text)).toEqual(Buffer.from(healthy.text));
  });
});

describe('POST /auth/sign-in', () => {
  it('wrong password and unknown address produce byte-identical 401 responses', async () => {
    const email = newEmail();
    await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });

    const wrongPassword = await request(server).post('/auth/sign-in').send({ email, password: OTHER_PASSWORD });
    const unknownAddress = await request(server).post('/auth/sign-in').send({ email: newEmail(), password: OTHER_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(401);
    expect(Buffer.from(unknownAddress.text)).toEqual(Buffer.from(wrongPassword.text));
    expect(stableHeaders(unknownAddress.headers)).toEqual(stableHeaders(wrongPassword.headers));
    expect(JSON.parse(wrongPassword.text)).toEqual({
      error: { code: 'invalid_credentials', message: expect.any(String), details: {} },
    });
  });

  it('accepts the correct credentials', async () => {
    const email = newEmail();
    await request(server).post('/auth/sign-up').send({ email, password: PASSWORD });
    const res = await request(server).post('/auth/sign-in').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('timing equalisation', () => {
  // The assertions are chosen so the suite fails on both regressions:
  //  - hashing removed (no KDF on the response path) -> branch means drop to a
  //    few milliseconds and the MIN_REAL_WORK_MS lower bounds fail;
  //  - equalisation removed (one branch skips the KDF) -> the means differ by
  //    a full argon2id run (hundreds of ms), far outside the tolerance.
  const SAMPLES = 10;
  const MIN_REAL_WORK_MS = 50;
  const TOLERANCE_FLOOR_MS = 75;
  const TOLERANCE_RATIO = 0.4;

  async function sample(
    branchA: () => PromiseLike<unknown>,
    branchB: () => PromiseLike<unknown>,
  ): Promise<[number[], number[]]> {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      // Interleave the branches to cancel drift (CPU, pools, warm-up).
      a.push(await elapsedMs(branchA()));
      b.push(await elapsedMs(branchB()));
    }
    return [a, b];
  }

  function expectEqualisedWork(labelA: string, labelB: string, a: number[], b: number[]): void {
    const meanA = meanOf(a);
    const meanB = meanOf(b);
    const tolerance = Math.max(TOLERANCE_FLOOR_MS, TOLERANCE_RATIO * Math.min(meanA, meanB));

    // (1) Both branches must be slow enough to be doing the KDF work. Without
    // this, deleting the hashing makes the test pass.
    expect(meanA, `${labelA} mean (ms)`).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    expect(meanB, `${labelB} mean (ms)`).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    // (2) The distributions must be within tolerance of each other.
    expect(Math.abs(meanA - meanB), `${labelA} vs ${labelB} mean diff (ms)`).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(medianOf(a) - medianOf(b)),
      `${labelA} vs ${labelB} median diff (ms)`,
    ).toBeLessThanOrEqual(tolerance);
  }

  it('sign-up: new and existing addresses are indistinguishable over repeated samples', async () => {
    const existing = newEmail();
    await request(server).post('/auth/sign-up').send({ email: existing, password: PASSWORD });
    // Warm-up: connection pool, JIT, first-call overhead.
    await request(server).post('/auth/sign-up').send({ email: newEmail(), password: PASSWORD });

    const [fresh, taken] = await sample(
      () => request(server).post('/auth/sign-up').send({ email: newEmail(), password: PASSWORD }),
      () => request(server).post('/auth/sign-up').send({ email: existing, password: PASSWORD }),
    );
    expectEqualisedWork('fresh-address', 'existing-address', fresh, taken);
  }, 180_000);

  it('sign-in: wrong password and unknown address are indistinguishable over repeated samples', async () => {
    const known = newEmail();
    await request(server).post('/auth/sign-up').send({ email: known, password: PASSWORD });
    // Warm-up.
    await request(server).post('/auth/sign-in').send({ email: newEmail(), password: PASSWORD });

    const [wrongPassword, unknownAddress] = await sample(
      () => request(server).post('/auth/sign-in').send({ email: known, password: OTHER_PASSWORD }),
      () => request(server).post('/auth/sign-in').send({ email: newEmail(), password: OTHER_PASSWORD }),
    );
    expectEqualisedWork('wrong-password', 'unknown-address', wrongPassword, unknownAddress);
  }, 180_000);
});
```
