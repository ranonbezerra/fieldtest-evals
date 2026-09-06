# repair1-auth.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/auth.spec.ts`:

1. `test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.` - This is a missing dependency issue, but I can't fix that by rewriting the file. However, the file imports from `@nestjs/testing` so I need to keep that import. This is a project-level issue (missing `node_modules` or missing dependency in package.json). I'll keep the import as-is since it's needed.

2. `test/auth.spec.ts(10,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.` - Same, missing dependency. I'll keep the import.

3. `test/auth.spec.ts(13,28): error TS2307: Cannot find module '../src/auth/auth.module' or its corresponding type declarations.` - The module file might not exist yet or has a different name. Based on the plan, it should be `src/auth/auth.module.ts`. I'll keep the import.

4. `test/auth.spec.ts(14,44): error TS2307: Cannot find module '../src/auth/auth.service' or its corresponding type declarations.` - Same, keep import.

5. `test/auth.spec.ts(16,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.` - Same, keep import.

6. `test/auth.spec.ts(30,20): error TS18046: 'exception' is of type 'unknown'.` - In a catch block, `exception` is typed as `unknown`. I need to narrow it.

7. Multiple `test/auth.spec.ts(...): error TS2339: Property 'inject' does not exist on type 'INestApplication<any>'.` - This is the big one. The test is using `app.inject()` which doesn't exist on `INestApplication`. 

Wait, looking more carefully at the errors - the test is calling `.inject()` on what appears to be an `INestApplication`. In NestJS, `INestApplication` doesn't have an `.inject()` method. The test seems to be using some kind of Supertest-like pattern but calling it `.inject()` instead of the correct method.

Actually, looking at this more carefully - in NestJS testing with Supertest, you'd use `request(app.getHttpServer())` to get a supertest instance, then call `.post()`, `.send()`, etc. The `.inject()` method is not standard NestJS testing.

Wait - could this be using `@nestjs/testing` with a custom setup? Or maybe the test was written assuming a method called `inject` that doesn't exist on `INestApplication`.

Let me think about what the test is actually trying to do. It's making HTTP requests to the app. The correct way in NestJS with Supertest is:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

const moduleFixture = await Test.createTestingModule({...}).compile();
const app = moduleFixture.createNestApplication();
await app.init();

// Then use supertest:
const response = await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password });
```

So the fix for all those `.inject()` errors is to replace them with the proper Supertest pattern.

But wait - I need to look at what the test file is actually doing. Since I can only see the errors and not the actual file content, I need to reconstruct it based on:
- The PLAN.md which specifies all 15 tests
- The error messages which tell me line numbers and what's being called

Let me reconstruct the test file based on the plan:

Tests needed:
1. sign-up new email → 200, correct body
2. sign-up existing email → 200, correct body
3. sign-up byte-equality of response (new vs existing)
4. sign-up timing (N=30 samples each branch)
5. sign-up sends verification email for new address
6. sign-up sends "sign-up-attempt" email for existing address
7. (removed - not applicable)
8. sign-in correct credentials → 200 + token
9. sign-in wrong password (known email) → 401 envelope
10. sign-in unknown email → 401 envelope
11. sign-in byte-equality (wrong-password vs unknown-email)
12. sign-in timing (N=30 samples each branch)
13. sign-up / sign-in missing fields → 400 validation_failed
14. password stored as argon2id hash (inspect DB after sign-up)
15. (skip - not implemented)

Now let me figure out the structure:

- Line 1: import from `@nestjs/testing`
- Line 10: import from `argon2`
- Line 13: import from `../src/auth/auth.module`
- Line 14: import from `../src/auth/auth.service`
- Line 16: import from `../src/prisma/prisma.service`
- Line 30: something with `exception` being `unknown` (likely in a catch block)

The `.inject()` calls start at line 168 and go through line 490.

Let me think about how to structure this properly with Supertest:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
// ... other imports
```

For the `.inject()` calls, I'll replace them with `request(app.getHttpServer())` pattern.

Actually wait - I need to be more careful. The error says `Property 'inject' does not exist on type 'INestApplication<any>'`. This means the test is doing something like:

```ts
const app = moduleFixture.createNestApplication();
// ...
app.inject('POST', '/auth/sign-up', { email, password });
```

But `INestApplication` doesn't have an `inject` method. The correct approach is to use Supertest:

```ts
const response = await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password });
```

Now let me think about the `exception` being `unknown` on line 30. This is likely in a helper function or a catch block:

```ts
try {
  // something
} catch (exception) {
  // exception is unknown here
  expect(exception.message).toBe(...); // ERROR: 'exception' is of type 'unknown'
}
```

Fix: narrow the type:
```ts
catch (exception) {
  if (exception instanceof Error) {
    expect(exception.message).toBe(...);
  }
}
```

Or:
```ts
catch (exception: unknown) {
  expect(exception).toBeInstanceOf(AuthFailureError);
}
```

Now let me write the complete test file. I need to be careful about:

1. The plan says tests should "fail if the property is broken"
2. Timing tests compare two branches over multiple samples
3. Byte comparison of responses
4. The error envelope format

Let me also think about how to mock the repository for testing. Based on the plan:
- `AuthRepository` has `findByEmail`, `createUser`, `touchUser`
- `MailPort` has `sendEmail`

For the tests, I'll need to:
- Mock `PrismaService` (or mock the repository)
- Mock `MailPort`

Actually, looking at the plan more carefully, the tests should test through the full HTTP stack (since they check response bytes, headers, timing). So I need to create the testing module with mocks for the database and mail.

Let me think about the approach:
- Use `Test.createTestingModule` with `AuthModule`
- Override `PrismaService` with a mock
- Override `MailPort` with a mock

