# 10-auth.spec.ts

## reasoning

```
Let me analyze what I need to write for `test/auth.spec.ts` based on the plan and the cases listed in `10-auth.spec.ts-cases.txt`.

From the plan, section 5 lists tests 1-15 (with 7 and 15 being N/A or skipped). The cases file lists 20 specific test cases I need to implement.

Let me go through each case:

1. sign-up with a new email returns 200 with the expected message body
2. sign-up with an existing email returns 200 with the same message body
3. sign-up byte-equality: serialised response identical for new vs existing
4. sign-up timing: N ≥ 30 interleaved samples, median and p95 within threshold
5. sign-up with a new email dispatches "verification" email
6. sign-up with an existing email dispatches "sign-up-attempt" email
7. password is persisted as argon2id hash with timeCost ≥ 3 and memoryCost ≥ 64 MiB
8. sign-in with correct credentials returns 200 and non-empty opaque token
9. sign-in with known email + wrong password returns 401 `invalid_credentials`
10. sign-in with unknown email returns 401 `invalid_credentials`
11. sign-in byte-equality: failure response identical for wrong-password vs unknown-email
12. sign-in timing: N ≥ 30 interleaved samples, median and p95 within threshold
13. sign-up missing email returns 400 `validation_failed`
14. sign-up password shorter than 8 chars returns 400 `validation_failed`
15. sign-in malformed email returns 400 `validation_failed`
16. sign-in missing password returns 400 `validation_failed`
17. concurrent sign-up race: two simultaneous POSTs with same email — at most one row, loser returns 200
18. mail port rejection during new-email sign-up: after sendEmail throws, user row still exists
19. repeated sign-up with same existing email: every call returns 200 and dispatches "sign-up-attempt"
20. sign-in called twice with identical valid credentials produces two distinct token values

Now, how to structure this. The plan says to use Vitest with NestJS testing. I'll use `@nestjs/testing` for integration tests that boot the full module.

For the byte-equality and timing tests, I need to make actual HTTP calls or at least go through the full NestJS pipeline. Using `app.inject()` from `@nestjs/testing` would give me raw HTTP responses I can compare.

Let me think about the setup:
- I need to mock `PrismaService` and `MailPort`
- For timing tests, I need the real argon2 to be running (can't mock it, otherwise the timing test is meaningless)
- For byte-equality tests, I need to go through the full HTTP stack

Wait, but if I mock PrismaService, the DB calls won't actually hit a database. The timing test needs to be meaningful though - it's comparing the two branches (new vs existing). The key timing equalization is in the argon2.verify call which is always executed. So even with a mocked DB, the argon2 timing should be the dominant factor.

Actually, let me reconsider. The plan says "Tests that fail if the property is broken — including a timing test that compares the two branches over multiple samples." The timing test is specifically about whether the code path takes similar time regardless of branch. If I mock the DB, the DB call is nearly instant, and the argon2.verify dominates. So the timing test would still be valid - it tests that the argon2.verify is always called.

For the byte-equality test, I need to compare the actual HTTP response bytes. Using `app.inject()` gives me a `response` object with `status()`, `get(header)`, and `body` (as string or buffer).

Let me think about how to structure the test file:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";

// I need to import the module and set up mocks
```

For the PrismaService mock, I need to provide an object that has `user.findUnique`, `user.create`, and `$executeRaw` methods.

For the MailPort mock, I need an object with `sendEmail` that I can spy on.

Let me think about the concurrent sign-up race test (case 17). The plan says the losing request must still return 200. Looking at the service code:

```typescript
async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.repo.findByEmail(email);
    const hashToCheck = existing !== null ? existing.passwordHash : this.dummyHash;
    await argon2.verify(hashToCheck, password);

    if (existing === null) {
      const realHash = await argon2.hash(password, ARGON2_PARAMS);
      await this.repo.createUser(email, realHash);
      await this.mail.sendEmail(email, "verification", { email });
    } else {
      await this.repo.touchUser(existing.id);
      await this.mail.sendEmail(email, "sign-up-attempt", { email });
    }

    return { message: "Check your email for next steps." };
}
```

If two concurrent requests come in with the same new email, both will find `existing === null`, both will try to `createUser`. One will succeed, the other will get a P2002 unique constraint violation. The current code doesn't handle this - it would propagate the Prisma error as a 500.

But wait - the test case says "the losing request must still return 200 (not a 500 from Prisma P2002 unique-constraint violation), or at minimum the caller cannot distinguish success from the constraint error via timing alone."

Hmm, but looking at the service code, there's no try/catch around `createUser`. So this test would actually fail with the current implementation. But the task says to write the tests that "fail if the property is broken." So I should write the test that expects 200 for both, and it will fail if the implementation doesn't handle the race.

Wait, let me re-read: "Write every one of them." The cases file says these are the decisions I made. So I write the test as specified - expecting 200 for both concurrent requests.

Actually, looking more carefully at the case description: "at most one row is created; the losing request must still return 200 (not a 500 from Prisma P2002 unique-constraint violation), or at minimum the caller cannot distinguish success from the constraint error via timing alone — fails if the unhandled P2002 propagates as a 500 with a different body and timing than the 200 path"

So the test should:
1. Send two concurrent requests with same email
2. Assert both return 200
3. Assert at most one row was created

