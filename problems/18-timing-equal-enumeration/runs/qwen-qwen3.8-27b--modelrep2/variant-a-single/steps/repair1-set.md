# repair1-set

## reasoning

```
Let me analyze all the errors together to find the distinct mistakes:

1. **`type` field in hashOptions**: The `type` property is declared as `number` but argon2's `Options` type expects `0 | 1 | 2 | undefined`. This affects lines 64 and 96 in `auth.service.ts`. The fix is to type it as `argon2.argon2id` (which is a const of type `2`) or use the literal type. Since `argon2.argon2id` is `2`, I should type the `type` field as `typeof argon2.argon2id` or just use the argon2 options type directly.

2. **`dummyHash` type**: On line 101, `this.dummyHash` is declared as `Promise<string> | null` but the method `getDummyHash()` returns `Promise<string>`. Looking at the code:
```ts
private dummyHash: Promise<string> | null = null;
```
And:
```ts
private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash;
}
```

The issue is that after the `if` block, TypeScript can't narrow `this.dummyHash` from `Promise<string> | null` to `Promise<string>` because it's a property access and the assignment inside the `if` block with the `.catch()` callback that sets it back to `null` confuses the narrowing.

Wait, let me re-read. The error is at line 101: `Type 'Promise<string> | null' is not assignable to type 'Promise<string>'`. This is the `return this.dummyHash;` line. TypeScript doesn't narrow class properties across method calls in the way it would narrow local variables. After the `if (!this.dummyHash)` block, TypeScript can't guarantee `this.dummyHash` is still non-null because the `.catch` callback could have set it to null.

The fix: use a local variable or restructure. Actually, the simplest fix is:
```ts
private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash;
}
```

Wait, that's the same thing. The problem is TypeScript doesn't track that after the `if` block, `this.dummyHash` is definitely assigned. Let me think...

Actually the real issue is that TypeScript sees `this.dummyHash` as a mutable property and after the `if` block, it considers it could still be null (because the callback could have been called synchronously... well, not really, but TypeScript's flow analysis for class properties is limited).

The simplest fix: use a local variable:
```ts
private getDummyHash(): Promise<string> {
    let dummyHash = this.dummyHash;
    if (dummyHash === null) {
      dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
      this.dummyHash = dummyHash;
    }
    return dummyHash;
}
```

Or even simpler, since `argon2.hash` returns `Promise<string>` (when `raw` is not true), I can just do:
```ts
private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    const result = this.dummyHash;
    return result;
}
```

Wait, that won't work either because TypeScript still sees `this.dummyHash` as potentially null.

Actually let me reconsider. The error is:
```
src/auth/auth.service.ts(101,5): error TS2322: Type 'Promise<string> | null' is not assignable to type 'Promise<string>'.
```

Line 101 is `return this.dummyHash;`. The issue is that TypeScript's control flow analysis for class properties is conservative. After the `if` block, it doesn't narrow `this.dummyHash` because:
1. It's a property, not a local variable
2. The `.catch()` callback assigns `null` to it

The cleanest fix:
```ts
private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash!;
}
```

Using a non-null assertion `!` here is fine because we just assigned it in the `if` block. But wait, the `.catch` could have been called... no, `.catch` registers a handler, it doesn't execute synchronously. So by the time we reach `return`, `this.dummyHash` is definitely the promise we just assigned. The non-null assertion is safe.

Actually, a cleaner approach without `!`:
```ts
private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash as Promise<string>;
}
```

Or the local variable approach which is cleanest:
```ts
private getDummyHash(): Promise<string> {
    let hash = this.dummyHash;
    if (hash === null) {
      hash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
      this.dummyHash = hash;
    }
    return hash;
}
```

I'll go with the non-null assertion since it's the minimal change.

3. **`InMemoryAuthRepository` implements `AuthRepository` but `AuthRepository` is a class with a `prisma` property**: The test uses `implements AuthRepository` but `AuthRepository` is a class (not an interface). In TypeScript, you can only `implements` a class if you provide all its public members. The class has a constructor parameter `prisma` which makes it a public property.

The fix: the test should define an interface for the repository contract, or the `AuthRepository` class should have an interface extracted. But the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise."

Wait, but the error is in the test file. The test does `implements AuthRepository` where `AuthRepository` is a class. The fix should be in the test file - change `implements AuthRepository` to something else. But what?

Looking at the test, it defines `InMemoryAuthRepository` with methods `findByEmail` and `createOrReturnExisting`. The `AuthRepository` class has those same methods plus the `prisma` property from the constructor.

The cleanest minimal fix: the test should not `implements` the class. It should just be a standalone class that has the right shape. Change `implements AuthRepository` to just removing the `implements` clause. But then the type override in the NestJS test module might not work...

Actually, looking more carefully at the NestJS testing code:
```ts
.overrideProvider(AuthRepository)
.useValue(repository)
```

This should work fine because `.useValue` just needs the object to be structurally compatible at runtime. The TypeScript type check is the issue.

The minimal fix is to remove `implements AuthRepository` from the class declaration. The class will still be structurally compatible when used with `.useValue()`.

Wait, but will TypeScript complain about the type mismatch in `.useValue(repository)`? Let me think... `.useValue()` accepts `any`, so it should be fine.

Actually, let me look at the import: `import { AuthRepository } from '../src/auth/auth.repository.js';` - it's importing the class. If I remove `implements AuthRepository`, the class just won't have that type annotation, and `.useValue(repository)` should be fine since it accepts any value.

So the fix for test/auth.spec.ts line 40: change `class InMemoryAuthRepository implements AuthRepository {` to `class InMemoryAuthRepository {`.

4. **`flush()` return type**: Line 84: `Type 'Promise<void[]>' is not assignable to type 'Promise<void>'`.

The `flush` method:
```ts
flush(): Promise<void> {
    return Promise.all(this.sent.map((item) => item.done));
}
```

`Promise.all(this.sent.map((item) => item.done))` where `item.done` is `Promise<void>`. So `this.sent.map((item) => item.done)` is `Promise<void>[]`. And `Promise.all(Promise<void>[])` returns `Promise<void[]>`.

The fix: `return Promise.all(this.sent.map((item) => item.done)).then(() => undefined);`

Or: `return Promise.all(this.sent.map((item) => item.done)) as Promise<void>;`

Or better: `await Promise.all(...)` in an async function:
```ts
async flush(): Promise<void> {
    await Promise.all(this.sent.map((item) => item.done));
}
```

That's the cleanest. Make it async and await.

5. **Line 124: `Argument of type 'unknown' is not assignable to parameter of type 'string | object | undefined'`**:

Looking at line 124 in the test... Let me count. The test file is long. Let me look at what's around line 124.

Looking at the test file structure, line 124 would be in the `describe('POST /auth/sign-up')` block. Let me count more carefully...

Actually, let me look at the `post` helper:
```ts
const post = (path: string, body: unknown): Promise<HttpObservation> =>
  request(app.getHttpServer()).post(path).send(body);
```

The `send` method on supertest accepts `string | object | undefined`. The `body` parameter is typed as `unknown`. That's the issue!

The fix: change `body: unknown` to `body: string | object | undefined` or just `body: object`.

Wait, but `send` in supertest can accept various things. Let me check - supertest's `.send()` accepts `any` in most versions. But with strict TypeScript, it might be more specific.

Actually, looking at the supertest type definitions, `.send()` typically accepts `any`. But in newer versions with stricter types, it might be `string | object | undefined`.

The simplest fix: change the parameter type from `unknown` to `object`:
```ts
const post = (path: string, body: object): Promise<HttpObservation> =>
```

Or we could cast: `request(app.getHttpServer()).post(path).send(body as object);`

But the cleanest is to change the parameter type. Since all call sites pass objects (like `{ email, password }`), `object` works fine.

Wait, but what about the case where body might be undefined? Looking at all the calls, they all pass an object literal, so `object` is safe.

Let me now count the distinct mistakes:

1. **`type: number` should be a literal type compatible with argon2's Options** — affects `auth.service.ts` (the `hashOptions` declaration and usage)
2. **`dummyHash` null narrowing issue** — affects `auth.service.ts` line 101
3. **`implements AuthRepository` on a class with a required property** — affects `test/auth.spec.ts` line 40
4. **`Promise.all(...)` returns `Promise<void[]>` not `Promise<void>`** — affects `test/auth.spec.ts` line 84
5. **`body: unknown` not assignable to supertest's `send` parameter** — affects `test/auth.spec.ts` line 124 (the `post` helper)

Now let me write the fixes:

### For `auth.service.ts`:

Fix 1: Change `type: number` to `type: typeof argon2.argon2id` or use the argon2 Options type directly.

Actually, the simplest is to just not annotate the type explicitly and let TypeScript infer it, or use `argon2.Options`:

```ts
private readonly hashOptions: argon2.Options;
```

Wait, does argon2 export an `Options` type? Let me check. The argon2 package exports `argon2.Options` as a type. Yes, it does.

So the fix is:
```ts
private readonly hashOptions: argon2.Options;
```

And in the constructor:
```ts
this.hashOptions = {
    type: argon2.argon2id,
    memoryCost: readPositiveInt('PASSWORD_HASH_MEMORY_KB', 65536),
    timeCost: readPositiveInt('PASSWORD_HASH_TIME_COST', 3),
    parallelism: readPositiveInt('PASSWORD_HASH_PARALLELISM', 2),
};
```

This should work because `argon2.argon2id` is `2` which is assignable to `0 | 1 | 2 | undefined`.

Fix 2: The `dummyHash` null issue. I'll use a non-null assertion:
```ts
private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash!;
}
```

### For `test/auth.spec.ts`:

Fix 3: Remove `implements AuthRepository`:
```ts
class InMemoryAuthRepository {
```

Fix 4: Make `flush` async:
```ts
async flush(): Promise<void> {
    await Promise.all(this.sent.map((item) => item.done));
}
```

Fix 5: Change `body: unknown` to `body: object`:
```ts
const post = (path: string, body: object): Promise<HttpObservation> =>
  request(app.getHttpServer()).post(path).send(body);
```

Wait, let me double-check fix 5. The error is at line 124, column 48. Let me look at what's at that position in the original file.

Looking at the original test file, the `post` function is:
```ts
const post = (path: string, body: unknown): Promise<HttpObservation> =>
  request(app.getHttpServer()).post(path).send(body);
```

If I count lines... The file starts with imports (about 10 lines), then constants, interfaces, classes... Let me estimate. The `post` function is around line 124 based on the error. Yes, that makes sense.

The `.send(body)` where `body` is `unknown` — supertest's send method likely expects `string | object | undefined` or similar. Changing to `object` should fix it since all callers pass object literals.

Let me now write the complete files.

For `auth.service.ts`, I need to change:
1. The `hashOptions` type declaration
2. The `getDummyHash` method to use non-null assertion

For `test/auth.spec.ts`, I need to change:
1. Remove `implements AuthRepository` from the class
2. Make `flush` async
3. Change `body: unknown` to `body: object` in the `post` helper

Let me write the complete files now.
```

## reply

### src/auth/auth.service.ts
```ts
import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

export interface Credentials {
  email: string;
  password: string;
}

export interface SignInResult {
  email: string;
}

// Fixed input for the equalizer hash; never a real password.
const DUMMY_PASSWORD = 'timing-equalizer-dummy-password-000';

const SIGN_UP_TAKEN_TEMPLATE = 'sign-up-taken';
const SIGN_UP_VERIFICATION_TEMPLATE = 'sign-up-verification';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly hashOptions: argon2.Options;
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    // Real cost factors, tunable via the environment, identical for every
    // hash and every verify in the system.
    this.hashOptions = {
      type: argon2.argon2id,
      memoryCost: readPositiveInt('PASSWORD_HASH_MEMORY_KB', 65536),
      timeCost: readPositiveInt('PASSWORD_HASH_TIME_COST', 3),
      parallelism: readPositiveInt('PASSWORD_HASH_PARALLELISM', 2),
    };
  }

  async onModuleInit(): Promise<void> {
    // Build the equalizer hash at boot so no request ever pays its one-off cost.
    await this.getDummyHash();
  }

  // The response is deliberately identical for a new address and a taken one;
  // the only branch-specific effect is which mail goes out, and that is never
  // awaited.
  async signUp(credentials: Credentials): Promise<void> {
    const { email, password } = credentials;
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      // Spend the same argon2 work the create path spends (hash vs. verify at
      // identical parameters), so the two branches take the same time.
      await this.verifyAgainstDummy(password);
      this.dispatch(email, SIGN_UP_TAKEN_TEMPLATE, { email });
      return;
    }
    const passwordHash = await argon2.hash(password, this.hashOptions);
    const { created } = await this.repository.createOrReturnExisting(email, passwordHash);
    this.dispatch(email, created ? SIGN_UP_VERIFICATION_TEMPLATE : SIGN_UP_TAKEN_TEMPLATE, { email });
  }

  // An unknown address and a wrong password both cost exactly one argon2id
  // verify and both fail with the same 401, so neither the bytes nor the time
  // reveals which one happened.
  async signIn(credentials: Credentials): Promise<SignInResult> {
    const { email, password } = credentials;
    const user = await this.repository.findByEmail(email);
    if (!user) {
      await this.verifyAgainstDummy(password);
      throw new UnauthorizedException('Invalid email or password.');
    }
    const matches = await argon2.verify(password, user.passwordHash).catch(() => false);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return { email: user.email };
  }

  // One argon2id verify at exactly the cost of a real verify/hash. The result
  // is discarded; only the time it takes matters.
  private verifyAgainstDummy(password: string): Promise<boolean> {
    return this.getDummyHash()
      .then((dummy) => argon2.verify(password, dummy))
      .catch(() => false);
  }

  private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash!;
  }

  // Fire-and-forget: mail latency can never appear in the response time, and a
  // failing mailer can never change what the caller observes.
  private dispatch(to: string, template: string, vars: Record<string, string>): void {
    void this.mail.sendEmail(to, template, vars).catch((error: unknown) => {
      this.logger.error(`mail send failed (template=${template}): ${String(error)}`);
    });
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
```

### test/auth.spec.ts
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import type { CreateResult, StoredUser } from '../src/auth/auth.repository.js';
import { MAIL_PORT } from '../src/mail/mail.port.js';
import type { MailPort } from '../src/mail/mail.port.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

// Real argon2id at a low-but-real cost so the suite stays fast. The cost is
// identical for both branches, which is exactly what the suite verifies.
process.env.PASSWORD_HASH_MEMORY_KB = '32768';
process.env.PASSWORD_HASH_TIME_COST = '1';
process.env.PASSWORD_HASH_PARALLELISM = '1';

const SIGN_UP_BODY = { message: 'If this is your address, we just sent you an email.' };
const SIGN_IN_OK_BODY = { message: 'ok' };
const SIGN_IN_ERROR_BODY = {
  error: { code: 'invalid_credentials', message: 'Invalid email or password.', details: {} },
};

interface HttpObservation {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, string>;
  done: Promise<void>;
}

class InMemoryAuthRepository {
  private readonly users = new Map<string, StoredUser>();

  findByEmail(email: string): Promise<StoredUser | null> {
    return Promise.resolve(this.users.get(email) ?? null);
  }

  createOrReturnExisting(email: string, passwordHash: string): Promise<CreateResult> {
    const existing = this.users.get(email);
    if (existing) {
      return Promise.resolve({ user: existing, created: false });
    }
    const user: StoredUser = {
      id: `id-${this.users.size + 1}`,
      email,
      passwordHash,
      createdAt: new Date(),
    };
    this.users.set(email, user);
    return Promise.resolve({ user, created: true });
  }

  count(): number {
    return this.users.size;
  }
}

class FakeMailPort implements MailPort {
  sent: SentMail[] = [];
  failNext = false;

  async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
    const done = new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
    this.sent.push({ to, template, vars, done });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mailer down');
    }
    await done;
  }

  async flush(): Promise<void> {
    await Promise.all(this.sent.map((item) => item.done));
  }

  clear(): void {
    this.sent = [];
  }
}