Wait, but the plan says `PrismaService` is at `src/prisma/prisma.service`. Let me structure accordingly.

Actually, I realize I need to be more careful. The errors reference specific line numbers in the existing file. Since I'm rewriting the entire file, I just need to make sure my new version doesn't have these errors. Let me focus on writing a correct test file.

Key decisions:
1. Use Supertest for HTTP requests (replaces all `.inject()` calls)
2. Handle `unknown` type in catch blocks properly
3. Keep all imports that reference modules (they may have their own issues but those aren't in this file's error list... wait, actually they ARE in the error list)

Hmm, but the errors for module not found (lines 1, 10, 13, 14, 16) are also listed for `test/auth.spec.ts`. These are module resolution errors. If the modules don't exist or aren't installed, I can't fix that by rewriting this file alone. But the task says "fixing what these messages require of this file."

For module-not-found errors:
- `@nestjs/testing` - this is a dependency, not something I can fix in the file
- `argon2` - same
- `../src/auth/auth.module` - this is a source file that should exist
- `../src/auth/auth.service` - same
- `../src/prisma/prisma.service` - same

These errors would be resolved by having the correct files and dependencies in place. Since I'm only rewriting `test/auth.spec.ts`, I should keep these imports as they are (they're correct based on the plan) and the errors would be resolved when the other files exist and dependencies are installed.

Wait, but the task says "fixing what these messages require of this file." So I should make sure the imports are correct (which they are based on the plan) and fix the type errors that ARE fixable within this file:
1. `exception` is of type `unknown` → narrow the type
2. `.inject()` doesn't exist → use Supertest pattern

Let me now write the complete file. I'll structure it according to the plan's test list.

Let me think about the Supertest setup:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth', () => {
  let app: INestApplication;
  let prismaMock: any;
  let mailMock: { sendEmail: jest.fn() };

  // ... setup/teardown
});
```

Wait, the project uses Vitest, not Jest. So I should use `vi.fn()` instead of `jest.fn()`.

Let me reconsider the structure:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';
```

Hmm wait, does `@nestjs/testing` work with Vitest? Yes, it does - it's framework-agnostic in terms of the testing module creation.

Now for the `PrismaService` mock - I need to think about what methods it exposes that the repository uses. Based on the plan:
- `findByEmail` → likely `prisma.user.findUnique({ where: { email } })`
- `createUser` → likely `prisma.user.create({ data: { email, passwordHash } })`
- `touchUser` → likely `prisma.user.update({ where: { id }, data: {} })`

So I need to mock `prisma.user.findUnique`, `prisma.user.create`, `prisma.user.update`.

Let me think about how to set up the mock. I'll create a mock object that mimics the Prisma client:

```ts
const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
};
```

Then in the testing module:
```ts
const moduleFixture = await Test.createTestingModule({
  imports: [AuthModule],
})
  .overrideProvider(PrismaService)
  .useValue(prismaMock)
  .overrideProvider(MailPort)
  .useValue(mailMock)
  .compile();
```

Wait, but `MailPort` is an interface, not a class. In NestJS, you can override by token. If `MailPort` is provided as `{ provide: MailPort, useValue: ... }` in the module, then I can override it with `.overrideProvider(MailPort)`.

Actually, looking at the plan again:
```
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

So `MailPort` is provided as a token. I can override it with:
```ts
.overrideProvider(MailPort).useValue(mailMock)
```

But wait - `MailPort` is an interface. Can I use an interface as a token? In TypeScript/NestJS, you typically need a class or a string/symbol. If `MailPort` is defined as an interface, it won't work as a token directly.

Looking at the plan more carefully:
```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

And in the module: `providers: [AuthService, AuthRepository, MailPort /* token provider */]`

This suggests they're using `MailPort` as a token. But an interface in TypeScript doesn't exist at runtime - it's erased. So this won't work unless they use a different approach, like:
- A constant token: `export const MAIL_PORT = 'MAIL_PORT';`
- Or a class instead of an interface

Hmm, but the plan says it this way. Let me look at the service constructor:
```ts
constructor(
  private readonly repo: AuthRepository,
  private readonly mail: MailPort,
) {}
```

If `MailPort` is just an interface, the DI token would need to be something else. Maybe they use `@Inject(MAIL_PORT)` decorator. But the plan doesn't show that explicitly.

Actually, I think for the test file, I should just use whatever token is used in the module. Since I can't see the actual source files, I'll assume that `MailPort` is used as a token (perhaps it's actually a class, or there's a constant). Let me use it as-is and add an ASSUMPTION comment if needed.

Wait, actually re-reading the plan: "MailPort /* token provider */" - this comment suggests it's being used as a token. In NestJS, if you do `@Inject(MailPort)` in the constructor, then `MailPort` needs to be a valid token at runtime. An interface won't work. 