This test would fail with the current implementation (since P2002 isn't handled), which is the point - it's a test that "fails if the property is broken."

Now let me think about the setup more carefully. I'll use `Test.createTestingModule` with the `AuthModule` and override the providers.

Actually, I realize I need to think about this differently. The `AuthModule` imports `PrismaService` (from `src/prisma/prisma.service`) and uses `MailPort`. I need to override both.

Let me also think about the global exception filter. The plan says `main.ts` sets up a global filter that maps `AuthFailureError → 401` and `ValidationError → 400`. In tests, I need to replicate this setup.

Looking at the plan more carefully:
- `src/main.ts` bootstraps Nest, applies global `ValidationPipe({ whitelist: true })`, global exception filter

For the test, I'll use `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))` and `app.useGlobalFilters(exceptionFilter)`.

But I don't have the exception filter code. I'll need to create it inline or assume it exists. Since the plan says it's in `main.ts`, and I'm only writing `test/auth.spec.ts`, I'll need to replicate the filter setup in the test.

Actually, looking at this more carefully - the plan says the global exception filter is in `main.ts`. For tests, I can either:
1. Import and use the same filter from `main.ts` (but `main.ts` is a bootstrap file, not an exportable filter)
2. Create the filter inline in the test setup

I think the cleanest approach is to define the exception filter inline in the test file, matching what `main.ts` would do. This is standard practice for NestJS testing.

Let me also consider: for the byte-equality tests, I need to compare raw response bodies. Using `app.inject()` returns a supertest-like interface where I can get the raw body as a string or buffer.

Let me now write the test file:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe, UseFilters, ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService, AuthFailureError, MailPort } from "../src/auth/auth.service";
import { AuthRepository } from "../src/auth/auth.repository";
import * as argon2 from "argon2";

// I need a mock for PrismaService
```

Wait, I need to think about what `PrismaService` looks like. The plan references it as being at `src/prisma/prisma.service`. The repository imports it from `"../prisma/prisma.service"`. I don't have the actual file, but I know it extends or wraps `PrismaClient` from `@prisma/client`.

For the test, I'll mock it with a token-based provider override. The key is that I need to know the injection token. Since `AuthRepository` does `constructor(private readonly prisma: PrismaService)`, the token is `PrismaService` (the class itself).

Let me structure the test:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe, ExceptionFilter, Catch, ArgumentsHost } from "@nestjs/common";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService, AuthFailureError, MailPort } from "../src/auth/auth.service";
import { AuthRepository } from "../src/auth/auth.repository";

// Mock PrismaService - I need to know the import path
// ASSUMPTION: PrismaService is at src/prisma/prisma.service and is a class that extends PrismaClient
import { PrismaService } from "../src/prisma/prisma.service";

// ... setup
```

Hmm, but I don't have the PrismaService file. Let me use a different approach - I'll override the provider by its token (the class reference). Since the repository uses `PrismaService` as a type, I need to import it.

Actually, for the mock, I can just provide a value that has the right shape without importing the actual class. I'll use `useValue` with an object that has `user.findUnique`, `user.create`, and `$executeRaw`.

But the injection token needs to match. If `AuthRepository` constructor has `private readonly prisma: PrismaService`, then the DI token is `PrismaService` (the class). I need to import it to use as a token.

Let me just import it and provide a mock value. If the file doesn't exist in the workspace (it's referenced but not shown), I'll note it as an assumption.

Actually wait - looking at the repository file:
```typescript
import { PrismaService } from "../prisma/prisma.service";
```

So it's at `src/prisma/prisma.service.ts`. I'll import from there in the test.

Now let me think about the full structure:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe, ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from "@nestjs/common";
import { AuthModule } from "../src/auth/auth.module";
import { AuthFailureError, MailPort } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import * as argon2 from "argon2";

// Exception filter that matches main.ts behavior
class GlobalExceptionFilter implements ExceptionFilter { ... }

// Mock prisma
const mockPrisma = { ... };

describe("Auth", () => {
  let app: INestApplication;
  let mailSendEmail: ReturnType<typeof vi.fn>;
  
  // For each test group, I may need to reset state
  
  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(MailPort)
      .useValue({ sendEmail: mailSendEmail })
      .compile();
    
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  // ... tests
});
```

Wait, but `MailPort` is an interface, not a class. How is it provided in the module? Looking at the plan:

```
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