let app: INestApplication;
let repository: InMemoryAuthRepository;
let mail: FakeMailPort;

beforeAll(async () => {
  repository = new InMemoryAuthRepository();
  mail = new FakeMailPort();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .overrideProvider(MAIL_PORT)
    .useValue(mail)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

beforeEach(() => {
  mail.clear();
});

afterAll(async () => {
  await app.close();
});

const post = (path: string, body: object): Promise<HttpObservation> =>
  request(app.getHttpServer()).post(path).send(body);
const signUp = (email: string, password: string): Promise<HttpObservation> =>
  post('/auth/sign-up', { email, password });
const signIn = (email: string, password: string): Promise<HttpObservation> =>
  post('/auth/sign-in', { email, password });

let seq = 0;
const uniqueEmail = (label: string): string => {
  seq += 1;
  return `${label}-${seq}-${Math.random().toString(36).slice(2)}@site.test`;
};

// Headers that legitimately differ between two requests; everything else must match.
function nonVolatileHeaders(res: HttpObservation): Record<string, string> {
  const volatile = new Set(['date', 'connection', 'keep-alive']);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (value !== undefined && !volatile.has(name)) {
      headers[name] = Array.isArray(value) ? value.join(',') : value;
    }
  }
  return headers;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function timedPost(path: string, body: object): Promise<number> {
  const started = process.hrtime.bigint();
  const res = await post(path, body);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  expect(res.status).toBeLessThan(500);
  return elapsedMs;
}

describe('POST /auth/sign-up', () => {
  it('creates the account and mails a verification email for a new address', async () => {
    const email = uniqueEmail('fresh');

    const res = await signUp(email, 'fresh-password-000001');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);

    const stored = await repository.findByEmail(email);
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);

    await mail.flush();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(email);
    expect(mail.sent[0].template).toBe('sign-up-verification');
    expect(mail.sent[0].vars).toEqual({ email });
  });

  it('creates no account and mails the taken-notice for a taken address', async () => {
    const email = uniqueEmail('taken');
    await signUp(email, 'taken-seed-password-001');
    mail.clear();
    const accountsBefore = repository.count();

    const res = await signUp(email, 'attacker-guess-password');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);
    expect(repository.count()).toBe(accountsBefore);

    await mail.flush();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(email);
    expect(mail.sent[0].template).toBe('sign-up-taken');
  });

  it('answers a new address and a taken address with byte-identical responses', async () => {
    const taken = uniqueEmail('cmp-taken');
    await signUp(taken, 'cmp-taken-seed-passw1');

    const resFresh = await signUp(uniqueEmail('cmp-fresh'), 'cmp-fresh-password-001');
    const resTaken = await signUp(taken, 'cmp-attacker-guess-001');

    expect(resFresh.status).toBe(202);
    expect(resFresh.status).toBe(resTaken.status);
    expect(Buffer.from(resFresh.text, 'utf8').equals(Buffer.from(resTaken.text, 'utf8'))).toBe(true);
    expect(nonVolatileHeaders(resFresh)).toEqual(nonVolatileHeaders(resTaken));
  });

  it('keeps the response unchanged when the mail port fails', async () => {
    mail.failNext = true;
    const res = await signUp(uniqueEmail('maildown'), 'maildown-password-0001');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);
    await mail.flush();
  });

  it('answers 400 with the error envelope for an invalid body', async () => {
    const res = await signUp('not-an-email', 'short');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'invalid_request', message: expect.any(String), details: {} },
    });
  });
});