I think the most likely implementation is that `MailPort` is actually a class (or there's a string/symbol token). For the test, I'll just reference it and if it's not valid, that would be a source file issue, not a test file issue.

Actually, you know what, let me just look at this differently. The errors I need to fix in `test/auth.spec.ts` are:

1. Module not found errors (lines 1, 10, 13, 14, 16) - these are about missing dependencies/files. I can't fix these by changing the test file content if the modules genuinely don't exist. But I should make sure my imports are correct per the plan.

2. `exception` is of type `unknown` (line 30) - I need to handle this with proper type narrowing.

3. `.inject()` doesn't exist on `INestApplication` (many lines) - I need to replace with Supertest.

So my job is:
- Write the test file using Supertest instead of `.inject()`
- Properly handle `unknown` in catch blocks
- Keep all the test cases from the plan
- Make sure imports are correct

Let me now write the full file. I'll be thorough and make sure all 15 test cases (minus the removed/skipped ones) are covered.

Actually, let me reconsider the `@nestjs/testing` and `supertest` imports. The project uses Vitest. Does it have `supertest` as a dependency? It's not listed in the plan explicitly, but it's the standard way to test NestJS HTTP endpoints. I'll include it.

Let me also think about the timing tests. The plan says:
- N=30 samples each branch
- Compare median and p95
- Threshold: < 10 ms difference

For timing tests, I'll:
1. Measure the time for each request
2. Collect N samples for each branch
3. Calculate median and p95
4. Assert the difference is below threshold

Let me write helper functions for this.

Now, one important consideration: the timing tests need to actually hit the HTTP endpoint and measure wall-clock time. With Supertest, each `request()` call gives me a response, and I can measure the time around it.

Let me draft the file:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// ... rest of the file
```

Wait, I should think about whether to use `beforeAll`/`afterAll` or `beforeEach`/`afterEach`. For timing tests, I want a fresh state. But creating the app per test is expensive. Let me use `beforeAll` to create the app once, and reset mocks between tests.

Actually, for the byte-equality and timing tests, I need to be able to control whether an email exists or not. So I'll set up the Prisma mock's `findUnique` to return different values based on the test.

Let me think about the structure:

```ts
describe('Auth', () => {
  let app: INestApplication;
  const prismaUserMock = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mailMock = {
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: prismaUserMock, $connect: vi.fn(), $disconnect: vi.fn() })
      .overrideProvider(MailPort)
      .useValue(mailMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper to make a sign-up request and return { response, duration }
  async function signUp(email: string, password: string): Promise<{ res: any; duration: number }> {
    const start = performance.now();
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password });
    const duration = performance.now() - start;
    return { res, duration };
  }

  // Similar for sign-in...

  // Tests...
});
```

Hmm, but there's a problem. The `MailPort` token - if it's an interface, it won't work as a DI token. Let me think about this...

In the plan, the service constructor is:
```ts
constructor(
  private readonly repo: AuthRepository,
  private readonly mail: MailPort,
) {}
```

For this to work with NestJS DI, `MailPort` must be a valid injection token. Options:
1. It's a class (not interface) - then it works as a token
2. There's an `@Inject(MAIL_PORT_TOKEN)` decorator - then I need to know the token
3. It's provided with a string key

Since the plan shows `providers: [AuthService, AuthRepository, MailPort]`, it seems like `MailPort` is being used directly as a provider. In NestJS, if you list a class in `providers`, it's instantiated and can be injected by type. But an interface isn't a class...

I think the most reasonable interpretation is that in the actual implementation, `MailPort` might be a class (perhaps with a default no-op implementation), or there's a string token. For the test, I'll just use `MailPort` as the token and add an ASSUMPTION if needed.

Actually, wait. Let me re-read the plan: "MailPort /* token provider */". The comment says "token provider" which suggests it IS a token. In NestJS, you can use any value as a token (string, symbol, class). If the code uses `@Inject('MAIL_PORT')` or similar, I'd need to know that.

You know what, I'll just use `MailPort` as-is in the override. If it's a class, great. If it's something else, the error would be in the source file, not the test. The task says to fix what the compiler messages require of THIS file.

The compiler messages for this file are:
1. Module not found (can't fix in this file if the module doesn't exist)
2. `exception` is unknown (fixable)
3. `.inject()` doesn't exist (fixable)

So let me focus on making a correct test file that:
- Uses Supertest (not `.inject()`)
- Handles `unknown` in catch blocks
- Has all the tests from the plan
- Has correct imports per the plan

Let me also think about whether I need `supertest` types. The import `import request from 'supertest'` should work if `@types/supertest` is installed. If not, I might need to handle it differently. But since the original file was using `.inject()` (which suggests it wasn't using Supertest), maybe I need to add the Supertest import. This would be a new dependency but it's the standard way to test NestJS HTTP endpoints.

Actually, I just realized - maybe the original test was using a different approach entirely. The `.inject()` method... could it be from a custom wrapper? Or maybe the developer confused it with something else.

Regardless, the fix is clear: use Supertest's `request(app.getHttpServer())` pattern.

Let me now write the complete file. I'll be comprehensive:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth', () => {
  let app: INestApplication;

  const prismaUser = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const mail = {
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: prismaUser, $connect: vi.fn(), $disconnect: vi.fn() })
      .overrideProvider(MailPort as any)
      .useValue(mail)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaUser.findUnique.mockReset();
    prismaUser.create.mockReset();
    prismaUser.update.mockReset();
    mail.sendEmail.mockClear();
  });

  // --- Helpers ---

  async function signUp(email: string, password: string) {
    const start = performance.now();
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password });
    const durationMs = performance.now() - start;
    return { res, durationMs };
  }

  async function signIn(email: string, password: string) {
    const start = performance.now();
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password });
    const durationMs = performance.now() - start;
    return { res, durationMs };
  }

  function percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // --- Sign-up tests ---

  it('sign-up with a new email returns 200 with the expected body', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'new-id' });

    const { res } = await signUp('new@example.com', 'password123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
  });

  it('sign-up with an existing email returns 200 with the expected body', async () => {
    const fakeHash = await argon2.hash('existingpass', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    prismaUser.findUnique.mockResolvedValue({ id: 'existing-id', email: 'existing@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});

    const { res } = await signUp('existing@example.com', 'password123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
  });

  it('sign-up responses are byte-identical for new and existing emails', async () => {
    const fakeHash = await argon2.hash('existingpass', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });

    // New email
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'new-id' });
    const { res: newRes } = await signUp('byte-new@example.com', 'password123');

    // Existing email
    prismaUser.findUnique.mockResolvedValue({ id: 'existing-id', email: 'byte-existing@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});
    const { res: existingRes } = await signUp('byte-existing@example.com', 'password123');

    // Compare status
    expect(newRes.status).toBe(existingRes.status);
    // Compare body bytes
    expect(JSON.stringify(newRes.body)).toBe(JSON.stringify(existingRes.body));
    // Compare content-type header
    expect(newRes.headers['content-type']).toBe(existingRes.headers['content-type']);
  });

  it('sign-up timing is indistinguishable between new and existing emails', async () => {
    const fakeHash = await argon2.hash('existingpass', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    const N = 30;
    const newTimings: number[] = [];
    const existingTimings: number[] = [];

    for (let i = 0; i < N; i++) {
      // New email
      prismaUser.findUnique.mockResolvedValue(null);
      prismaUser.create.mockResolvedValue({ id: `new-${i}` });
      const { durationMs: d1 } = await signUp(`timing-new-${i}@example.com`, 'password123');
      newTimings.push(d1);

      // Existing email
      prismaUser.findUnique.mockResolvedValue({ id: `existing-${i}`, email: `timing-existing-${i}@example.com`, passwordHash: fakeHash });
      prismaUser.update.mockResolvedValue({});
      const { durationMs: d2 } = await signUp(`timing-existing-${i}@example.com`, 'password123');
      existingTimings.push(d2);
    }

    const newMedian = median(newTimings);
    const existingMedian = median(existingTimings);
    const newP95 = percentile([...newTimings].sort((a, b) => a - b), 95);
    const existingP95 = percentile([...existingTimings].sort((a, b) => a - b), 95);

    expect(Math.abs(newMedian - existingMedian)).toBeLessThan(10);
    expect(Math.abs(newP95 - existingP95)).toBeLessThan(10);
  });

  it('sign-up sends a verification email for a new address', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'new-id' });

    await signUp('verify-new@example.com', 'password123');

    expect(mail.sendEmail).toHaveBeenCalledWith(
      'verify-new@example.com',
      'verification',
      expect.objectContaining({ email: 'verify-new@example.com' }),
    );
  });

  it('sign-up sends a sign-up-attempt email for an existing address', async () => {
    const fakeHash = await argon2.hash('existingpass', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    prismaUser.findUnique.mockResolvedValue({ id: 'existing-id', email: 'verify-existing@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});

    await signUp('verify-existing@example.com', 'password123');

    expect(mail.sendEmail).toHaveBeenCalledWith(
      'verify-existing@example.com',
      'sign-up-attempt',
      expect.objectContaining({ email: 'verify-existing@example.com' }),
    );
  });

  // --- Sign-in tests ---

  it('sign-in with correct credentials returns 200 and a token', async () => {
    const realHash = await argon2.hash('correctpass1', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    prismaUser.findUnique.mockResolvedValue({ id: 'user-1', email: 'sign-in@example.com', passwordHash: realHash });

    const { res } = await signIn('sign-in@example.com', 'correctpass1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('sign-in with wrong password returns 401 with the standard envelope', async () => {
    const realHash = await argon2.hash('correctpass1', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    prismaUser.findUnique.mockResolvedValue({ id: 'user-1', email: 'wrong-pw@example.com', passwordHash: realHash });

    const { res } = await signIn('wrong-pw@example.com', 'wrongpass123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        details: {},
      },
    });
  });

  it('sign-in with unknown email returns 401 with the standard envelope', async () => {
    prismaUser.findUnique.mockResolvedValue(null);

    const { res } = await signIn('unknown@example.com', 'whatever123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        details: {},
      },
    });
  });

  it('sign-in failure responses are byte-identical for wrong password and unknown email', async () => {
    const realHash = await argon2.hash('correctpass1', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });

    // Wrong password (known email)
    prismaUser.findUnique.mockResolvedValue({ id: 'user-1', email: 'bw@example.com', passwordHash: realHash });
    const { res: wrongPwRes } = await signIn('bw@example.com', 'wrongpass123');

    // Unknown email
    prismaUser.findUnique.mockResolvedValue(null);
    const { res: unknownRes } = await signIn('unknown-bw@example.com', 'whatever123');

    expect(wrongPwRes.status).toBe(unknownRes.status);
    expect(JSON.stringify(wrongPwRes.body)).toBe(JSON.stringify(unknownRes.body));
    expect(wrongPwRes.headers['content-type']).toBe(unknownRes.headers['content-type']);
  });

  it('sign-in timing is indistinguishable between wrong password and unknown email', async () => {
    const realHash = await argon2.hash('correctpass1', { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 });
    const N = 30;
    const wrongPwTimings: number[] = [];
    const unknownTimings: number[] = [];

    for (let i = 0; i < N; i++) {
      // Wrong password (known email)
      prismaUser.findUnique.mockResolvedValue({ id: `user-${i}`, email: `timing-wrongpw-${i}@example.com`, passwordHash: realHash });
      const { durationMs: d1 } = await signIn(`timing-wrongpw-${i}@example.com`, 'wrongpass123');
      wrongPwTimings.push(d1);

      // Unknown email
      prismaUser.findUnique.mockResolvedValue(null);
      const { durationMs: d2 } = await signIn(`timing-unknown-${i}@example.com`, 'whatever123');
      unknownTimings.push(d2);
    }

    const wrongPwMedian = median(wrongPwTimings);
    const unknownMedian = median(unknownTimings);
    const wrongPwP95 = percentile([...wrongPwTimings].sort((a, b) => a - b), 95);
    const unknownP95 = percentile([...unknownTimings].sort((a, b) => a - b), 95);

    expect(Math.abs(wrongPwMedian - unknownMedian)).toBeLessThan(10);
    expect(Math.abs(wrongPwP95 - unknownP95)).toBeLessThan(10);
  });

  // --- Validation tests ---

  it('sign-up with missing fields returns 400 validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('sign-in with missing fields returns 400 validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  // --- Password hashing test ---

  it('password is stored as an argon2id hash with a real cost factor', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => {
      // Verify the hash format
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      // Parse cost factor from the hash: $argon2id$v=19$m=65536,t=3,p=1$...
      const m = data.passwordHash.match(/m=(\d+),t=(\d+)/);
      expect(m).not.toBeNull();
      const memoryCost = parseInt(m![1], 10);
      const timeCost = parseInt(m![2], 10);
      expect(timeCost).toBeGreaterThanOrEqual(3);
      expect(memoryCost).toBeGreaterThanOrEqual(65536);
      return { id: 'hashed-id' };
    });

    await signUp('hash-check@example.com', 'password123');

    expect(prismaUser.create).toHaveBeenCalledOnce();
  });
});
```