So `MailPort` is listed as a provider. But it's an interface... This means there must be a token or a class used as the provider. In NestJS, you can't use an interface directly as a provider (interfaces don't exist at runtime). 

Looking more carefully, the plan says `MailPort /* token provider */`. This suggests that either:
1. There's a string/enum token used to identify it
2. Or `MailPort` is actually a class (not an interface)

But in the service code shown, `MailPort` is defined as:
```typescript
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

It's an interface. So it can't be used directly as a provider token in NestJS. There must be something else going on.

Looking at the service constructor:
```typescript
constructor(
  private readonly repo: AuthRepository,
  private readonly mail: MailPort,
) {}
```

For this to work with DI, `MailPort` needs to be a token. Since it's an interface, the module must use something like `useFactory` or a custom token. But the plan just says `MailPort /* token provider */` in the providers array.

I think the most defensible reading is that `MailPort` is used as a string-based injection token, or there's a class that implements it. Since I can't resolve this definitively, I'll use `MailPort` as the token in my test override. If it's an interface used as a token, that won't work at runtime...

Actually, wait. Let me re-read the plan. It says:
```
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

In NestJS, if you list an interface in providers, it will fail at runtime because interfaces are erased. So either:
1. The plan is slightly wrong and there's actually a class or token
2. Or `MailPort` is used as a `useClass`/`useValue` provider somewhere

I think the most defensible approach for the test is to use `MailPort` as the injection token (assuming it's been set up to work - perhaps via `@Inject(MailPort)` decorator, though the service code doesn't show that). 

Actually, looking at the service code again:
```typescript
constructor(
  private readonly repo: AuthRepository,
  private readonly mail: MailPort,
) {}
```

There's no `@Inject()` decorator. In NestJS, without `@Inject()`, the token is the type itself. For a class, that's the class reference. For an interface... it would be `undefined` at runtime since interfaces are erased.

This is a problem. The code as shown wouldn't work with DI unless `MailPort` is actually a class or there's an `@Inject()` decorator.

I'll mark this as an assumption and use a string token or just override by the interface name. Actually, the most practical approach for testing is:

Since I'm overriding providers in the test module, I can use `overrideProvider(MailPort)` - but if `MailPort` is an interface (erased at runtime), this won't work.

Let me take a different approach. I'll assume that in the actual implementation, `MailPort` is either:
- A class (not interface) - most likely given it's listed in providers
- Or there's a token like `const MAIL_PORT = 'MAIL_PORT'`

For the test, I'll use a pragmatic approach: I'll mock at the `AuthService` level or provide the mail mock in a way that works regardless.

Actually, you know what, let me just look at this from the test's perspective. I need to:
1. Boot the app with mocked Prisma and Mail
2. Make HTTP requests
3. Assert on responses

The cleanest way to mock the mail is to override whatever provider provides it. Since I don't know the exact token, I'll use `MailPort` as the token (assuming it works in the implementation). If it's an interface, the implementation would need to have made it work somehow.

Let me just go with it and add an assumption comment if needed.

Actually, I just realized - for the timing tests to be meaningful, I should NOT mock argon2. The real argon2.verify needs to run so that the timing equalization is actually tested. The mocked DB will be instant, but the argon2 calls (which take ~50-100ms at t=3, m=64MiB) will dominate.

Let me also think about the byte-equality test more carefully. I need to:
1. Make a request with a new email → get response A
2. Make a request with the same email (now existing) → get response B
3. Compare status, headers, and body bytes

Using `app.inject()`:
```typescript
const resA = await app.inject().post("/auth/sign-up").send({ email, password }).expect(200);
const resB = await app.inject().post("/auth/sign-up").send({ email, password }).expect(200);

expect(resA.status).toBe(resB.status);
expect(resA.get("content-type")).toBe(resB.get("content-type"));
expect(resA.body).toBe(resB.body); // or compare as strings/buffers
```

Wait, `app.inject()` returns a supertest-like agent. The `.body` property is the parsed JSON body. For byte comparison, I should compare `resA.text` (raw string) or use `.buffer(true)` to get the raw buffer.

Actually, in NestJS testing with `@nestjs/testing`, `app.inject()` returns a `SupertestAgent`. The response has:
- `.status` - HTTP status code
- `.headers` - object of headers
- `.body` - parsed body (JSON)
- `.text` - raw text of the body
- `.buffer` - raw buffer (if you use `.buffer(true)`)

For byte-equality, I'll compare `.text` (which is the raw response body as a string) and the relevant headers.

Now let me think about the timing test. I need to:
1. Collect N samples for branch A (new email)
2. Collect N samples for branch B (existing email)
3. Interleave them (to account for system load changes)
4. Compare median and p95

For the timing, I'll use `performance.now()` or `Date.now()`. Since we're in Node.js with Vitest, I can use `process.hrtime.bigint()` for high resolution.

The threshold: the plan says "within a tight threshold." Given argon2 at t=3, m=64MiB takes roughly 50-150ms, and the DB calls (mocked) are ~0ms, the dominant factor is argon2. The difference between branches should be minimal (just the overhead of the different DB operations, which are mocked). I'll use a threshold of, say, 20ms difference in median.

Actually, for the timing test to be meaningful with mocked DB, I should think about what could cause a timing difference:
- If the dummy hash verify is skipped → the "new email" branch would be ~100ms faster
- If touchUser is missing → minor difference (mocked, so ~0)

The main thing being tested is that argon2.verify is always called. With mocked DB, the threshold can be tight (like 10-20ms).

Let me set N=30 as specified, and use a threshold of 20ms for the median difference.

Now, for the interleaving: I'll alternate between the two branches:
```typescript
const timesA: number[] = [];
const timesB: number[] = [];
for (let i = 0; i < N; i++) {
  // Branch A: new email
  const t0 = performance.now();
  await app.inject().post("/auth/sign-up").send({ email: `new-${i}-${Date.now()}@test.com`, password: "password123" });
  timesA.push(performance.now() - t0);
  
  // Branch B: existing email (use a pre-created one)
  const t1 = performance.now();
  await app.inject().post("/auth/sign-up").send({ email: existingEmail, password: "password123" });
  timesB.push(performance.now() - t1);
}
```

Wait, for branch B (existing email), I need an email that already exists in the mock DB. I'll set up the mock to have one pre-existing user.

Let me now think about the mock Prisma more carefully:

```typescript
let users: Map<string, { id: string; email: string; passwordHash: string; createdAt: Date }> = new Map();

const mockPrisma = {
  user: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const user = users.get(where.email);
      if (!user) return null;
      return { id: user.id, email: user.email, passwordHash: user.passwordHash };
    }),
    create: vi.fn(async ({ data, select }: any) => {
      const id = crypto.randomUUID();
      users.set(data.email, { id, email: data.email, passwordHash: data.passwordHash, createdAt: new Date() });
      return { id };
    }),
  },
  $executeRaw: vi.fn(async () => { return 1; }),
};
```

This gives me a simple in-memory "database" that I can inspect in tests (e.g., to check the password hash format).

For the concurrent race test, I need to simulate the unique constraint violation. My mock `create` would need to throw if the email already exists:

```typescript
create: vi.fn(async ({ data, select }: any) => {
  if (users.has(data.email)) {
    throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  }
  const id = crypto.randomUUID();
  users.set(data.email, { ... });
  return { id };
}),
```

But wait - for the race condition test, both requests would first call `findUnique` (getting null), then both call `create`. The first one succeeds, the second one hits the constraint. In reality with a real DB, this is a race condition. With my mock (which is synchronous within the async function), both would see the same state unless I introduce actual concurrency.

To properly test this, I need to make the mock's `create` actually have a race condition. I can do this by making `findUnique` return null for both (since the user doesn't exist yet), and then having `create` check and throw on duplicate.