describe('POST /auth/sign-in', () => {
  it('accepts the correct credentials', async () => {
    const email = uniqueEmail('known');
    await signUp(email, 'known-password-000001');

    const res = await signIn(email, 'known-password-000001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SIGN_IN_OK_BODY);
  });

  it('rejects a wrong password with the 401 error envelope', async () => {
    const email = uniqueEmail('known');
    await signUp(email, 'known-password-000001');

    const res = await signIn(email, 'wrong-password-000001');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(SIGN_IN_ERROR_BODY);
  });

  it('answers an unknown address with a byte-identical 401', async () => {
    const known = uniqueEmail('known');
    await signUp(known, 'known-password-000001');

    const resWrong = await signIn(known, 'wrong-password-000001');
    const resUnknown = await signIn(uniqueEmail('ghost'), 'wrong-password-000001');

    expect(resWrong.status).toBe(401);
    expect(resUnknown.status).toBe(resWrong.status);
    expect(Buffer.from(resWrong.text, 'utf8').equals(Buffer.from(resUnknown.text, 'utf8'))).toBe(true);
    expect(nonVolatileHeaders(resWrong)).toEqual(nonVolatileHeaders(resUnknown));
  });
});

describe('timing equality', () => {
  const SAMPLES = 30;

  it('sign-up: a new address and a taken address take statistically the same time', async () => {
    const taken = uniqueEmail('timing-taken');
    await signUp(taken, 'timing-seed-password-01');
    // Warm up the connection and both code paths before measuring.
    for (let i = 0; i < 3; i += 1) {
      await signUp(uniqueEmail('timing-warm'), 'timing-warmup-pass-00001');
      await signIn(taken, 'timing-warmup-pass-00001');
    }

    const freshTimes: number[] = [];
    const takenTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      freshTimes.push(
        await timedPost('/auth/sign-up', {
          email: uniqueEmail('timing-fresh'),
          password: 'timing-fresh-pass-00001',
        }),
      );
      takenTimes.push(
        await timedPost('/auth/sign-up', { email: taken, password: 'timing-guess-pass-00001' }),
      );
    }

    const freshMedian = median(freshTimes);
    const takenMedian = median(takenTimes);
    const ratio = Math.max(freshMedian, takenMedian) / Math.min(freshMedian, takenMedian);
    expect(
      ratio,
      `fresh=${freshMedian.toFixed(2)}ms taken=${takenMedian.toFixed(2)}ms ratio=${ratio.toFixed(2)}`,
    ).toBeLessThan(1.75);
  }, 30000);

  it('sign-in: a wrong password and an unknown address take statistically the same time', async () => {
    const known = uniqueEmail('timing-known');
    await signUp(known, 'timing-known-pass-00001');
    for (let i = 0; i < 3; i += 1) {
      await signIn(known, 'timing-warmup-pass-00001');
      await signIn(uniqueEmail('timing-warm-ghost'), 'timing-warmup-pass-00001');
    }

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(
        await timedPost('/auth/sign-in', { email: known, password: `timing-wrong-pass-${i}-0000` }),
      );
      unknownTimes.push(
        await timedPost('/auth/sign-in', {
          email: uniqueEmail('timing-ghost'),
          password: `timing-unknown-pass-${i}-0000`,
        }),
      );
    }

    const wrongMedian = median(wrongTimes);
    const unknownMedian = median(unknownTimes);
    const ratio = Math.max(wrongMedian, unknownMedian) / Math.min(wrongMedian, unknownMedian);
    expect(
      ratio,
      `wrong=${wrongMedian.toFixed(2)}ms unknown=${unknownMedian.toFixed(2)}ms ratio=${ratio.toFixed(2)}`,
    ).toBeLessThan(1.75);
  }, 30000);
});
```