Wait, I have a problem with the `MailPort` override. If `MailPort` is an interface (which is erased at runtime), I can't use it as a DI token. Let me think about this...

In NestJS, when you do `@Inject(MailPort)` in a constructor, the parameter decorator captures the token. If `MailPort` is an interface, at runtime it's `undefined` (interfaces are erased). So the DI system would look for a provider with token `undefined`, which is problematic.

The most common pattern for this in NestJS is:
1. Use a class as the token (even if it's just a marker class)
2. Use a string/symbol constant: `export const MAIL_PORT = Symbol('MAIL_PORT')` or `export const MAIL_PORT = 'MAIL_PORT'`
3. Use an abstract class

Since the plan shows `MailPort` being used directly in the providers array and the constructor, I think the actual implementation might use a class or there's some other mechanism. 

For the test file, I'll just use `MailPort` as-is in the override. If it doesn't work at runtime, that's a source file issue. The compiler won't complain about this in the test file as long as `MailPort` is exported from the service module.

Actually wait - the compiler errors don't include any error about `MailPort` not being a valid token or anything like that. The errors are specifically about:
1. Module not found
2. `unknown` type
3. `.inject()` method

So I just need to fix those three issues. Let me proceed with my approach.

One more thing - I should make sure the `MailPort` import is correct. The plan says it's exported from `auth.service.ts`:
```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

So I import it from `../src/auth/auth.service`.

Now, there's a subtle issue with using an interface as a DI token in the test. In TypeScript, if `MailPort` is an interface, then at runtime `MailPort` in the test file would be `undefined` (since interfaces don't exist at runtime). So `.overrideProvider(MailPort)` would be `.overrideProvider(undefined)` which wouldn't work.

But wait - this is the same problem that would exist in the source code too. If the source code uses `MailPort` as a DI token and it's an interface, the app wouldn't work at all. So either:
1. The source code actually uses a class (not interface) for `MailPort`
2. There's a different token mechanism I'm not seeing

Since I can't see the source code and the plan says it's an interface, I'll add an ASSUMPTION comment. But for the test to compile, it just needs `MailPort` to be a valid import from the service module. The runtime behavior is a separate concern.

Actually, you know what, let me look at this from a different angle. The plan says:
```
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

If `MailPort` is in the providers array, NestJS will try to instantiate it. If it's an interface, that would fail at runtime but not at compile time. The test file just needs to reference it correctly for the compiler.

For the `.overrideProvider()` call in the test, I need to pass the same token that's used in the DI system. If the source uses `MailPort` (whatever it resolves to at runtime), I should use the same in the test.

Let me just proceed and use `MailPort` as-is. If there's a runtime issue, it would be in the source files, not the test.

Hmm, actually one more thought. In many NestJS projects, when you have a port/adapter pattern, you define:
```ts
export const MAIL_PORT = 'MAIL_PORT';
```
And then use `@Inject(MAIL_PORT)` in the constructor. But the plan shows direct type-based injection. Let me just go with what the plan says.

Let me finalize my test file. I want to make sure:
1. No `.inject()` calls - use Supertest ✓
2. No unhandled `unknown` in catch blocks ✓ (I don't think I have any catch blocks in my version)
3. All tests from the plan are present ✓
4. Imports are correct per the plan ✓

Wait, do I have any catch blocks? Let me check... No, I don't think so. The original file had one at line 30 where `exception` was `unknown`. In my version, I don't use try/catch in the tests. So that error is naturally fixed.

Actually, let me double-check - is there any test where I'd need to catch an error? Looking at the plan's tests... No, all tests make HTTP requests and check the response. The service throws `AuthFailureError` which is caught by the global exception filter and converted to a 401 response. So in the tests, I just check the HTTP response status and body. No need for try/catch.

Let me also make sure I'm not missing the `supertest` import. Since the original file used `.inject()` (which doesn't exist), it probably wasn't using Supertest. I need to add the Supertest import. This is a new dependency but it's the standard approach for NestJS integration tests.

Actually, I realize I should check - does the project already have `supertest` as a dependency? It's not explicitly mentioned in the plan, but it's almost certainly needed for any NestJS HTTP testing. I'll include the import.

Let me also think about whether I need `@types/supertest`. In TypeScript, if the types aren't available, I might get an error. But since the task only asks me to fix the specific errors listed, and module-not-found for `supertest` isn't in the list (because the original file didn't import it), adding it might introduce a new error if the types aren't installed.

Hmm, but the task says "fixing what these messages require of this file." The messages don't say anything about `supertest`. But to fix the `.inject()` errors, I need SOME way to make HTTP requests. The alternatives are:
1. Use Supertest (standard NestJS approach)
2. Use `app.inject()` - but that doesn't exist on `INestApplication`
3. Use the underlying HTTP server directly with Node's `http` module

Actually, wait. Let me re-read the error: `Property 'inject' does not exist on type 'INestApplication<any>'`. This means the test is calling `app.inject(...)`. The fix is to not call a non-existent method.

In NestJS, the standard way is Supertest. Let me use that. If `supertest` types aren't available, I can add a type assertion or import the types separately.

Actually, in modern setups with `supertest` v6+, the package includes its own TypeScript types. So `import request from 'supertest'` should work without separate type declarations.

Let me finalize the file now. I'll make it clean and complete.

One more consideration: the `beforeAll` setup. I need to make sure the app is properly initialized with the global pipes and exception filter. Looking at the plan:
- Global `ValidationPipe({ whitelist: true })` in `main.ts`
- Global exception filter that maps `AuthFailureError → 401`

For the test, I need to replicate this. I'll add the `ValidationPipe` and also handle the exception filter. But wait - if the exception filter is registered in `main.ts`, it won't be automatically applied to the test app. I need to either:
1. Register it in the test setup too
2. Or register it as a global filter in the module

The plan says it's in `main.ts`. For the test, I'll apply it manually:
```ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
app.useGlobalFilters(new AllExceptionsFilter()); // or whatever the filter is called
```

But I don't know the exact name of the exception filter class. Let me think...

The plan says: "global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope."

I could import it from wherever it's defined, or I could create a minimal one in the test. But the task says "Do not create a file it does not call for." So I shouldn't create new files.

Actually, the simplest approach: if the `AuthModule` or `AppModule` already applies the exception filter as a global filter (via `APP_FILTER` provider), then it would be automatically applied when I import the module in the test. Let me assume that's the case (it's a common NestJS pattern to use `APP_FILTER` in the root module).

If the filter is only in `main.ts`, I'd need to apply it manually. But since I can't see the source, I'll assume it's properly set up in the module (which is the more maintainable approach and likely what was done).

Actually, let me re-read the plan: "Bootstraps Nest, applies global `ValidationPipe({ whitelist: true })`, global exception filter that maps..."

This clearly says it's in `main.ts`. So for the test, I need to apply these manually. Let me do:

```ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
// For the exception filter, I need to know its class name...
```

Hmm, this is tricky. Let me think of another approach. What if I just test the service directly for some tests, and only use HTTP for the byte-equality and timing tests?

No wait, the byte-equality and timing tests REQUIRE HTTP responses (they compare headers, body bytes, and measure wall-clock time). So I need the full HTTP stack.

OK let me think about this differently. The exception filter converts `AuthFailureError` to a 401 response with the standard envelope. If I don't apply the filter in the test, then when the service throws `AuthFailureError`, NestJS's default exception filter would handle it (returning a 500 or whatever). That would break my tests.

So I need the exception filter in the test. Options:
1. Import it from wherever it's defined (but I don't know the file/class name)
2. Define a minimal one inline in the test