Actually, with `Promise.all([req1, req2])`, both requests will:
1. Call `findUnique` → both get null (user doesn't exist yet)
2. Call `argon2.verify` (dummy) → both complete
3. Call `argon2.hash` → both complete
4. Call `create` → first one succeeds, second one... 

In my mock, if I use a simple `Map`, the first `create` adds to the map, and the second `create` would see it's already there and throw. But the timing of when they reach `create` depends on the async scheduling.

Actually, since `argon2.hash` is truly async (takes ~100ms), both requests will be in-flight simultaneously. They'll both call `findUnique` first (both get null), then both call `argon2.verify` and `argon2.hash` (taking ~100ms each), then both call `create`. At that point, the first one to reach `create` will succeed, and the second will find the email already in the map.

So my mock needs to throw on duplicate:
```typescript
create: vi.fn(async ({ data }: any) => {
  if (users.has(data.email)) {
    const err: any = new Error("Unique constraint failed on the table: users");
    err.code = "P2002";
    throw err;
  }
  const id = crypto.randomUUID();
  users.set(data.email, { id, email: data.email, passwordHash: data.passwordHash, createdAt: new Date() });
  return { id };
}),
```

And the test expects both to return 200. With the current service code (no try/catch around createUser), the second one would throw a 500. So this test would FAIL, which is the intended behavior (the test "fails if the property is broken").

Now let me think about the mail port rejection test (case 18):
- Mock `sendEmail` to throw
- Call sign-up with a new email
- Assert the user row exists in the mock DB (because the code does `createUser` before `sendEmail`)

Looking at the service:
```typescript
if (existing === null) {
  const realHash = await argon2.hash(password, ARGON2_PARAMS);
  await this.repo.createUser(email, realHash);  // ← creates first
  await this.mail.sendEmail(email, "verification", { email });  // ← then mails
}
```

So if `sendEmail` throws, the user is already created. The error would propagate up as a 500 (since there's no try/catch). But the test case says "after sendEmail throws, the user row still exists in the database." So I need to:
1. Make sendEmail throw
2. Call sign-up
3. Catch the error (expect 500)
4. Check that the user exists in the mock DB

Let me now write the complete test file. I'll organize it into `describe` blocks for clarity.

One more consideration: the `ValidationPipe`. When I use `new ValidationPipe({ whitelist: true })`, it will strip unknown properties and validate. The error format from `ValidationPipe` is a `BadRequestException` with a message like "email must be an email". I need my exception filter to convert this to the standard envelope format.

My global exception filter needs to handle:
- `AuthFailureError` → 401 `{ error: { code: "invalid_credentials", message: "Invalid credentials.", details: {} } }`
- `BadRequestException` (from ValidationPipe) → 400 `{ error: { code: "validation_failed", message: "...", details: {} } }`
- Any other exception → 500 with some envelope

Let me write the filter:

```typescript
@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    
    if (exception instanceof AuthFailureError) {
      response.status(401).json({
        error: { code: "invalid_credentials", message: exception.message, details: {} },
      });
      return;
    }
    
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 400) {
        response.status(400).json({
          error: { code: "validation_failed", message: exception.message, details: {} },
        });
        return;
      }
    }
    
    // Fallback 500
    response.status(500).json({
      error: { code: "internal_error", message: "An internal error occurred.", details: {} },
    });
  }
}
```

Now let me put it all together. Let me also think about imports:
- `@nestjs/testing` for Test, TestingModule
- `@nestjs/common` for INestApplication, ValidationPipe, etc.
- The app module or auth module
- argon2 (for verifying hash format in test 7)
- `node:crypto` for randomUUID (in mock)

Wait, for test 7 (password is persisted as argon2id hash), I need to inspect the stored hash. My mock stores it in the `users` map, so I can access it directly. The hash string from argon2 looks like:
`$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>`

I can parse this to verify the parameters.

Let me also think about the token test (case 20): sign-in called twice with valid credentials should produce two different tokens. The service uses `randomBytes(32).toString("hex")` which is non-deterministic, so two calls will produce different tokens. I just need to assert they're different and both are 64-char hex strings.

OK, I think I have enough to write the complete file. Let me do it now.

One more thing: for the timing tests, I should use `performance.now()` which is available globally in Node.js 20+. Actually, let me use `Date.now()` for simplicity, or better yet, `process.hrtime.bigint()` converted to ms for high resolution.

Actually, `performance.now()` is available in Node.js and gives sub-millisecond precision. I'll use that.

Let me also consider: should I reset the mock state between tests? Yes, I should clear the `users` map and reset the mock call counts before each test (or at least before tests that need a clean state).

Let me use `beforeEach` to reset state.

Actually, for the timing tests, I want a stable state. Let me think about test ordering:
- Some tests need a fresh DB (new email tests)
- Some tests need an existing user (existing email tests)
- The timing test needs both a new email and an existing email available

I'll use `beforeEach` to reset the users map to a known state (e.g., one pre-existing user for "existing" branch tests), and individual tests can add more as needed.

Let me finalize my approach:

```typescript
// State
let users: Map<string, UserRecord>;
const EXISTING_EMAIL = "existing@test.com";
const EXISTING_PASSWORD_HASH = ...; // pre-generated argon2 hash

beforeEach(() => {
  users.clear();
  // Pre-populate with one existing user for the "existing" branch tests
  users.set(EXISTING_EMAIL, { id: "fixed-id", email: EXISTING_EMAIL, passwordHash: EXISTING_PASSWORD_HASH, createdAt: new Date() });
  mockPrisma.user.findUnique.mockClear();
  mockPrisma.user.create.mockClear();
  mockPrisma.$executeRaw.mockClear();
  mailSendEmail.mockClear();
});
```

Wait, but for the sign-in timing test, I need:
- Branch A: known email + wrong password
- Branch B: unknown email

Both should take similar time. The "known email" branch does `findByEmail` → finds user → `argon2.verify(realHash, wrongPassword)` → fails. The "unknown email" branch does `findByEmail` → null → `argon2.verify(dummyHash, password)` → fails.

Both execute one argon2.verify with the same parameters, so timing should be equal. Good.

For the sign-up timing test:
- Branch A: new email → `findByEmail` → null → `argon2.verify(dummyHash, password)` → `argon2.hash(password)` → `createUser` → `sendEmail`
- Branch B: existing email → `findByEmail` → user → `argon2.verify(realHash, password)` → `touchUser` → `sendEmail`

Both execute one argon2.verify AND branch A also does an argon2.hash. Wait, that's a problem! Branch A has TWO argon2 operations (verify + hash) while branch B only has ONE (verify). That means branch A will be ~100ms slower than branch B!

Let me re-read the service code:
```typescript
async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.repo.findByEmail(email);
    const hashToCheck = existing !== null ? existing.passwordHash : this.dummyHash;
    await argon2.verify(hashToCheck, password); // result intentionally discarded

    if (existing === null) {
      const realHash = await argon2.hash(password, ARGON2_PARAMS);  // ← extra argon2 call!
      await this.repo.createUser(email, realHash);
      await this.mail.sendEmail(email, "verification", { email });
    } else {
      await this.repo.touchUser(existing.id);
      await this.mail.sendEmail(email, "sign-up-attempt", { email });
    }

    return { message: "Check your email for next steps." };
}
```

Yes! Branch A (new email) does: verify + hash = 2 argon2 operations
Branch B (existing email) does: verify = 1 argon2 operation

This means branch A will be roughly 2x slower than branch B. The timing test WOULD FAIL with this implementation!

But wait - the plan explicitly specifies this implementation in section 4. And the test case says "fails if the dummy-hash verify is skipped, the no-op touchUser write is absent, or the branch order allows one path to skip a DB round-trip." It doesn't mention the extra hash call as a failure condition.

Hmm, but if the test measures timing and branch A is 2x slower, it would fail. Unless the threshold is set generously enough to accommodate the extra hash time...

Actually wait, let me re-read the plan's ordering rule:
"Within signUp, the email existence check (findByEmail) must precede the argon2 verify. The verify must precede any DB write (INSERT or touch). This ordering ensures the expensive hash step is always executed before any branch-divergent I/O, so the dominant cost is identical regardless of branch."

The plan says "the dominant cost is identical" - but that's only true for sign-in, not sign-up. For sign-up, branch A has an additional `argon2.hash` call.

This seems like a bug in the plan/implementation. But my job is to write the test as specified. The test case says:
"sign-up timing: over N ≥ 30 interleaved samples per branch, the median and p95 latencies fall within a tight threshold of each other — fails if the dummy-hash verify is skipped, the no-op touchUser write is absent, or the branch order allows one path to skip a DB round-trip"

So the test should have a threshold. If the implementation has this bug (extra hash in one branch), the test would fail, which is correct - it "fails if the property is broken."

But what threshold to use? If I use 20ms, it'll fail because of the extra hash (~100ms difference). If I use 200ms, it might pass even with the bug.

I think the intent is that the test SHOULD catch this difference. So I'll use a tight threshold (like 20-30ms) that would catch the extra argon2 call. The test is designed to fail if the timing property is broken, and this IS a broken timing property.

Actually, wait. Let me reconsider. Maybe the plan intends for the `argon2.hash` in the new-email branch to be "acceptable" because it's a necessary operation (you need to hash the password to store it). The timing equalization is about not letting an attacker distinguish "new" from "existing" - and the extra ~100ms in the new branch IS a timing leak.

So the test should be tight enough to catch it. I'll use 30ms as the threshold for median difference. This will fail with the current implementation (which has ~100ms difference due to the extra hash), correctly identifying the timing leak.

Hmm, but that means the test as written will always fail with the given implementation. Is that OK? The task says "Tests that fail if the property is broken." If the property IS broken in this implementation, then yes, the test should fail.

But wait - maybe I'm overthinking this. Let me re-read the requirement: "An observer who can send requests and measure how long they take must not be able to tell the branches apart."

With the current implementation, an observer CAN tell them apart (new email takes ~200ms, existing takes ~100ms). So the property IS broken, and the test SHOULD fail.

OK so I'll write the test with a reasonable threshold (30ms) that would pass if the timing were properly equalized but fail with the current implementation. This is the correct behavior for a test that "fails if the property is broken."

Actually, I want to be more careful. Let me think about what a "correct" implementation would look like for sign-up timing equalization:

Option 1: Always do verify + hash (2 argon2 ops in both branches)
- New: verify(dummy) → hash(password) → store hash → mail
- Existing: verify(real) → hash(dummy_password or the submitted password) → discard → touchUser → mail

Option 2: Always do only verify (1 argon2 op), and hash the password outside the timing-critical path
- This is harder because you need the hash to store it

Option 3: Use a different approach entirely

The plan chose Option "verify always, and hash only in the new branch" which doesn't fully equalize. The test will catch this.

For my test, I'll use a threshold of 30ms. With argon2 at t=3, m=64MiB:
- One verify ≈ 50-150ms (let's say ~100ms average)
- The difference between 1 verify and 2 verifies ≈ 100ms
- 30ms threshold will catch this

For the sign-in timing test, both branches do exactly one verify, so they should be within a few ms of each other. 30ms threshold is fine.

Let me now write the final test file. I'll be thorough and cover all 20 cases.

Actually, one more thought: for the byte-equality tests, I should compare the raw response. In NestJS with `app.inject()`, the response is a `SuperTestResponse`. I can access:
- `res.status` - number
- `res.headers` - Record<string, string | string[] | undefined>
- `res.text` - string (raw body)
- `res.body` - parsed object

For byte comparison, I'll compare `res.status`, `res.headers["content-type"]`, and `res.text`.

Let me also make sure I handle the `Content-Length` header - it should be the same if the body is the same. But I won't assert on it specifically since it's derived from the body.

OK, let me write the file now. I'll be comprehensive.

One more consideration: the `performance.now()` function. In Node.js 20+, it's available as a global. In Vitest, it should also be available. I'll use it.

Let me also think about the structure. I'll have:
- Top-level `describe("Auth")` 
  - `beforeAll` to set up the app
  - `afterAll` to close the app
  - `beforeEach` to reset mock state
  - Individual test cases (or grouped into sub-describes)

I'll group them as:
- `describe("POST /auth/sign-up")` for sign-up tests
- `describe("POST /auth/sign-in")` for sign-in tests
- `describe("validation")` for validation tests (could also be in the above groups)

Actually, let me just use flat `it` blocks within one `describe` for simplicity, since the cases are already well-named.

Let me write it now.
```

## reply

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";

import { AuthModule } from "../src/auth/auth.module";
import { AuthFailureError, MailPort } from "../src/auth/auth.service";
// ASSUMPTION: PrismaService is a class at src/prisma/prisma.service that extends PrismaClient; used here only as an injection token for the override
import { PrismaService } from "../src/prisma/prisma.service";

// ─── Global exception filter (mirrors main.ts) ───────────────────────────────

@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof AuthFailureError) {
      response.status(401).json({
        error: {
          code: "invalid_credentials",
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 400) {
        response.status(400).json({
          error: {
            code: "validation_failed",
            message: exception.message,
            details: {},
          },
        });
        return;
      }
    }

    response.status(500).json({
      error: {
        code: "internal_error",
        message: "An internal error occurred.",
        details: {},
      },
    });
  }
}

// ─── Mock in-memory store & Prisma mock ──────────────────────────────────────

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

const users = new Map<string, UserRecord>();

const mockPrisma = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
      const user = users.get(where.email);
      if (!user) return null;
      return { id: user.id, email: user.email, passwordHash: user.passwordHash };
    }),
    create: vi.fn(async ({ data }: { data: { email: string; passwordHash: string } }) => {
      if (users.has(data.email)) {
        const err: any = new Error(
          `Unique constraint failed on the table: \`users\` (index: \`users_email_key\`)`,
        );
        err.code = "P2002";
        throw err;
      }
      const id = randomUUID();
      users.set(data.email, { id, email: data.email, passwordHash: data.passwordHash });
      return { id };
    }),
  },
  $executeRaw: vi.fn(async () => 1),
};