Option 2 is cleaner since I'm not creating new files. Let me define a minimal exception filter in the test:

```ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch(AuthFailureError)
class AuthFailureFilter implements ExceptionFilter {
  catch(exception: AuthFailureError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(401).json({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        details: {},
      },
    });
  }
}
```

Wait, but I also need to handle validation errors (400). The `ValidationPipe` already throws `BadRequestException` for validation errors, and NestJS's default exception filter handles it. But the error format might not match the standard envelope.

Hmm, this is getting complicated. Let me take a step back.

The plan says the global exception filter maps both `AuthFailureError → 401` and `ValidationError → 400`. If this filter is in `main.ts`, I need to replicate it in the test.

But actually, for validation errors, if I use `ValidationPipe`, it throws `BadRequestException` by default. The default NestJS exception filter would return:
```json
{ "statusCode": 400, "message": [...], "error": "Bad Request" }
```

But the plan wants:
```json
{ "error": { "code": "validation_failed", "message": "...", "details": {} } }
```

So I definitely need a custom exception filter for both cases.

Let me define it inline in the test file. I'll create a simple filter that handles both cases:

```ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch()
class GlobalTestFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof AuthFailureError) {
      response.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
      });
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (status === 400) {
        response.status(400).json({
          error: { code: 'validation_failed', message: (res as any).message, details: {} },
        });
      } else {
        response.status(status).json({ error: { code: 'error', message: (res as any).message, details: {} } });
      }
    } else {
      response.status(500).json({ error: { code: 'internal_error', message: 'Internal server error.', details: {} } });
    }
  }
}
```

This should work. I'll apply it with `app.useGlobalFilters(new GlobalTestFilter())`.

Wait, but there's a subtlety. The `ValidationPipe` throws a `BadRequestException` which extends `HttpException`. Its `getStatus()` returns 400 and `getResponse()` returns an object with `message` being an array of strings (the validation messages) or a string.

Let me adjust:
```ts
} else if (exception instanceof HttpException && exception.getStatus() === 400) {
  response.status(400).json({
    error: { code: 'validation_failed', message: 'Validation failed.', details: {} },
  });
}
```

Actually, for the test purposes, I just need the response to have `status: 400` and `body.error.code === 'validation_failed'`. The exact message doesn't matter for the test assertion (which checks `res.body.error.code`).

Let me simplify. I'll write a filter that handles the two cases I care about:
1. `AuthFailureError` → 401 with the standard envelope
2. `HttpException` with status 400 (from ValidationPipe) → 400 with `validation_failed` code
3. Everything else → 500

OK, I think I have enough to write the complete file now. Let me do it.

Actually, one more thought: the `// ASSUMPTION:` comments. The instructions say:
- "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I can't see:
- The exact shape of `PrismaService` (what methods/properties it has)
- Whether `MailPort` is a class or interface at runtime (affects DI token)
- The exact exception filter in `main.ts`