const mailSendEmail = vi.fn(async (_to: string, _template: string, _vars: Record<string, string>) => {});

// ─── Pre-existing user for "existing" branch tests ───────────────────────────

const EXISTING_EMAIL = "existing@example.com";
// Generated at test-file load time so the hash is ready before any test runs.
const EXISTING_HASH = argon2.hash("correct-horse-battery-staple", {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
}) as Promise<string>;

let existingHashValue: string;

// ─── Test helpers ────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("Auth", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    existingHashValue = await EXISTING_HASH;

    moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(MailPort as any)
      .useValue({ sendEmail: mailSendEmail })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    users.clear();
    users.set(EXISTING_EMAIL, {
      id: "00000000-0000-0000-0000-000000000001",
      email: EXISTING_EMAIL,
      passwordHash: existingHashValue,
    });
    mockPrisma.user.findUnique.mockClear();
    mockPrisma.user.create.mockClear();
    mockPrisma.$executeRaw.mockClear();
    mailSendEmail.mockClear();
  });

  // ── Sign-up: functional correctness ───────────────────────────────────────

  it("sign-up with a new email returns 200 with the expected message body", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: "new-user@example.com", password: "password123" })
      .expect(200);

    expect(res.body).toEqual({ message: "Check your email for next steps." });
  });

  it("sign-up with an existing email returns 200 with the same message body", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: EXISTING_EMAIL, password: "password123" })
      .expect(200);

    expect(res.body).toEqual({ message: "Check your email for next steps." });
  });

  // ── Sign-up: byte-equality ────────────────────────────────────────────────

  it("sign-up byte-equality: serialised response is identical for new and existing addresses", async () => {
    const newEmail = "byte-eq-new@example.com";

    const resA = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: newEmail, password: "password123" })
      .expect(200);

    const resB = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: newEmail, password: "password123" })
      .expect(200);

    expect(resA.status).toBe(resB.status);
    expect(resA.get("content-type")).toBe(resB.get("content-type"));
    expect(resA.text).toBe(resB.text);
  });

  // ── Sign-up: timing ───────────────────────────────────────────────────────

  it("sign-up timing: median and p95 of new-email vs existing-email branches are within 30 ms", async () => {
    const N = 30;
    const timesNew: number[] = [];
    const timesExisting: number[] = [];
    const prefix = `timing-${Date.now()}`;

    for (let i = 0; i < N; i++) {
      // Branch A – new email
      const emailA = `${prefix}-a-${i}@example.com`;
      let t0 = performance.now();
      await app.inject().post("/auth/sign-up").send({ email: emailA, password: "password123" });
      timesNew.push(performance.now() - t0);

      // Branch B – existing email
      let t1 = performance.now();
      await app.inject().post("/auth/sign-up").send({ email: EXISTING_EMAIL, password: "password123" });
      timesExisting.push(performance.now() - t1);
    }

    const medNew = median(timesNew);
    const medExisting = median(timesExisting);
    const p95New = percentile(timesNew, 95);
    const p95Existing = percentile(timesExisting, 95);

    expect(Math.abs(medNew - medExisting)).toBeLessThan(30);
    expect(Math.abs(p95New - p95Existing)).toBeLessThan(30);
  });

  // ── Sign-up: mail dispatch ────────────────────────────────────────────────

  it("sign-up with a new email dispatches a verification email to that address", async () => {
    const email = "mail-new@example.com";

    await app
      .inject()
      .post("/auth/sign-up")
      .send({ email, password: "password123" })
      .expect(200);

    expect(mailSendEmail).toHaveBeenCalledTimes(1);
    expect(mailSendEmail).toHaveBeenCalledWith(email, "verification", { email });
  });

  it("sign-up with an existing email dispatches a sign-up-attempt email to that address", async () => {
    await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: EXISTING_EMAIL, password: "password123" })
      .expect(200);

    expect(mailSendEmail).toHaveBeenCalledTimes(1);
    expect(mailSendEmail).toHaveBeenCalledWith(EXISTING_EMAIL, "sign-up-attempt", { email: EXISTING_EMAIL });
  });

  // ── Sign-up: password storage ─────────────────────────────────────────────

  it("password is persisted as an argon2id hash with timeCost ≥ 3 and memoryCost ≥ 64 MiB", async () => {
    const email = "hash-check@example.com";

    await app
      .inject()
      .post("/auth/sign-up")
      .send({ email, password: "password123" })
      .expect(200);

    const stored = users.get(email)!;
    expect(stored).toBeDefined();

    // argon2 hash format: $argon2id$v=19$m=<mem>,t=<time>,p=<par>$<salt>$<hash>
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);

    const m = stored.passwordHash.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/)!;
    const memoryCost = parseInt(m[1], 10);
    const timeCost = parseInt(m[2], 10);

    expect(timeCost).toBeGreaterThanOrEqual(3);
    expect(memoryCost).toBeGreaterThanOrEqual(65536); // 64 MiB in KiB
  });

  // ── Sign-in: functional correctness ───────────────────────────────────────

  it("sign-in with correct credentials returns 200 and a non-empty opaque token", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: EXISTING_EMAIL, password: "correct-horse-battery-staple" })
      .expect(200);

    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.token.length).toBe(64); // 32 bytes → 64 hex chars
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sign-in with a known email and wrong password returns 401 invalid_credentials", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: EXISTING_EMAIL, password: "wrong-password-here" })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: "invalid_credentials", message: "Invalid credentials.", details: {} },
    });
  });

  it("sign-in with an unknown email returns 401 invalid_credentials", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: "ghost@example.com", password: "whatever1234" })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: "invalid_credentials", message: "Invalid credentials.", details: {} },
    });
  });

  // ── Sign-in: byte-equality ────────────────────────────────────────────────

  it("sign-in byte-equality: failure response is identical for wrong-password and unknown-email", async () => {
    const resWrongPw = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: EXISTING_EMAIL, password: "wrong-password-here" })
      .expect(401);

    const resUnknownEmail = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: "nobody@example.com", password: "wrong-password-here" })
      .expect(401);

    expect(resWrongPw.status).toBe(resUnknownEmail.status);
    expect(resWrongPw.get("content-type")).toBe(resUnknownEmail.get("content-type"));
    expect(resWrongPw.text).toBe(resUnknownEmail.text);
  });

  // ── Sign-in: timing ───────────────────────────────────────────────────────

  it("sign-in timing: median and p95 of wrong-password vs unknown-email failure branches are within 30 ms", async () => {
    const N = 30;
    const timesWrongPw: number[] = [];
    const timesUnknownEmail: number[] = [];

    for (let i = 0; i < N; i++) {
      // Branch A – known email, wrong password
      let t0 = performance.now();
      await app
        .inject()
        .post("/auth/sign-in")
        .send({ email: EXISTING_EMAIL, password: `wrong-${i}-password` })
        .expect(401);
      timesWrongPw.push(performance.now() - t0);

      // Branch B – unknown email
      let t1 = performance.now();
      await app
        .inject()
        .post("/auth/sign-in")
        .send({ email: `ghost-${i}-${Date.now()}@example.com`, password: `wrong-${i}-password` })
        .expect(401);
      timesUnknownEmail.push(performance.now() - t1);
    }

    const medWrongPw = median(timesWrongPw);
    const medUnknownEmail = median(timesUnknownEmail);
    const p95WrongPw = percentile(timesWrongPw, 95);
    const p95UnknownEmail = percentile(timesUnknownEmail, 95);

    expect(Math.abs(medWrongPw - medUnknownEmail)).toBeLessThan(30);
    expect(Math.abs(p95WrongPw - p95UnknownEmail)).toBeLessThan(30);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("sign-up missing email returns 400 validation_failed", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-up")
      .send({ password: "password123" })
      .expect(400);

    expect(res.body.error.code).toBe("validation_failed");
  });

  it("sign-up password shorter than 8 characters returns 400 validation_failed", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email: "short-pw@example.com", password: "1234567" })
      .expect(400);

    expect(res.body.error.code).toBe("validation_failed");
  });

  it("sign-in malformed email returns 400 validation_failed", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: "not-an-email", password: "password123" })
      .expect(400);

    expect(res.body.error.code).toBe("validation_failed");
  });

  it("sign-in missing password returns 400 validation_failed", async () => {
    const res = await app
      .inject()
      .post("/auth/sign-in")
      .send({ email: EXISTING_EMAIL })
      .expect(400);

    expect(res.body.error.code).toBe("validation_failed");
  });

  // ── Concurrent sign-up race ───────────────────────────────────────────────

  it("concurrent sign-up race: two simultaneous POSTs with the same new email – both return 200 and at most one row is created", async () => {
    const email = `race-${Date.now()}@example.com`;
    const body = { email, password: "password123" };

    const [resA, resB] = await Promise.all([
      app.inject().post("/auth/sign-up").send(body),
      app.inject().post("/auth/sign-up").send(body),
    ]);

    // Both callers must observe 200 (indistinguishable from a single successful sign-up)
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    // At most one row
    const matching = [...users.values()].filter((u) => u.email === email);
    expect(matching.length).toBeLessThanOrEqual(1);
  });

  // ── Mail port rejection ───────────────────────────────────────────────────

  it("mail port rejection during new-email sign-up: user row still exists after sendEmail throws", async () => {
    const email = "mail-fail@example.com";

    // Make the mail port throw
    mailSendEmail.mockRejectedValueOnce(new Error("SMTP connection refused"));

    // The service will propagate the error → 500
    const res = await app
      .inject()
      .post("/auth/sign-up")
      .send({ email, password: "password123" });

    // The user row must still exist (createUser was called before sendEmail)
    expect(users.has(email)).toBe(true);
  });

  // ── Repeated sign-up with existing email ──────────────────────────────────

  it("repeated sign-up with the same existing email: every call returns 200 and dispatches sign-up-attempt", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app
        .inject()
        .post("/auth/sign-up")
        .send({ email: EXISTING_EMAIL, password: "password123" })
        .expect(200);

      expect(res.body).toEqual({ message: "Check your email for next steps." });
    }

    // Each call dispatched the sign-up-attempt template
    expect(mailSendEmail).toHaveBeenCalledTimes(3);
    for (const call of mailSendEmail.mock.calls) {
      expect(call[0]).toBe(EXISTING_EMAIL);
      expect(call[1]).toBe("sign-up-attempt");
    }
  });

  // ── Token uniqueness ──────────────────────────────────────────────────────

  it("sign-in called twice with identical valid credentials produces two distinct token values", async () => {
    const body = { email: EXISTING_EMAIL, password: "correct-horse-battery-staple" };

    const res1 = await app.inject().post("/auth/sign-in").send(body).expect(200);
    const res2 = await app.inject().post("/auth/sign-in").send(body).expect(200);

    expect(res1.body.token).toBeTypeOf("string");
    expect(res2.body.token).toBeTypeOf("string");
    expect(res1.body.token).not.toBe(res2.body.token);
  });
});
```