But for the test file, I'm defining my own mocks and filter, so I don't really need to know those shapes. The only thing I'm "assuming" is that `MailPort` can be used as a DI token in `.overrideProvider()`. If it's an interface (erased at runtime), this would fail. But that's a source file issue, not a test file issue.

Actually, I realize there might be an issue. If `MailPort` is an interface, then at runtime in the test file, `MailPort` would be `undefined`. So `.overrideProvider(MailPort)` would be `.overrideProvider(undefined)`, which NestJS would interpret as... probably an error or no-op.

To be safe, I could use a string token instead:
```ts
.overrideProvider('MAIL_PORT' as any)
```

But that assumes the source uses `'MAIL_PORT'` as the token, which I don't know.

Alternatively, I could just override `AuthService` directly and not test through the full DI stack. But that would defeat the purpose of integration testing.

You know what, let me just use `MailPort` as-is and add an ASSUMPTION comment. The compiler won't complain about this (it's a valid import), and if it fails at runtime, that's a source file issue.

Wait, actually - will the compiler complain? If `MailPort` is an interface, TypeScript would still allow me to import it (for type checking). But using it as a value (in `.overrideProvider(MailPort)`) would be an error because interfaces don't exist at runtime.

Hmm, but the original file already imports `MailPort` from `../src/auth/auth.service` and the compiler error for that line is only "Cannot find module" (because the file doesn't exist yet). Once the file exists, if `MailPort` is an interface, using it as a value would give a different error.

But the task says to fix the errors listed. The error on line 14 is "Cannot find module '../src/auth/auth.service'" - which means the module doesn't exist yet. I can't predict what errors would appear once it does exist. So I'll just write the code as if `MailPort` is usable as a value (which it would be if it's a class or has a runtime representation).

OK, I'm overthinking this. Let me just write the file and move on. The key fixes are:
1. Replace `.inject()` with Supertest
2. Handle `unknown` in catch blocks (I don't have any, so this is naturally fixed)
3. Keep correct imports

Let me write the final version now.

One more thing: I should make sure the timing tests are robust. 10ms threshold might be too tight for CI environments. But the plan says 10ms, so I'll use that. Actually, looking at the plan again: "Median and p95 of the two distributions overlap within a threshold (e.g. < 10 ms difference)". The "e.g." suggests it's a suggestion, not a hard requirement. I'll use 10ms as stated.

Actually, for timing tests to be meaningful, the argon2 verification needs to be the dominant cost. With t=3 and m=65536, argon2id should take around 100-200ms. A 10ms difference would be about 5-10% of the total, which is reasonable as a threshold.

Let me finalize now. Here's my complete test file:
```

## reply

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// ASSUMPTION: MailPort is a valid runtime DI token (class or symbol), not a pure interface erased at compile time.

/**
 * Minimal global exception filter replicating the one in main.ts so that
 * the test app produces the same error envelope.
 */
@Catch()
class GlobalTestFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status(code: number, body: object): unknown }>();

    if (exception instanceof AuthFailureError) {
      response.status(401, {
        error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 400) {
        response.status(400, {
          error: { code: 'validation_failed', message: 'Validation failed.', details: {} },
        });
        return;
      }
    }

    response.status(500, {
      error: { code: 'internal_error', message: 'Internal server error.', details: {} },
    });
  }
}

const ARGON2_PARAMS = { type: argon2.argon2id, timeCost: 3, memoryCost: 65536, parallelism: 1 };

async function makeHash(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_PARAMS);
}

describe('Auth', () => {
  let app: INestApplication;

  const prismaUser = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const mail = {
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: prismaUser, $connect: vi.fn(), $disconnect: vi.fn() })
      .overrideProvider(MailPort as unknown as new () => unknown)
      .useValue(mail)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new GlobalTestFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaUser.findUnique.mockReset();
    prismaUser.create.mockReset();
    prismaUser.update.mockReset();
    mail.sendEmail.mockClear();
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async function signUp(email: string, password: string) {
    const start = performance.now();
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password });
    const durationMs = performance.now() - start;
    return { res, durationMs };
  }

  async function signIn(email: string, password: string) {
    const start = performance.now();
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password });
    const durationMs = performance.now() - start;
    return { res, durationMs };
  }

  function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  // ─── Sign-up: status and body ─────────────────────────────────────────────

  it('sign-up with a new email returns 200 and the expected body', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'new-1' });

    const { res } = await signUp('fresh@example.com', 'password123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
  });

  it('sign-up with an existing email returns 200 and the expected body', async () => {
    const fakeHash = await makeHash('someOldPassword');
    prismaUser.findUnique.mockResolvedValue({ id: 'existing-1', email: 'taken@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});

    const { res } = await signUp('taken@example.com', 'password123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
  });

  // ─── Sign-up: byte-equality ───────────────────────────────────────────────

  it('sign-up responses are byte-identical between new and existing emails', async () => {
    const fakeHash = await makeHash('someOldPassword');

    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'byte-new' });
    const { res: newRes } = await signUp('byte-new@example.com', 'password123');

    prismaUser.findUnique.mockResolvedValue({ id: 'byte-ex', email: 'byte-ex@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});
    const { res: exRes } = await signUp('byte-ex@example.com', 'password123');

    expect(newRes.status).toBe(exRes.status);
    expect(newRes.text).toBe(exRes.text);
    expect(newRes.headers['content-type']).toBe(exRes.headers['content-type']);
  });

  // ─── Sign-up: timing ──────────────────────────────────────────────────────

  it('sign-up timing is indistinguishable between new and existing emails (N=30)', async () => {
    const fakeHash = await makeHash('timingDummy');
    const N = 30;
    const newTimings: number[] = [];
    const exTimings: number[] = [];

    for (let i = 0; i < N; i++) {
      prismaUser.findUnique.mockResolvedValue(null);
      prismaUser.create.mockResolvedValue({ id: `tn-${i}` });
      const { durationMs: d1 } = await signUp(`tnew-${i}@example.com`, 'password123');
      newTimings.push(d1);

      prismaUser.findUnique.mockResolvedValue({ id: `tex-${i}`, email: `tex-${i}@example.com`, passwordHash: fakeHash });
      prismaUser.update.mockResolvedValue({});
      const { durationMs: d2 } = await signUp(`tex-${i}@example.com`, 'password123');
      exTimings.push(d2);
    }

    const medNew = median(newTimings);
    const medEx = median(exTimings);
    const p95New = percentile([...newTimings].sort((a, b) => a - b), 95);
    const p95Ex = percentile([...exTimings].sort((a, b) => a - b), 95);

    expect(Math.abs(medNew - medEx)).toBeLessThan(10);
    expect(Math.abs(p95New - p95Ex)).toBeLessThan(10);
  });

  // ─── Sign-up: mail side-effects ───────────────────────────────────────────

  it('sign-up sends a verification email for a new address', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({ id: 'mail-new' });

    await signUp('mail-new@example.com', 'password123');

    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail).toHaveBeenCalledWith(
      'mail-new@example.com',
      'verification',
      expect.objectContaining({ email: 'mail-new@example.com' }),
    );
  });

  it('sign-up sends a sign-up-attempt email for an existing address', async () => {
    const fakeHash = await makeHash('existingPw');
    prismaUser.findUnique.mockResolvedValue({ id: 'mail-ex', email: 'mail-ex@example.com', passwordHash: fakeHash });
    prismaUser.update.mockResolvedValue({});

    await signUp('mail-ex@example.com', 'password123');

    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail).toHaveBeenCalledWith(
      'mail-ex@example.com',
      'sign-up-attempt',
      expect.objectContaining({ email: 'mail-ex@example.com' }),
    );
  });

  // ─── Sign-in: success ─────────────────────────────────────────────────────

  it('sign-in with correct credentials returns 200 and a token', async () => {
    const realHash = await makeHash('correctPw1');
    prismaUser.findUnique.mockResolvedValue({ id: 'si-1', email: 'si@example.com', passwordHash: realHash });

    const { res } = await signIn('si@example.com', 'correctPw1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  // ─── Sign-in: failure paths ───────────────────────────────────────────────

  it('sign-in with wrong password returns 401 and the standard envelope', async () => {
    const realHash = await makeHash('correctPw1');
    prismaUser.findUnique.mockResolvedValue({ id: 'si-2', email: 'wp@example.com', passwordHash: realHash });

    const { res } = await signIn('wp@example.com', 'wrongPw123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
    });
  });

  it('sign-in with unknown email returns 401 and the standard envelope', async () => {
    prismaUser.findUnique.mockResolvedValue(null);

    const { res } = await signIn('ghost@example.com', 'whatever123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
    });
  });

  // ─── Sign-in: byte-equality ───────────────────────────────────────────────

  it('sign-in failure responses are byte-identical for wrong-password and unknown-email', async () => {
    const realHash = await makeHash('correctPw1');

    prismaUser.findUnique.mockResolvedValue({ id: 'be-1', email: 'be-wp@example.com', passwordHash: realHash });
    const { res: wpRes } = await signIn('be-wp@example.com', 'wrongPw123');

    prismaUser.findUnique.mockResolvedValue(null);
    const { res: ukRes } = await signIn('be-uk@example.com', 'whatever123');

    expect(wpRes.status).toBe(ukRes.status);
    expect(wpRes.text).toBe(ukRes.text);
    expect(wpRes.headers['content-type']).toBe(ukRes.headers['content-type']);
  });

  // ─── Sign-in: timing ──────────────────────────────────────────────────────

  it('sign-in timing is indistinguishable between wrong-password and unknown-email (N=30)', async () => {
    const realHash = await makeHash('timingPw');
    const N = 30;
    const wpTimings: number[] = [];
    const ukTimings: number[] = [];

    for (let i = 0; i < N; i++) {
      prismaUser.findUnique.mockResolvedValue({ id: `tw-${i}`, email: `tw-${i}@example.com`, passwordHash: realHash });
      const { durationMs: d1 } = await signIn(`tw-${i}@example.com`, 'wrongPw123');
      wpTimings.push(d1);

      prismaUser.findUnique.mockResolvedValue(null);
      const { durationMs: d2 } = await signIn(`tu-${i}@example.com`, 'whatever123');
      ukTimings.push(d2);
    }

    const medWp = median(wpTimings);
    const medUk = median(ukTimings);
    const p95Wp = percentile([...wpTimings].sort((a, b) => a - b), 95);
    const p95Uk = percentile([...ukTimings].sort((a, b) => a - b), 95);

    expect(Math.abs(medWp - medUk)).toBeLessThan(10);
    expect(Math.abs(p95Wp - p95Uk)).toBeLessThan(10);
  });

  // ─── Validation ───────────────────────────────────────────────────────────

  it('sign-up with missing fields returns 400 validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('sign-in with missing fields returns 400 validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  // ─── Password hashing ─────────────────────────────────────────────────────

  it('password is stored as an argon2id hash with a real cost factor', async () => {
    prismaUser.findUnique.mockResolvedValue(null);

    let capturedHash = '';
    prismaUser.create.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => {
      capturedHash = data.passwordHash;
      return { id: 'hash-test' };
    });

    await signUp('hash-check@example.com', 'password123');
