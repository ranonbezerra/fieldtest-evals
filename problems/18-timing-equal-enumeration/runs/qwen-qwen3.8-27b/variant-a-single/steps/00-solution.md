# solution

## reasoning

```
Let me carefully consider this task.

What the task is asking for:
1. `POST /auth/sign-up` — `{ email, password }`. A new address creates an account. An existing address must produce the same response (status, body, headers).
2. `POST /auth/sign-in` — `{ email, password }`. Wrong password and unknown address must produce the same response.
3. Passwords are hashed with argon2id or bcrypt at a real cost factor.
4. Timing attack countermeasures: observers must not be able to distinguish branches by timing.
5. Email: existing address gets "someone tried to sign up" email, new ones get a verification email. The response must be identical.

Deliverables:
- Prisma schema + migrations
- NestJS module: controller, service, repository
- Tests that fail if the property is broken — including timing tests comparing multiple samples, and byte comparisons of the two responses
- `SECURITY.md` (15–25 lines): mechanism, why chosen over alternatives, what it doesn't protect against.

Assume a mail port `sendEmail(to, template, vars): Promise<void>` exists.

Let me think about the design.

**Core mechanism**: to make sign-up timing-equivalent for existing vs. new email, the standard approach is:

- Normalize the email (lowercase/trim).
- Look up the user.
- Whether or not the user exists, do a full password hash computation (argon2id with the same cost). If the user exists, verify the provided password against the stored hash. If it doesn't exist, verify against a precomputed dummy hash (a "ghost" hash of a random password). This ensures constant time computation regardless of branch.
- For a new user: create the account (DB insert), send verification email.
- For an existing user: send "someone tried to sign up" email (but must not fail the response if email sending fails — or, the email send failure must not affect the response; also, timing variance from email sending is an issue).
- Return identical response in both cases: e.g., 202 Accepted with a fixed body like `{ "message": "If the address could be registered, a verification email has been sent" }`.

Wait, subtle point: if we create the account on sign-up and email is async… actually, the requirement says "new addresses create an account". So sign-up immediately creates an account (probably with a verified flag), and sends a verification email. Existing address → sends "someone tried to sign up" email.

**Timing**: main timing differences:
1. Password hash cost — must be constant: always hash/verify once with the same parameters.
2. DB insert vs. not — insert has a small time difference. Mitigation: equalize the time. Options:
   - Do a dummy work on the "existing" branch to match the insert time. But timing is variable; better to equalize via a minimum response time (padded sleep until a fixed minimum elapsed time) — this works but is coarse.
   - Alternatively: always do the same number of DB operations. E.g., always do an "upsert-like" flow: SELECT, then INSERT OR IGNORE / conditional update. Still, insert vs. update is different.
   - A more robust approach: **delayed response**: measure elapsed time at the end and sleep the remaining time until a fixed floor (e.g., 250ms or 500ms). This flattens small differences. Combined with constant hashing, this makes the two branches statistically indistinguishable.

But wait — "the real outcome still reaches the account owner: existing address gets a 'someone tried to sign up with this address' email". Does that mean the existing branch sends an email, which takes variable time (network I/O)? If email sending is in the request path, timing is dominated by mail server latency. Options:
- Send email asynchronously (fire-and-forget with unhandled rejection handling), so response timing doesn't include email time.
- Or, send email in the request path but after… no, that adds latency.

Hmm, but the tests: "timing test that compares multiple samples of the two branches, and byte comparison of the two responses". If we can't control the mail port in the test, we can mock `sendEmail`. In production, the mail port probably exists with its own implementation. We need to define the mail port interface and how it's wired.

The task says "assume a mail port `sendEmail(to, template, vars): Promise<void>` exists". So there's a function/dependency. I'll define a DI token `MAIL_PORT` and an interface `MailPort { sendEmail(to, template, vars): Promise<void> }` and note that the implementation is provided externally (assumption). In tests, I'll provide a stub.

**Timing equivalence design decisions**:

1. **Constant work**: always compute/verify exactly one argon2id hash with the same cost, regardless of whether the user exists. Use a fixed "ghost hash" precomputed with the same options for the dummy verification path.
2. **Constant response time floor**: measure elapsed time from start, and at the end `await sleep(max(0, FLOOR - elapsed))`. This guarantees that no branch responds faster than FLOOR, hiding sub-millisecond differences. The floor should be greater than the max expected difference in remaining work (DB insert, etc.)… actually, the floor equalizes only if FLOOR is greater than the max of both branches' natural time. If the existing branch's natural time is 180ms and new branch is 190ms, with FLOOR=250ms both become 250ms → equal. The test compares distributions; with the floor, both clusters at FLOOR, so means equal.

But wait: the timing test compares multiple samples. If mail sending is in the path, latency variance might make distributions overlap anyway. Cleanest: send email asynchronously (not awaited before response), or awaited but before the floor padding… no — if we await email before padding, the floor still equalizes: response time = max(natural + mail, FLOOR). Mail variance is different per branch (different template, maybe different recipient) — if mail takes 100ms or 500ms, then response times differ (600 vs 350 → both padded to FLOOR only if FLOOR is greater than both; if FLOOR is smaller, then times differ). So best: send email asynchronously (don't block response), so response timing is entirely our own.

But is fire-and-forget acceptable? The requirement says the outcome "reaches" the account owner; it doesn't require the response to wait for delivery. Standard practice: enqueue/async. I'll fire-and-forget with `.catch(log)`. Hmm, but "discipline: do exactly what the task asks" — async email is a defensible read for the timing property. Actually, let me think whether there's a cleaner way: we could send mail synchronously but with timing floor… no, mail latency variance can exceed any fixed floor. Async is the defensible choice. I'll note in SECURITY.md that mail is delivered asynchronously.

Alternatively, we could await mail but the floor padding doesn't help against variable tail latency. So async. OK.

3. **Byte-identical response**: both branches return 201? Or 202? Let's pick 202 Accepted, body `{"message":"..."}` fixed. Headers: Nest sets Content-Type and Content-Length automatically; since body is identical, length is identical. Ensure no `Set-Cookie` difference — no session/cookie set on sign-up (no auth token). So no cookies. ETag? Nest by default doesn't set ETag unless enabled. Body is identical so no issue.

Status: for an existing address, creating an account would normally be 409, but we return the same as success — so 201 or 202. I'll use 201 with a fixed body like `{"message":"If an account can be created for this address, a confirmation email has been sent"}`? Hmm wait — is 202 more honest? Both are fixed. Let me go with 202 Accepted to indicate async processing. Actually many implementations use 201. Either works; the contract is that both are identical. Let me go with 202.

**Sign-in**:
- Normalize email, look up user.
- Whether or not found, run exactly one argon2id.verify against either stored hash or ghost hash.
- Same timing floor.
- Same response: 401 with `{"error":...}`? Wait, on sign-in, unknown address and wrong password must have the same response. What about correct password? That's a different outcome (success) — that's fine; the requirement only says wrong password and unknown address produce the same response. Success → 201? Typically 200 with a token. But we haven't built a token system. The task says "build sign-up and sign-in endpoints". Sign-in with correct credentials needs to do something — return 200 with a fixed body? Should we issue a token? The task doesn't require a session/token. Keep minimal: on success return 200 `{"message":"ok"}`… that feels weird for an auth endpoint.

Hmm. "Do exactly what the task asks. Do not create files it doesn't call for." Sign-in success case: the task doesn't specify what a successful sign-in returns. Minimal defensible: 200 with a body that doesn't reveal anything, e.g., `{"message":"Authentication succeeded"}`. No token mechanism is required. Let me add an ASSUMPTION comment that successful sign-in returns 200 with a fixed body and that no token/session mechanism is in scope.

Also sign-in: should we also have a timing floor? Requirement 4 says "observer … must not be able to tell the branches apart" — in context that's about sign-up branches (existing vs. new). But sign-in wrong password vs. unknown address is requirement 2 (response equivalence), and requirement 4 likely applies across the board ("this is a requirement"). The timing test "compares multiple samples of the two branches" — primarily sign-up branches. But for sign-in too, the verify is against stored hash (wrong password) vs. ghost hash (unknown address) — same cost, and both padded by floor. Good, apply the same floor to both endpoints.

**Ghost hash**: precompute an argon2id hash of a random password at the same options. Must be a valid encoded hash. I can't actually compute a real argon2 hash in my head… I need to either compute it at startup (generate a hash of a random string on module init — that takes ~50-100ms, one-time, fine), or hardcode a known hash. Generating on init is safer: at service construction/init, compute `argon2.hash(randomPassword, options)` exactly once, and reuse for all dummy verifications. This guarantees parameter match with the real hash (e.g., same m_cost, time cost, etc.). Cost: one extra hash at startup, no big deal.

But wait — if the ghost hash is generated once and verified many times, is verify against the same hash a timing leak? argon2 verify time depends on the parameters embedded in the hash; since ghost is generated with the same options, the cost is the same. Fine.

Alternatively, bcrypt: `bcrypt.hash` with cost 10-12. argon2id is superior; I'll use argon2id via the `argon2` npm package. The convention says TypeScript strict, ESM. The `argon2` package is native; works on Node 20. Good.

Hmm, but in tests, we need argon2 to actually work (timing test). Tests run with vitest; argon2 native module should load. OK.

But the test also "fails if the property is broken" — how do I write a timing test that fails if the property is broken but passes if correct? Approach:

- Measure elapsed time for N samples of sign-up with existing email, and N samples with new email (alternating for fairness).
- Compute means (and maybe spread); assert |meanA - meanB| < tolerance (e.g., 30ms or a relative threshold). If the property is broken (e.g., no hash on existing branch, or no floor), the difference would be larger (argon2 hash is ~50-200ms+ so the diff would be huge → test fails).
- Byte comparison: capture full response (status, body bytes, headers) from both branches and assert deep equality (excluding variable headers like Date). Byte comparison of body: `res` from supertest gives buffer; compare with `Buffer.equals`.

For the test harness: Nest's testing module with supertest. Need to set up an in-memory Prisma? No — Prisma + PostgreSQL; tests need a real DB. Options:
- Use a real Postgres via DATABASE_URL (test env). Convention: "environment: configuration only from env vars. DATABASE_URL for Postgres." So tests can use DATABASE_URL. But CI might not have Postgres… The convention says tests use Vitest; typical pattern for Prisma: run migrations, or use `prisma migrate deploy` / a test DB. I'll write tests that assume a test database is available via `DATABASE_URL` and run `prisma migrate deploy` in a setup file… hmm, that adds complexity.

Alternative: stub the repository in service-level tests and use an HTTP-level test with a real repository? Timing property is mostly about the service logic (hash + floor); the byte comparison needs full HTTP. We can build a Nest app with the real repository against Postgres. Let me think about what's most defensible with limited setup.

Given constraints ("build the complete solution in one reply", "complete first line to last line"), I should make tests runnable with `DATABASE_URL` pointing at a test Postgres and migrations applied. I'll include a vitest setup that runs `prisma migrate deploy`? That requires the migration folder to exist and a child process. Hmm, or we could use `prisma db push` for tests… Let me include a global setup file that runs `prisma migrate deploy` via child_process, guarded by DATABASE_URL.

Actually, wait — simpler: tests use a real PrismaService against DATABASE_URL and a setup that ensures the schema is applied. Let me write:

`test/setup.ts`:
```ts
import { execFileSync } from 'node:child_process';
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', cwd: process.cwd() });
```
Hmm, `prisma migrate deploy` needs the migration files. Let me ship `prisma/migrations/<timestamp>_init/migration.sql`. I need to write the SQL by hand (no tool). For the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  verified     Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

Migration SQL:
```sql
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

This matches what Prisma generates (cuid → TEXT). Good.

Now the test file: `test/auth.spec.ts`. Need to bootstrap a Nest app: create `Test.createTestingModule({ imports: [AuthModule] })`… but AuthModule imports PrismaModule (our app-level Prisma service) and provides the repository. Mail port: AuthModule provides a MailPort via DI token; in production, app.module provides the real one; in tests, we override with a stub that records calls. Let me design the module wiring:

- `prisma.service.ts`? The layout says `src/<feature>/<feature>.module.ts`, controller, service, repository. PrismaService is infrastructure, not a feature. I can put `src/prisma/prisma.service.ts`? Hmm, layout: `src/app.module.ts`, `src/<feature>/...`. Infrastructure like PrismaService can live in `src/prisma.service.ts`? Hmm, the layout enumerates specific files but says "nothing here dictates it" about the file layout — wait, that's in my instructions ("decide the file layout yourself"), but the codebase convention block has a Layout section showing the pattern. The convention block is for this codebase, so I should follow: features in `src/<feature>/`. Prisma service: `src/prisma/prisma.service.ts` + `src/prisma/prisma.module.ts`? That seems consistent with the pattern (prisma as an "infrastructure feature"). I'll create `src/prisma/prisma.module.ts` and `src/prisma/prisma.service.ts`.

Mail port: the task says to assume it exists. I'll define the interface in `src/mail/mail.port.ts`? Hmm, that's adding a file the task doesn't call for. But I need *something* to inject. The most defensible: define the port interface and token in the auth feature: `src/auth/mail.port.ts`? Or just type the parameter. The cleanest, most minimal: `src/auth/auth.types.ts`? Hmm. Actually, a single file `src/auth/mail.port.ts` exporting:

```ts
export const MAIL_PORT = 'MAIL_PORT';
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

And AuthModule `providers: [{ provide: MAIL_PORT, useFactory: ... }]`? In production, someone must implement it. The task says to assume it exists — so in `app.module.ts` I can import… I don't have their module. I'll write: `// ASSUMPTION: the real MailPort implementation is provided externally; app.module binds it here via MAIL_PORT` — and in app.module I can provide a placeholder that throws, or that console.errors? Hmm, but "no guessing in silence… use the most defensible read and mark it." Defensible: app.module provides a no-op/logging MailPort? That changes behavior silently. Better: an app.module that binds a factory which throws on use with a clear message? That would break sign-up in production… but the task explicitly says to *assume* the port exists — meaning their environment has one. I'll write an app.module with a clearly marked placeholder provider and comment.

Let me keep it simple and honest:

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { MAIL_PORT, MailPort } from './auth/mail.port';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [
    {
      // ASSUMPTION: the task assumes a working mail port exists; this binding is
      // the seam where the deployment wires the real implementation.
      provide: MAIL_PORT,
      useFactory: (): MailPort => {
        throw new Error('MailPort is not configured; bind the real sendEmail implementation to MAIL_PORT.');
      },
    },
  ],
})
export class AppModule {}
```

Hmm, throwing factory: the provider is lazy, so the app boots fine and only throws when mail is sent. That's a defensible seam. But maybe better: a stub that logs to stderr? No — silently swallowing email is worse. The throwing placeholder is safest. Actually wait: if the mail port throws, in my design email is fire-and-forget with `.catch` → so it's just logged, response unaffected. OK.

`src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```
PORT from env (configuration only from env vars). Good.

**Now the core service logic.**

```ts
// auth.service.ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository';
import { MailPort, MAIL_PORT? } // inject via constructor token
```

Wait, how to inject a class-typed token: `constructor(private mail: MailPort) {}` with `@Inject(MAIL_PORT)`. Yes.

Argon2 options:
```ts
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};
```
That's OWASP-recommended (19456 KiB, 2 iterations → ~50-100ms on modern hardware). Good, "real cost factor".

Service fields:
```ts
private readonly ghostHash: Promise<string>;
```
Generated in constructor: `this.ghostHash = argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);` — lazy, computed once, reused. First request pays the ~100ms cost; fine. Actually, let me await it in `onModuleInit`? Injectable with `onModuleInit()` — I can implement `OnModuleInit`. Cleaner:

```ts
async onModuleInit(): Promise<void> {
  this.ghostHash = await argon2.hash(randomBytes(32).toString('binary'), ARGON2_OPTIONS);
}
```

Hmm, randomBytes(32).toString('binary') is deprecated-ish; use `randomUUID` or base64. `randomBytes(32).toString('base64')` is fine.

Flow — signUp(email, password):
1. `const started = process.hrtime.bigint()` or `Date.now()`. Use `performance.now()`? Use `process.hrtime.bigint()` with nanoseconds and convert to ms for sleep computation. Simpler: `const startedAt = Date.now()` is ms resolution — enough for sleep granularity (sleep resolution is ~1ms+). Let me use `process.hrtime.bigint()` for precision: elapsedMs = Number(process.hrtime.bigint() - start) / 1e6.

2. `const normalized = normalizeEmail(email)` — trim + lowercase.

3. `const user = await this.repo.findByEmail(normalized);`

4. **Constant hash step**:
```ts
const candidate = user ?? await this.ghostHash;
await argon2.verify(candidate, password); // result irrelevant to response
```
Wait — but for a *new* user, we need a hash to store: `const storedHash = await argon2.hash(password, OPTIONS);` and for an existing user, we need verify (same cost as hash? argon2 hash and verify have comparable cost — both run argon2 core once; verify parses the hash and runs core; hash runs core and encodes. Cost is nearly identical, dominated by memory/iterations). So:
- Existing: `await argon2.verify(user.passwordHash, password);`
- New: `const newHash = await argon2.hash(password, ARGON2_OPTIONS);`

Both cost ~one argon2 core run. The time difference between hash and verify is small (encoding/parsing, microseconds to low ms). The floor padding covers it. But wait — is the floor enough for the timing test to pass? With a 250ms floor and hashing at ~60ms, both branches hit the floor → response time ≈ floor for both. The DB insert in the new branch adds ~1-5ms, hidden under the floor. The test compares means; both are ~floor+ε. The diff would be under tolerance. If the property is broken (e.g., existing branch skips hashing), existing = ~15ms → padded to floor 250? Wait, if we keep the floor but skip the hash, the floor equalizes! So a test with a floor wouldn't fail on "skipped hash"… hmm.

Let me think: to make the test fail when the property is broken, the floor must not hide a broken implementation. If a broken implementation skips argon2 entirely, with a 250ms floor the response would still be ~250ms for both → the timing test passes → bad test.

How to make the test robust? Options:
- Set the floor to 0 and rely on constant hashing alone? Then timing differences come from insert vs. no-insert + hash-vs-verify — could be a few ms; flaky.
- Better test design: assert that both branches take **at least** one argon2 run's worth of time, plus that the distributions are close. E.g., measure the standalone argon2 cost, assert both branches' mean exceeds `hashCost/2` (or `hashCost * 0.8`), AND |mean diff| < tolerance. Then a "skipped hash" implementation fails the lower-bound assertion.
- Also byte comparison of response.

That's a good combination:
1. Sample N=20 per branch (alternating), measure.
2. Compute argon2 reference cost: run `argon2.hash` once, measure duration R.
3. Assert mean(existing) > 0.5 * R and mean(new) > 0.5 * R (both do real hashing).
4. Assert |mean(existing) - mean(new)| < max(30ms, 0.1 * max(means))? Let me pick absolute 30ms tolerance for means. With floor, means are within ~1-3ms. Without floor but with hashing, the diff is small (a few ms) — still passes maybe; the floor makes it more reliable. With a broken implementation (no hash on existing branch), the lower bound fails. Good.

Actually, hmm, is the floor even necessary? Let me reconsider. Differences without floor: new branch = hash + insert (~1-3ms) + no email (async); existing = verify + (maybe no-op). hash vs verify: verify parses the encoded hash (no big deal). Diff is a few ms or less. Timing test with 30ms tolerance would pass. But in a noisy CI, insert latency might spike… floor 250ms is a stronger guarantee and cheap. The task explicitly says timing equivalence is "a requirement, not a nice-to-have" — the floor is a robust, standard mechanism (constant-time response via minimum delay). Let me keep the floor, and describe in SECURITY.md: (a) exactly one argon2id run per request on both branches, with a precomputed dummy hash for the missing-user case; (b) a minimum-response-time floor to equalize the residual; (c) mail is delivered asynchronously so that mail latency doesn't leak.

Floor value: 250ms? If argon2 takes 100ms on a fast machine, floor 250 gives 150ms of padding — fine. On slow CI, argon2 might take 300ms → floor irrelevant, natural time dominates: both branches do one argon2 run so both are ~300ms; insert adds 2ms → still within tolerance. OK, floor 250ms is a reasonable constant. Let me name it `MIN_RESPONSE_MS = 250`.

Wait, one more consideration: the floor applies to sign-in too. Yes, same.

**Response shape**:

sign-up:
```ts
return { message: 'If an account can be created for this address, a confirmation email has been sent' };
```
Hmm, this wording is a little awkward. Let me make it neutral: `"message": "Registration request accepted. If the address could be registered, a confirmation email is on its way."` Both branches get 202 + exactly that body.

Headers: Nest auto-sets `Content-Type: application/json; charset=utf-8` and `Content-Length`. Body is identical → Content-Length is identical. No cookies. OK. Also I should ensure `Vary` isn't set differently — not set. Good.

Wait — one more thing: validation errors must also be identical? If email is invalid format, 400. Same for both? Irrelevant to the property. I'll use a simple class-validator DTO. Convention: controllers validate input. Use `class-validator` + `ValidationPipe` in main.ts? Adding the ValidationPipe in main.ts requires installing the `class-validator`/`class-transformer` packages. That's fine — they're standard NestJS deps. But I'm not delivering package.json… wait, am I? "Deliver all files the solution needs, complete, first line to last line." Is package.json "needed"? Hmm. The codebase already exists (convention block describes an existing repo style with NestJS, Prisma, Vitest). So package.json exists; I shouldn't necessarily recreate it. But I'm adding dependencies: `argon2`, `class-validator`, `class-transformer`. Should I deliver a package.json? If the repo exists, adding deps would require editing package.json — which I can't edit without seeing it. Ugh.

The convention block describes the stack (NestJS, Prisma, Vitest, pnpm) — those are already installed. `argon2` and class-validator are new. Do I strictly need class-validator? I can validate manually in the controller (zero business logic but validation is the controller's job): check types, email format regex, password length. That avoids new dependencies. Hmm, but hand-rolled validation in the controller is… well, defensible and dependency-free. Actually, class-validator is idiomatic NestJS, but it might not be in the repo. To be safe and minimal, I'll validate manually in the controller with clear checks: email = string, contains '@', length limits; password = string, 8..128 chars. Return 400 via `BadRequestException` with the error envelope?

**Error envelope**: `{ "error": { "code": "...", "message": "...", "details": {} } }`. I need a global exception filter that converts exceptions to this envelope. That's a file: `src/errors/http-exception.filter.ts`? The convention: "Errors — a single envelope". So I should implement a filter. Where to put it: `src/common/exception.filter.ts`? Let me make `src/common/http-exception-filter.ts` and apply globally in main.ts (`app.useGlobalFilters(new HttpExceptionFilter())`).

Hmm wait, but sign-in failure returns 401 — is that also an error envelope? Sign-in wrong/unknown: "produce the same response" — 401 with `{"error":{"code":"invalid_credentials","message":"Email or password is incorrect.","details":{}}}`. Both branches → same. Good. Should the sign-in failure body use the envelope? The convention says errors use one envelope — 401 is an error → envelope. Yes.

Filter implementation:
```ts
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';
    const isHttpException = exception instanceof HttpException;
    if (isHttpException) {
      const httpException = exception as HttpException;
      status = httpException.getStatus();
      const resBody = httpException.getResponse();
      if (typeof resBody === 'string') { message = resBody; code = ... }
      else if (typeof resBody === 'object' && resBody !== null) {
        const body = resBody as Record<string, unknown>;
        code = typeof body.code === 'string' ? body.code : this.codeForStatus(status);
        message = typeof body.message === 'string' ? body.message : (Array.isArray(body.message) ? body.message.join(', ') : 'Request failed.');
      }
    }
    res.status(status).json({ error: { code, message, details: {} } });
  }
}
```
I need a mapping for codes: 400 → 'invalid_request', 401 → 'unauthorized', 404 → 'resource_not_found', 409 → 'conflict', default 'internal_error'. And if an HttpException's body already has a `code` (a string), respect it. Keep details always as `{}`.

Hmm, the envelope's `details` is "an object, never null" — so always `{}`. OK.

Do I even need the filter for the sign-up flow? sign-up always returns 202 (validation 400 → envelope). sign-in: success 200 `{...}`? Wait, success body — is that also envelope-like? No, success isn't an error; body: `{"message":"Signed in"}`? That reveals nothing. Hmm, but wait: the difference between successful sign-in and failed… that's the normal authentication distinction (attacker knows whether their own credentials work when they own them? no — an attacker trying someone else's email gets 401 whether it's unknown or wrong password; if it happens to be correct, they've compromised it — that's the endpoint's job). Fine.

Actually, should successful sign-in return a token? No — out of scope. Let me mark an ASSUMPTION comment on the sign-in success response: "no session/token mechanism specified; returns a fixed 200 acknowledgement."

**Repository**:
```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }
  create(data: { email: string; passwordHash: string }): Promise<User> {
    return this.prisma.user.create({ data: { ...data } });
  }
}
```
Should create handle a race (unique constraint violation)? Two simultaneous sign-ups for the same email: both see no user, both hash, both insert → one gets P2002. What to do? The response must still be the same (202). So in the service, catch P2002 → treat as existing (still return 202). But "existing gets a warning email" — on a race, the winner creates and sends verification email; the loser gets a warning email? Either way, response is 202. Let me handle: wrap the create in try/catch; on P2002, send the "someone tried to sign up" mail (or just skip mail — the owner already got a verification email moments ago; sending a warning mail too is weird but harmless). Simpler: on P2002, send the warning email (the owner's address just got touched). Hmm, actually cleaner: on race loss, don't send any email (the account was created in this very instant; the owner will get a verification email from the winner). I think the race loser skips the email. Either way response is identical. Let me document the race loser as no email in a comment… hmm, wait, let me keep it minimal: catch P2002 → no email. Good, I'll comment it.

Race timing: the loser has already done a hash (not a verify) — cost profile is slightly different but it's a rare edge, not the tested branch.

**Email content**:
- new: template 'sign-up-verification', vars { email, maybe a token? }. Verification email — should include a token/URL? The task doesn't require verification handling. Just send with vars `{ email }` and a note? Keep vars minimal: `{ email }`. Template names: `'account-verification'` and `'duplicate-sign-up-attempt'`. I'll define the template names as constants.

Fire-and-forget: `void this.mail.sendEmail(...).catch((err) => { console.error('mail failed', err); })`. Use a logger instead: `@Injectable` with `private readonly logger = new Logger(AuthService.name);`.

**Service sign-in**:
```ts
async signIn(email: string, password: string) {
  const started = process.hrtime.bigint();
  const normalized = normalizeEmail(email);
  const user = await this.repo.findByEmail(normalized);
  const hash = user?.passwordHash ?? await this.ghostHash;
  let ok = false;
  try { ok = await argon2.verify(hash, password); } catch { ok = false; }
  if (user && ok) {
    await this.pad(started);
    return { message: 'Signed in.' }; // hmm
  }
  await this.pad(started);
  throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Email or password is incorrect.' });
}
```
Wait — argon2.verify throws on malformed hash (ghost hash is always valid; stored hash might be corrupt) — catch → false. Good.

Hmm, one subtle point: on sign-in success, return before the envelope. Body `{"message":"Signed in."}`. Good.

The sign-in success path and failure path both have padding. But the success path skips the throw → faster? Both padded → same. Fine.

**pad function**:
```ts
private async padUntil(startedNs: bigint): Promise<void> {
  const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
  const remainingMs = MIN_RESPONSE_MS - elapsedMs;
  if (remainingMs > 0) await new Promise((r) => setTimeout(r, remainingMs));
}
```

**Controller**:
```ts
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  signUp(@Body() body: SignUpDto): { message: string } {
    this.validateCredentials(body);
    return this.authService.signUp(String(body.email), String(body.password));
  }
  @Post('sign-in')
  signIn(@Body() body: SignInDto) { ... }
}
```
Validation in the controller (per convention: "controller validates input"). Shared validation helper in the controller file:
```ts
function validate(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null) throw new BadRequestException({ code: 'invalid_request', message: 'Body must be a JSON object with email and password.' });
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) throw new BadRequestException({ code: 'invalid_request', message: 'email must be a valid address.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new BadRequestException({ code: 'invalid_request', message: 'password must be 8 to 128 characters.' });
  return { email, password };
}
```
EMAIL_RE: a lenient one: `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`. Note: 400 responses don't leak account state (validation precedes the lookup). Good.

Wait — the controller returns a Promise (the service's promise) — Nest awaits it. Sign-in service throws UnauthorizedException → filter → envelope. Good.

But wait: "controller validates input and calls the service. Zero business logic." Normalizing email — where? Normalization (trim/lowercase) is arguably business logic; put it in the service. The controller just validates shape. The service normalizes. Good.

**Module**:
```ts
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```
MailPort: provided in AppModule (global? no — providers of AppModule are available only in AppModule). Hmm: AuthModule needs the MAIL_PORT token. Options:
1. Make the MailPort provider `@Global()`…
2. AuthModule declares the provider itself via factory? The actual implementation is external…
3. Use `@Injectable({ scope })`…

The simplest and most defensible: AuthModule imports nothing about mail; the MailPort provider is registered in AppModule and marked `@Global()`? No, we can't make a provider global; the *module* is global.

Alternative: make `src/mail/mail.module.ts` global:
```ts
@Global()
@Module({ providers: [ {provide: MAIL_PORT, useFactory: placeholder} ], exports: [MAIL_PORT] })
export class MailModule {}
```
And app.module imports MailModule. Tests override the provider. Hmm, but the placeholder throwing factory is in the mail module — with a comment that the deployment must bind the real one… but with pnpm/Nest, you can't easily "rebind" in production without code change. Since the task says to assume the port exists, the cleanest is: the mail port module has a factory that reads… hmm.

Actually, you know what? Let me reconsider: the mail port might be a plain function `sendEmail` that "exists" in their environment. The task: "assume a mail port `sendEmail(to, template, vars): Promise<void>` exists". So maybe there's literally a function `sendEmail` I can import from somewhere. I don't know the path. So DI token + ASSUMPTION comment is the most defensible. I'll make MailModule global with a clearly marked seam, and in tests override `MAIL_PORT` with a recording stub.

Wait, actually, simpler: just put the MAIL_PORT provider in AuthModule itself? "A provider used by another module is exportsed by its own module and importsed by that module." The mail port isn't used by another module. Placing the provider in AuthModule is fine DI-wise. But it feels more like infrastructure… I'll make a small `src/mail/mail.module.ts` global module with the token + interface in `src/mail/mail.port.ts`. Hmm, two files. Alternatively, one file: `src/mail/mail.module.ts` containing the interface + token + module. Let me do that — fewer files.

Hmm wait, but actually, let me reconsider whether to just define the port interface in the auth feature. The mail port is *assumed* to exist externally. My job: consume it. I'll define:

`src/mail/mail.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

export const MAIL_PORT = Symbol('MAIL_PORT');  // hmm, Symbol token fine
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```
Wait, but tests do `overrideProvider(MAIL_PORT)` — with a Symbol it's fine.

Actually, string token 'MAIL_PORT' is easier to reason about. Use a string.

Providers in MailModule:
```ts
{
  provide: MAIL_PORT,
  useFactory: (): MailPort => {
    // ASSUMPTION: the real mail port is supplied by the deployment; this is the seam.
    return {
      sendEmail: async () => { throw new Error('MailPort not configured'); },
    };
  },
}
```
Hmm, I wavered earlier. Let me settle: the placeholder throws when used. Since mail is fire-and-forget and caught+logged, the app works; mail is never delivered until the real port is bound. The comment marks the seam. In production wiring (app.module imports MailModule), someone swaps the factory. That's honest.

Alternatively… the task says "assume a mail port sendEmail(...) exists" — maybe the most defensible read is that there's a global/known function in their codebase I can't see, and I should import it and mark with ASSUMPTION. I can't import from an unknown path. The DI seam + ASSUMPTION is the cleanest and most defensible read. Decision made.

**Prisma module/service**:

`src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

`src/prisma/prisma.module.ts`:
```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```
Global so features can import without ceremony? The convention says imports are needed… "providers used by another module are exportsed by its own module and importsed by that module." So per the convention, AuthModule should import PrismaModule. OK, no @Global on PrismaModule; AuthModule imports it.

MailModule: only AuthModule uses it → AuthModule imports MailModule. Good, no @Global needed anywhere.

**app.module.ts**:
```ts
@Module({ imports: [AuthModule] })
export class AppModule {}
```
Wait, if AuthModule imports PrismaModule and MailModule, then AppModule just imports AuthModule. And controllers are picked up via the module. Good.

**main.ts**: create app, useGlobalFilters(HttpExceptionFilter), listen on PORT. Also `app.enableShutdownHooks()` so Prisma disconnects.

**Now the tests.**

`test/auth.spec.ts`:

Setup:
- Global setup to ensure DB: `test/setup.ts` runs `prisma migrate deploy`. Configure in vitest.config.ts: `test: { setupFiles: ['test/setup.ts'], testTimeout: 60000 }`. Do I need to deliver a vitest.config.ts? The repo probably has one already… "decide the file layout yourself" — since I can't see their config, it's safer to deliver my own `vitest.config.ts`. Hmm, if the repo already has one, mine overrides (I can't know). I'll deliver a minimal one with `test: { setupFiles: ['./test/setup.ts'], testTimeout: 120_000, hookTimeout: 120_000 }`. And a tsconfig? The repo has one (convention: TS strict ESM). Don't deliver a tsconfig (existing). Deliver package.json? Ugh.

Let me think about package.json. The solution needs `argon2` (and `@types/argon2`? does the argon2 package ship its own types? — I think the `argon2` npm package includes TypeScript declarations (types included in the package? I think argon2@0.40+ has bundled types… actually I recall argon2 has a `types` field? hmm. I recall `argon2` includes `.d.ts` files? Not sure. Many projects install `@types/argon2`… I don't think @types/argon2 exists… actually it does: `@types/argon2`? hmm. Let me think. The argon2 package (by josephgeng… no, by Codebox/Mehmet? it's `argon2` by "brettlangdon"? no). The `argon2` npm package: maintained by "Codebox" (Mehmet K)? I think modern versions bundle TypeScript definitions (`argon2` ships `argon2.d.ts`? ). I'm really not sure.

To be safe against the types issue, I could `import argon2 from 'argon2'` and if types are missing, TS strict would fail… I can add a local declaration file `src/types/argon2.d.ts` with `declare module 'argon2';` — but if the package *does* ship types, my `declare module 'argon2'` would be an augmentation conflict? A `declare module 'argon2';` (shorthand) in an ambient file would error if the module has real types? Actually, shorthand ambient declarations are ignored if the module resolves to a typed module? No — I think a shorthand `declare module 'x';` is only used when the module has no other resolution; if both exist, TS might complain "cannot augment module"? Hmm, risky.

Alternative: avoid uncertainty — use `bcrypt` instead? The `bcrypt` package: needs `@types/bcrypt` (doesn't bundle types? bcrypt I don't think ships types… actually bcrypt doesn't include types; `@types/bcrypt` exists and is standard). Either way one is uncertain.

Better: since I'll deliver package.json? If I deliver a package.json listing all deps including devDeps with `@types/node` etc., I control everything. But if the repo already has a package.json, mine "is taken once at the last occurrence" — the mechanical parser takes my file, overwriting theirs — potentially breaking their repo (removing deps). But the instruction says "deliver all files the solution needs". A working solution needs a manifest that lists argon2. I think delivering a complete package.json is defensible and probably expected ("the whole solution"). Hmm, but "do not create files the task doesn't call for"… does the task call for it? Not explicitly. But it's needed for the solution to work. I'll deliver a package.json with the full dep set (nestjs, prisma, vitest, supertest, argon2…). And a tsconfig.json? For ESM + NestJS strict… I'll guess the repo has a tsconfig already; mine might conflict with theirs… the parser takes the last occurrence — mine would replace theirs. Delivering tsconfig is risky either way (their build config could be different).

Let me reconsider: the convention block describes an existing repo layout ("prisma/schema.prisma, src/main.ts, …") — the repo exists with main.ts, app.module.ts, package.json, tsconfig, vitest config, etc. My job: add feature files + prisma schema/migrations + tests + SECURITY.md. Since main.ts and app.module.ts are listed in the layout, they exist — but I need to modify them (add the filter, import AuthModule). So I have to deliver updated complete versions. Similarly, adding a dep means package.json changes… but I don't see it. Ugh.

Decision: I'll deliver a complete, reasonable `package.json` and `tsconfig.json` and `vitest.config.ts` that make the solution self-contained — the "whole solution in one reply" framing (no second request, no file system) implies my file set should stand alone. I'll make package.json minimal but complete for the solution: nestjs core/common/testing, @prisma/client, prisma (dev), typescript (dev), vitest (dev), supertest + @types/supertest (dev), argon2, rxjs, reflect-metadata, class-validator? (not using — skip), @nestjs/platform-express, @types/express, @types/node.

Hmm wait — do I need class-validator? No, hand-rolled validation. Skip.

Actually, wait. Let me reconsider using class-validator — it's the idiomatic Nest way, but hand-rolled avoids two deps and version pinning issues. Hand-rolled is enough and keeps the controller "validating input". Keep hand-rolled.

ESM + NestJS: Nest with ESM requires specific setup (does it work on Node 20+? ESM in Nest is still finicky, but the convention mandates ESM `"type":"module"`, so the repo already handles it — I won't fight it; my code doesn't need anything special. Except: no need for extensionless imports? In ESM, imports of local files should include the `.js` extension! The convention says ESM `"type":"module"`. Under NodeNext, TS requires `.js` in relative imports. But Nest's tsconfig is often `"module": "nodenext"`… or they use `"moduleResolution": "bundler"`, which allows extensionless. Hmm. I can't know their tsconfig.

Safest: use explicit `.js` extensions on relative imports (works with NodeNext and bundler resolution; works with plain "node" too? in TS module: commonjs, extensionless is typical but `.js` extensions also allowed? In CJS TS, you can write `import {x} from './y.js'` and it resolves to y.ts — yes, TS handles that even in CJS mode. And vitest (vite) handles `.js` → `.ts` resolution fine. So `.js` extensions are the safe choice across modes. I'll use `.js` in all relative imports.

Hmm, one caveat: vitest + ESM + Nest decorators — do I need `esbuild`? No, vitest handles TS via esbuild; decorators work via `experimentalDecorators`? esbuild supports TS experimentalDecorators? esbuild supports TS experimentalDecorators — does vitest set `experimentalDecorators: true` and `emitDecoratorMetadata: true` by default? no… NestJS needs `emitDecoratorMetadata` for DI type inference! With vitest, Nest's docs recommend `swc` plugin (`@vitest/plugin-swc`? actually `unplugin-swc` + `@swc/core` with emitDecoratorMetadata). Hmm, this is getting deep.

But wait — my DI doesn't rely on metadata at all: I use explicit `@Inject(MAIL_PORT)` for the token, and constructor params are typed classes (PrismaService, AuthRepository, AuthService) — Nest uses `design:paramtypes` from emitDecoratorMetadata to resolve class-typed params. Without metadata, Nest can't resolve → "cannot resolve dependencies" error.

Solutions:
1. Add `@Inject()` explicitly everywhere — ugly.
2. Use vitest with swc transform (need devDeps `unplugin-swc`, `@swc/core`).
3. Avoid Nest's DI in tests: test with plain supertest against a manually built app? Still need Nest's DI.
4. Use `forwardRef`? no.

Hmm. Actually, does esbuild emit decorator metadata? No, esbuild doesn't support `emitDecoratorMetadata`. Vitest's default TS transform (esbuild) → no metadata → Nest DI of class-typed constructor params fails… unless Nest falls back? Nest uses `Reflect.getMetadata('design:paramtypes', target)`. If undefined → it errors for undefined params, but if a param type is… no, it errors.

Wait, actually — hmm, many people run Nest + Vitest successfully… because they use `@swc/jest` or `unplugin-swc`. Or the vitest config includes `esbuild: { ... }`? esbuild really doesn't do metadata.

So for tests to work, I need the swc plugin in vitest.config.ts:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc({ module: { type: 'es6' }, jsc: { decoratorMetadata: true, parser: { syntax: 'typescript', decorators: true } } })],
  test: { setupFiles: ['./test/setup.ts'], testTimeout: 120000, hookTimeout: 120000, pool: 'forks' },
});
```
And devDeps: `unplugin-swc`, `@swc/core`. That's a well-known recipe for Nest+Vitest. I'll include it.

Alternatively, avoid the whole issue: make the service not rely on Nest's DI metadata in tests… but the app needs to be booted via Nest for HTTP-level byte comparison. I could also build a small HTTP harness with raw node http that calls the service directly, but that skips the controller/filter — the byte comparison of "the two responses" is better done with actual Nest + filter. Let me go with the swc plugin. It's a standard, defensible setup.

Hmm wait — but if the existing repo's vitest.config already works with their stack (NestJS + Vitest per the convention), they must already have swc setup. The convention says NestJS + Vitest coexist, so the repo's test setup handles decorators. So my vitest.config.ts might not be needed… but I don't see theirs. Since I deliver a package.json anyway, I'll deliver a vitest.config.ts with the swc plugin + setup file — consistent, self-contained. If it overrides theirs, it still works for my tests. OK.

Also `test/setup.ts` runs migrations via child_process. But vitest transforms setup files with swc too — fine. And it needs the `prisma` CLI — devDep. In setup:
```ts
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath? no — run pnpm exec prisma?
```
Simplest: `execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(root,'prisma/schema.prisma')], { cwd: root, stdio: 'inherit' })`. npx works if prisma is installed locally (finds local bin). Hmm, npx might prompt? `npx --yes`? Use `node_modules/.bin/prisma`? Cross-platform… in ESM, I'll do: `execFileSync(join(root, 'node_modules/.bin/prisma'), ['migrate','deploy'], {cwd: root, stdio:'inherit'})`. On Windows, .bin has a .cmd — the tests probably run on unix (evals). Acceptable. Alternatively, skip the CLI: in setup, use PrismaClient directly with… no, migrations need the CLI.

Alternative cleaner approach: use `prisma migrate deploy` in setup; if DATABASE_URL isn't set → skip? no — tests need the DB; failing fast with a clear error is correct. If there's no DATABASE_URL, `execFileSync` prisma would throw with a clear message. Good.

Hmm, and cleanup between tests: each test run should start with a clean users table? `prisma migrate deploy` doesn't reset. If a previous run left users with the same email, the test might break. Let me make the test emails unique per run (crypto.randomUUID()). That avoids cleanup. But for the timing test, "existing address" needs to pre-create a user — the test creates one with a unique email. Good, no table-wipe needed.

Wait, actually, in globalSetup I could run `prisma migrate reset --force`? That drops and recreates the DB — destructive if DATABASE_URL is a shared dev DB… but this is a test env; `migrate deploy` + unique emails is safer. I'll keep unique emails.

**Test structure**:

```ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import express from 'express'; // ? supertest works directly with app.getHttpAdapter().getInstance()
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAIL_PORT } from '../src/mail/mail.module';
import { HttpExceptionFilter } from '../src/common/http-exception-filter';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
```

Boot:
```ts
let app: INestApplication;
const sent: Array<{to: string; template: string; vars: Record<string,string>}> = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue({ sendEmail: async (to, template, vars) => { sent.push({to, template, vars}); } })
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });
```
Wait — global filter: in production, main.ts adds it; in the test, I add it manually to reflect main.ts. Alternatively, put the filter in app.module's `APP_FILTER` provider — then both main.ts and the test get it automatically! Better: app.module provides `{ provide: APP_FILTER, useValue: new HttpExceptionFilter() }`? Or useClass. That's idiomatic and ensures test = production wiring. Let me do that: app.module.ts:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception-filter';

@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
```
And main.ts doesn't need to add the filter.

**Test cases**:

1. *Byte-identical response* (sign-up): create an existing user directly via PrismaService (or via a sign-up call first). Then:
   - `r1 = await request(server).post('/auth/sign-up').send({email: existingEmail, password: 'correct-horse-1'})`
   - `r2 = await request(server).post('/auth/sign-up').send({email: freshEmail, password: 'correct-horse-1'})`
   - Assert `r1.status === 202`, `r2.status === 202`
   - Byte comparison: `expect(Buffer.from(r1.text)).toEqual(Buffer.from(r2.text))` — byte comparison. Better to compare the raw buffer: supertest's `res` is a Node response; `res.text` is a string; use `r1.body`? For bytes: do `request(...).buffer(true)`? By default, supertest parses JSON. For true byte comparison, get the raw data: `req.post(...).send(body)` and then `res.body` — parsed. Hmm. I can request with `.set('Accept','application/octet-stream')`? no. Supertest: response body is available as `res.text` (string) and `res.body` (parsed if content-type json). The actual byte sequence = `Buffer.from(res.text, 'utf8')`. Since it's JSON UTF-8, the text bytes == the wire bytes. That's a legitimate byte comparison: `Buffer.compare(Buffer.from(a.text,'utf8'), Buffer.from(b.text,'utf8')) === 0`.
   - Headers: compare the selected header set: content-type, content-length. Ignore variable ones (date, connection, keep-alive, x-powered-by?). Express sets `X-Powered-By: Express` on both — equal. Compare: `['content-type','content-length','x-powered-by']`. Assert equality for each. Content-Length equality follows from identical bytes, but I'll assert explicitly.

2. *Email reaches the owner correctly*: after the above, assert `sent` includes: for the existing email, template 'duplicate-sign-up-attempt' (to the existing address), for the new email, template 'account-verification' (to the new address). And crucially: response is still identical (covered by 1). This verifies requirement 5: the owner receives different mail, the caller sees the same thing.

3. *Sign-in equivalence*:
   - `r1 = sign-in(existingEmail, 'wrong-password-1')` → 401
   - `r2 = sign-in(freshUnknownEmail, 'wrong-password-1')` → 401
   - Assert status equal, byte comparison of bodies, headers equal.
   - Also, positive control: `sign-in(existingEmail, correctPassword)` → 200. (The test isn't only happy path; I have error cases here.)

4. *Timing test* (sign-up): N = 20 samples per branch, alternating:
```ts
const existing: number[] = []; const fresh: number[] = [];
for (let i = 0; i < N; i++) {
  const e = timeRequest(signup existingEmail_i? — same existing email, different password? use a constant password);
  existing.push(e);
  const f = await time(signup freshEmail_i (unique each iteration to keep it "new"));
  fresh.push(f);
}
```
Hmm — fresh email unique per iteration: 20 new users created; fine.
Measure: `const t0 = process.hrtime.bigint(); await request(server).post(...).send(...); const t1 = ...; ms = (t1-t0)/1e6`.

Reference argon2 cost: `const h0 = process.hrtime.bigint(); await argon2.hash('bench-password', same options); const argon2Ms = ...`.

Assertions:
- `mean(existing) > argon2Ms * 0.5` and `mean(fresh) > argon2Ms * 0.5` — each branch does real hashing (fails if a branch skips hashing).
  Wait — note: if a broken implementation skips hashing on the existing branch, mean(existing) ≈ floor (250ms)… and argon2Ms * 0.5 might be < 250 (argon2 ~100ms → threshold 50ms; 250 > 50 → passes!). Hmm, the floor makes this assertion weak. But the *difference* assertion: |mean(existing) - mean(fresh)| — with a floor, both ≈ 250 → passes. So a floor-only broken implementation (no hash on existing branch) would pass my timing test?? That's a bad test — "a test that fails if the property is broken".

Let me reconsider. What does "property broken" mean concretely? The property: an attacker measuring time can't distinguish. If an implementation skips argon2 on the existing branch and keeps a 250ms floor, then actually… the responses are timing-indistinguishable (both 250ms). The property holds! Skipping hash + floor is not a timing leak (although it is a security bug in another sense — well, actually if we skip hashing on sign-up existing, no harm to the timing property; hash is… wait, sign-up existing branch: hashing on sign-up isn't for verification, it's for equalization! A correct implementation hashes on the new branch to store; on the existing branch, it verifies (or hashes a dummy) for time equalization. If an implementation hashes on the new branch (storing) and does nothing on the existing branch, with no floor: existing ≈ 15ms, new ≈ 90ms → timing leak → attacker distinguishes. With a floor of 250ms: both 250 → no leak via response time. So floor alone suffices for the timing property? In theory, yes: if all responses are padded to a constant minimum T greater than the max natural time of any branch, response times are constant. The residual leak: if a branch's natural time exceeds T (e.g., new branch = hash 300ms > T 250 → new=300, existing=250 → 50ms leak). So the floor must exceed the max branch time. That's why we keep hashing consistent (both branches ~one argon2 run) so the max is bounded.

So the test should assert the real property: **the distributions are statistically indistinguishable / means within tolerance**. A floor-only broken implementation still passes — correctly, because the property holds. My lower-bound assertion ("both branches do argon2") is not testing the property; it's testing the mechanism. The task says "tests that fail if the property is broken". So the timing test should measure: is the timing difference within tolerance? With a no-floor + no-equal-hash implementation: existing ~15ms, new ~90ms → diff 75ms > 30ms tolerance → fails. Good. With the correct implementation: both ~250 → diff ~1ms → passes.

But CI noise: could jitter push the correct implementation's diff over 30ms? With the floor, both clusters tightly at 250+ε (timer resolution ±1-2ms; insert jitter hidden under the floor). The diff of means should be < 5ms. Tolerance 50ms is generous. Without a floor… I do have a floor. I'll set tolerance to 40ms for the mean diff. Also assert each branch's mean ≥ some floor? Assert `mean(existing) >= MIN_RESPONSE - 5`? That's mechanism-specific; skip. Instead, assert that both branches take at least, say, 100ms? That would assert a "real cost" is present (requirement 3/4) — a broken impl that hashes at cost-1 (fast) on only one branch would… hmm. Let me add: assert both means > 50ms — ensures neither branch is trivially fast (catches "existing branch does nothing AND floor is removed" — but that's caught by the diff test too). I'll keep it simple: (a) diff of means < 40ms; (b) both means within a reasonable band? Let me also assert both branch means are within [100ms, 5000ms]? Over-constraining might make tests flaky on slow CI (argon2 can take 1s on some VMs? with 19MiB/2iter, usually <200ms; slow CI maybe 400ms; floor 250 → max ~700ms). Upper bound 5000 is safe. Lower bound 100: on fast hardware, hash ~40ms + floor 250 → 250 ≥ 100 fine.

Hmm wait, actually — should I also do a timing test on sign-in? The timing test requirement says "compares multiple samples of the two branches" (sign-up). I'll add a sign-in timing comparison too (wrong password vs. unknown) — cheap and strengthens. Yes, I'll include it: N=15 each.

Wait, sign-in timing: both branches: findUser (DB) + argon2 verify + floor. Unknown address → verify against ghost (ghost is a precomputed constant, verify cost is the same). Diff is minimal. Tolerance 40ms. Good.

5. *Validation errors* (400 envelope shape): bad email → 400 with error envelope, code 'invalid_request', details {}. And unknown → hmm, there's no 404 in this API. Test the envelope shape via a 400 and a 401. Good — "test behavior, not implementation", cover error paths.

6. *Email not leaking into response*: covered by the byte comparison (response is identical) + mail recording assertions.

Now — the byte comparison test's "two responses": I have to be careful that the two sign-ups produce identical bodies. My response body: `{ "message": "..." }` — fixed string.

One more: **Nest's default body parsing** — JSON is fine.

**Timing test and the mail stub**: the stub is async push — negligible.

**The `date` header**: not compared. Fine.

**Now, the actual service code in detail**:

```ts
import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from '../mail/mail.module.js';

// Cost: OWASP-recommended argon2id parameters (19 MiB, 2 passes, parallelism 1).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MIN_RESPONSE_MS = 250;

const TEMPLATES = {
  verification: 'account-verification',
  duplicateSignUp: 'duplicate-sign-up-attempt',
} as const;

export const SIGN_UP_ACK = 'If an account can be created for this address, a confirmation email is on its way.';
export const SIGN_IN_ACK = 'Signed in.'; // hmm
```

Wait, the sign-in success body… let me think what's reasonable: `{"message":"Authentication successful."}`? Meh. Or return `{ "authenticated": true }`? Let me keep it as `message: 'Signed in.'`.

Normalization:
```ts
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

Service:

```ts
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private ghostHash = ''; // precomputed argon2id hash of a random secret

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  onModuleInit(): void {
    // Compute asynchronously; the first request awaits it.
    void this.computeGhostHash();
  }

  private computeGhostHash(): Promise<string> { ... }
```
Hmm — simpler and more robust: generate in onModuleInit with await? `async onModuleInit() { this.ghostHash = await argon2.hash(...); }` — delays app startup by ~100ms, one-time. That's fine, deterministic. Let me do that.

```ts
  async onModuleInit(): Promise<void> {
    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), { ...HASH_OPTIONS });
  }
```

signUp:
```ts
  async signUp(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const existing = await this.repository.findByEmail(normalized);

    if (existing) {
      // Equalizing branch: verify against the real stored hash. The outcome
      // is discarded; its only purpose is to spend the same CPU as the
      // hashing on the new-address branch below.
      await this.safeVerify(existing.passwordHash, password);
      this.enqueueMail(normalized, TEMPLATES.duplicateSignUp);
    } else {
      const passwordHash = await argon2.hash(password, HASH_OPTIONS);
      try {
        await this.repository.create({ email: normalized, passwordHash });
      } catch (err) {
        // Unique constraint lost a race: the address was just created.
        if (!isUniqueConstraintError(err)) throw err;
        // The winner of the race sends the verification email; send nothing.
      }
      this.enqueueMail(normalized, TEMPLATES.verification);
    }

    await this.padResponse(startedAt);
    return { message: SIGN_UP_ACK };
  }
```

Wait — race: create fails → we skip mail, and the existing branch… hmm, in the race case we've hashed (new-branch cost) — fine.

safeVerify:
```ts
  private async safeVerify(hash: string, password: string): Promise<void> {
    try {
      await argon2.verify(hash, password);
    } catch {
      // Corrupted stored hash: treat as non-match. Never leak via timing.
    }
  }
```

signIn:
```ts
  async signIn(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const user = await this.repository.findByEmail(normalized);

    // Exactly one argon2id run on every request: against the stored hash, or
    // against the precomputed ghost hash when the address is unknown.
    const candidate = user?.passwordHash ?? this.ghostHash;
    const ok = await this.tryVerify(candidate, password);

    if (user && ok) {
      await this.padResponse(startedAt);
      return { message: SIGN_IN_ACK };
    }
    await this.padResponse(startedAt);
    throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Email or password is incorrect.' });
  }

  private async tryVerify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
```

padResponse:
```ts
  private async padResponse(startedAt: bigint): Promise<void> {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const remaining = MIN_RESPONSE_MS - elapsedMs;
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
  }
```

enqueueMail:
```ts
  // Fire-and-forget: the caller's response must not depend on the mail
  // transport's latency, so we never await delivery before responding.
  private enqueueMail(to: string, template: string): void {
    void this.mail
      .sendEmail(to, template, { to })
      .catch((err: unknown) => {
        this.logger.error(`mail send failed for template ${template}`, err instanceof Error ? err.stack : String(err));
      });
  }
```
Vars: `{ to }`? The template probably wants the email — the `to` parameter already has it; vars could be `{}` or include an `email`. Let me pass `{ email: to }`. Hmm, the port signature is `sendEmail(to, template, vars)` — vars for template interpolation. I'll pass `{ email: to }`.

isUniqueConstraintError:
```ts
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'P2002';
}
```
No Prisma import in the service (service must not call Prisma client — checking the error code string is fine, no client call).

**Repository**:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: { email: string; passwordHash: string }) {
    return this.prisma.user.create({
      data: { email: data.email, passwordHash: data.passwordHash },
    });
  }
}
```

**Controller**:
```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({ code: 'invalid_request', message: 'Request body must be a JSON object with "email" and "password".' });
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestException({ code: 'invalid_request', message: '"email" must be a valid address (3-254 characters).' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException({ code: 'invalid_request', message: '"password" must be a string of 8-128 characters.' });
  }
  return { email, password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  signUp(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signIn(email, password);
  }
}
```
Both endpoints share the same validation → identical 400 behavior. Note: the response on failure is… fine.

Wait — `@Body() body: unknown` — with swc metadata, unknown params are fine (no DI for @Body).

**Filter** (`src/common/http-exception-filter.ts`):
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

const CODES_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'invalid_request',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODES_BY_STATUS[status] ?? 'error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        if (typeof body.code === 'string') code = body.code;
        else code = CODES_BY_STATUS[status] ?? 'error';
        if (typeof body.message === 'string') message = body.message;
        else if (Array.isArray(body.message)) message = body.message.join('; ');
      }
    } else {
      this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    if (status >= 500) {
      message = 'An unexpected error occurred.'; // don't leak internals
      code = 'internal_error';
    }

    response.status(status).json({ error: { code, message, details: {} } });
  }
}
```
Note: `details` is always `{}`.

Hmm: 500 leak — I reset the message. Good.

Edge: HttpException with status 401 and an object body `{code:'invalid_credentials', message:'...'}` → respects the code. Good.

**main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
```

**Prisma schema**:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  verified     Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```
Migration SQL (name: `prisma/migrations/20240101000000_init/migration.sql`):
```sql
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```
Also, we need a `prisma/migrations/migration_lock.toml`:
```
# Please do not edit this file manually
# It should be added in your version-control system (i.e. Git)
provider = "postgresql"
```
Yes — `migrate deploy` requires the lock file? It reads the migrations folder; the lock file is generated; `migrate deploy` should work without a lock? I think the lock file is needed to know the provider for some commands; `migrate deploy` applies pending migrations — I think it reads the lock to verify the provider. Safer to include it. I'll include it.

**The "verified" field**: do I need it? The sign-up creates an account (unverified), sends a verification email. Verification isn't an endpoint in scope. The field documents state; I'll keep it minimal but it makes sense (the verification email implies a verified flag exists). Keep.

**Tests in detail**:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.module.js';
```

Hmm wait — do the tests need PrismaService? I'll pre-create the existing user via the HTTP endpoint (sign up first → creates it). That way I don't touch the DB directly in tests. Yes! To create the "existing" address: send a sign-up (creates the account + verification mail). Then sign-up again → existing branch. And the first sign-up is also a new-branch sample.

Mail stub recording:
```ts
type MailRecord = { to: string; template: string; vars: Record<string, string> };
const mails: MailRecord[] = [];
const mailPort: MailPort = {
  sendEmail: async (to, template, vars) => { mails.push({ to, template, vars }); },
};
```

App boot:
```ts
let app: INestApplication;
beforeAll(async () => {
  const moduleRef = await Test
    .createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(async () => { await app?.close(); });
```
Server: `const server = app.getHttpServer();`

Timing helper:
```ts
async function elapsedMs(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
}
```

Byte comparison helper:
```ts
function expectSameResponse(a: request.Response, b: request.Response): void {
  expect(a.status).toBe(b.status);
  const bytesA = Buffer.from(a.text, 'utf8');
  const bytesB = Buffer.from(b.text, 'utf8');
  expect(Buffer.compare(bytesA, bytesB)).toBe(0);
  for (const header of ['content-type', 'content-length', 'x-powered-by']) {
    expect(a.headers[header], `header ${header}`).toBe(b.headers[header]);
  }
}
```
Hmm — supertest's response headers object keys are lowercased. content-length should be equal. But is `x-powered-by` present? Express by default sets it. If the platform changes… I'll include but risky? Both responses go through the same express, so it's equal either way (both present or both absent → `undefined === undefined` passes). Fine.

Test 1: "sign-up: new and existing produce byte-identical responses"
```ts
const domain = `t-${randomUUID()}@example.com`;
const existing = `existing-${randomUUID()}@example.com`;
// seed the existing address
const seed = await request(server).post('/auth/sign-up').send({ email: existing, password: 'existing-pw-123' });
expect(seed.status).toBe(202);

const rExisting = await request(server).post('/auth/sign-up').send({ email: existing, password: 'someone-else-pw-1' });
const rNew = await request(server).post('/auth/sign-up').send({ email: domain, password: 'new-address-pw-1' });

expect(rExisting.status).toBe(202);
expect(rNew.status).toBe(202);
expectSameResponse(rExisting, rNew);
```

Test 2: "the owner still receives the right mail":
```ts
const dup = mails.filter((m) => m.to === existing && m.template === 'duplicate-sign-up-attempt');
const verif = mails.filter((m) => m.to === domain && m.template === 'account-verification');
expect(dup.length).toBeGreaterThanOrEqual(1);
expect(verif.length).toBe(1);
```
And also that the new address got a verification at seed time, etc. Good — behavior: mail is differentiated, response is uniform.

Test 3: "sign-in: wrong password and unknown address are indistinguishable":
```ts
const rWrong = await request(server).post('/auth/sign-in').send({ email: existing, password: 'wrong-password-1' });
const rUnknown = await request(server).post('/auth/sign-in').send({ email: `unknown-${randomUUID()}@example.com`, password: 'wrong-password-1' });
expect(rWrong.status).toBe(401);
expectSameResponse(rWrong, rUnknown);
const err = rWrong.body.error as {code: string; details: object};
expect(err.code).toBe('invalid_credentials');
expect(err.details).toEqual({});
```

Test 4: "sign-in success" (positive control):
```ts
const rOk = await request(server).post('/auth/sign-in').send({ email: existing, password: 'existing-pw-123' });
expect(rOk.status).toBe(200);
```

Test 5: "validation":
```ts
const r = await request(server).post('/auth/sign-up').send({ email: 'not-an-email', password: 'short' });
expect(r.status).toBe(400);
expect(r.body).toEqual({ error: { code: 'invalid_request', message: expect.any(String), details: {} } });
```

Test 6: timing — sign-up branches:
```ts
const N = 20;
const existingTimes: number[] = [];
const newTimes: number[] = [];
const existingEmail = `timing-${randomUUID()}@example.com`;
await request(server).post('/auth/sign-up').send({ email: existingEmail, password: 'seed-password-1' }); // seed

for (let i = 0; i < N; i++) {
  existingTimes.push(await elapsedMs(() => request(server).post('/auth/sign-up').send({ email: existingEmail, password: `pw-existing-${i}` })));
  newTimes.push(await elapsedMs(() => request(server).post('/auth/sign-up').send({ email: `timing-new-${randomUUID()}@example.com`, password: `pw-new-${i}` })));
}

const benchStart = process.hrtime.bigint();
await argon2.hash('reference-password', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const argon2RefMs = Number(process.hrtime.bigint() - benchStart) / 1e6;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanExisting = mean(existingTimes);
const meanNew = mean(newTimes);

// 1) Both branches do real password hashing (a skipped hash shows up here).
//    Hmm — wait, is this guaranteed? mean >= argon2RefMs? no: the branch time = max(1*argon2 + db, floor) ≥ argon2 (roughly, modulo scheduling).
```
Hmm: is meanExisting ≥ argon2RefMs guaranteed? The branch does one verify (≈ one hash in cost) + DB + floor ≥ verify time ≈ hash time (modulo variance). So `meanExisting > argon2RefMs * 0.9`? On CI, variance could make this flaky (verify occasionally slower? or faster?). Both verify and hash run the same core; hash adds encoding (~µs), verify adds parsing. They're nearly equal. A 0.9 lower bound is somewhat safe, but under load, mean across 20 samples should comfortably exceed a single hash run (each sample includes full hashing; the mean of 20 ≈ same as single). Risky. Let me use 0.75.

But wait — does this lower bound actually catch a broken implementation? Broken: existing branch skips hashing but keeps floor 250. meanExisting ≈ 250. argon2RefMs ≈ 100 → 0.75*100=75 < 250 → passes. So the lower bound doesn't catch it. But the *diff* catches? meanNew ≈ max(100,250)=250, meanExisting ≈ 250 → diff 0 → passes. So this broken impl passes the timing test — and *should*, since the floor makes it timing-equivalent. OK, as analyzed, fine.

A truly leaky broken implementation: no floor + no equalizing hash → meanExisting ≈ 20, meanNew ≈ 120 → diff 100 > tolerance → fails. ✓.

So the main assertion: `Math.abs(meanExisting - meanNew) <= 40`. Plus a sanity that both are above some minimum: assert both ≥ 150? With a correct impl, both ≈ 250+ε. If someone set the floor to 0 but kept equalizing hashing: both ≈ 100±10, diff small → passes (property holds, fine). Lower bound 150 would *fail* that legitimate variant — over-constraining the mechanism. Drop the absolute lower bound and keep: diff ≤ 40ms, and… let me keep something to guard against the degenerate "both branches respond in 5ms" (floor removed AND hashing skipped — then diff ~0 → passes?? both ~5ms, diff < 40 → passes!). Hmm! A broken implementation that does no hashing anywhere and no floor: both branches ~10ms → timing-equivalent (passes, *should* since no timing leak) but violates requirement 3 (real cost factor) — that's caught by another test: assert that the response is not suspiciously fast? That's testing the requirement "real cost factor" indirectly: assert `meanNew >= 50` (a single argon2id run at real cost can't be < 50ms on any hardware? on a fast machine, argon2id 19MiB/2 ≈ 30-150ms; on a very fast one maybe 25ms… hmm).

Better: directly test the cost — assert that the service's hashing is real: `expect(argon2RefMs).toBeGreaterThan(20)` (self-measurement, hardware-dependent… on a beefy CI, 19MiB×2 could be ~30ms; 20 is probably safe). And assert each branch's mean ≥ min(argon2RefMs*0.7, ...)? Circular.

Simplest and robust set of assertions for the timing test:
1. `Math.abs(meanExisting - meanNew) < 40` (property: indistinguishable by timing).
2. `meanNew > argon2RefMs * 0.75` (the new branch is spending real hashing time — catches "hash skipped on new branch"; in that case meanNew ≈ floor 250 vs ref 100 → 250 > 75 passes! ugh, again the floor masks).

OK, I accept: with a response floor, a "skipped hash on one branch" is not a timing violation (the floor equalizes). So the timing test asserts the *property* (diff), which is exactly what the task asks ("tests that fail if the property is broken"). The property = unmeasurability of the branch via timing. If an implementation is leaky (diff large), the test fails. If the floor masks, the property holds, test passes — correct behavior!

Plus, to pin down requirement 3 (real cost) independently: a test that measures the *server-side* hashing cost? We can't easily observe internal hashing from HTTP… unless we look at the ghost generation at startup? Hmm. Alternative: assert both branches' mean ≥ 100ms — a floor-250 implementation trivially passes; a no-floor no-hash implementation fails (mean ~10 < 100 → fails). That pins down "something slow is happening on both branches" (either hashing or the floor — both acceptable mechanisms). And the diff pins down equivalence. Together: both branches are uniformly slow. A "skipped hash + floor" implementation: passes (property holds, acceptable). I think assertions {diff < 40ms, both means ≥ 100ms} are clean and defensible. Let me add `mean > 100` for both. Hmm, is 100 safe on the correct implementation? mean ≈ 250+ (floor) → safe. If someone legitimately set the floor to 80 and argon2 to 50 → mean ≈ 80-100 → borderline… but that's *my* implementation under test — it's deterministic: floor 250 → fine.

Sign-in timing test:
```ts
const N2 = 15;
const tWrong: number[] = []; const tUnknown: number[] = [];
const victim = `victim-${randomUUID()}@example.com`;
await signup seed victim with password 'victim-password-1';
for (i < N2) {
  tWrong.push(elapsedMs(sign-in victim, 'nope-password-' + i));
  tUnknown.push(elapsedMs(sign-in unknown-${randomUUID()}, 'nope-password-' + i));
}
diff < 40; both ≥ 100.
```

Total requests: 20*2 + 15*2 + a few ≈ 72 requests, each ≥250ms → ~20+ seconds. Plus seed. testTimeout: set `testTimeout: 180_000`, `hookTimeout: 120_000`. Vitest default hook timeout is 10s — beforeAll (app init + prisma connect + ghost hash ~100ms) is fine, but the setup file's `migrate deploy` is… setupFiles run per test file (not a hook) — their time counts against the first test? setup files run before the test file's tests; I think they're covered by `testTimeout`? To be safe, let me bump timeouts.

Also, pool: 'forks' vs. default threads — argon2 native module under worker_threads is fine. Let me use default pool (threads). Hmm, vitest 1.x default is 'threads'. Native argon2 in a worker thread — OK.

**vitest.config.ts**:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
```
Wait — `jsc.transform.decoratorMetadata`? In unplugin-swc options, the path is `jsc: { transform: { decoratorMetadata: true }, parser: {...} }`? Let me recall the NestJS + Vitest recipe from the community:

```ts
plugins: [swc.vite({ jsc: { transform: { decoratorMetadata: true }, parser: { syntax: 'typescript', tsx: false, decorators: true } } })]
```
Hmm, unplugin-swc exposes `swc` (and `swc.vite`?). The default export is the plugin factory. Options map to swc config: `jsc.transform.decoratorMetadata`. Actually, I recall `jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { decoratorMetadata: true } }`. Yes, that's the recipe I've seen. And module type es6 to keep ESM.

**package.json** — let me assemble:
```json
{
  "name": "auth-timing-equal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.19.0",
    "argon2": "^0.41.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "@swc/core": "^1.7.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.19.0",
    "supertest": "^7.0.0",
    "typescript": "^5.5.0",
    "unplugin-swc": "^1.4.4",
    "vitest": "^2.0.0"
  }
}
```
argon2 version: 0.41.x exists (0.41.1). Its types: I think argon2 0.41 includes TypeScript types? Hmm. The argon2 package added TS definitions in… I think the `argon2` package ships an `argon2.d.ts`? Not sure. Risk: if types are missing, TS strict build fails on `import * as argon2 from 'argon2'`. Mitigation: add `src/types/argon2.d.ts`? If the package ships types, an ambient shorthand would be ignored? Let me think about TS behavior: if you have `declare module 'argon2';` (shorthand) in a .d.ts, and the package also has a `types` field → TS resolves to the real types; the shorthand declaration is… I think if the module already resolves to a typed module, a duplicate shorthand declaration is an error ("Invalid module name in augmentation"? that's for `declare module 'x' { }` with a body). A pure shorthand with no body: TS docs: "shorthand declarations… are only usable in ambient contexts… when TypeScript resolves the module, if it finds a real one, the shorthand is ignored"? I don't really remember; it's risky either way.

Safer: don't import argon2 at the top level of TS-strictly-checked code?? No — I need it.

Alternative: use `createRequire`? no.

Let me confirm from memory: the `argon2` package on npm (by "jedisct1" C library, npm wrapper by "Codebox"? actually by "brendan"… whatever). I recall the README for `argon2@0.40`+ showing TypeScript usage without @types… and there's no `@types/argon2` on DefinitelyTyped (I don't think so; there's `@types/argon2-browser`). Hmm, I have a fairly strong recollection that the argon2 package includes its own TypeScript declarations (`index.d.ts`? or `argon2.d.ts`) — the repo (Mehmet? "argon2" github is by "jstad"?? no). GitHub repo: `Munz/argon2`? no… it's https://github.com/ranisalt/node-argon2 — by Ran Isaac (ranisalt). I think the repo root has `argon2.d.ts`? Ran's node-argon2 added TS definitions… I think so, it ships declarations (with the `types` field in package.json? or an adjacent .d.ts). I'll trust that argon2 ships types (fairly confident for 0.40+; the README has a TS example without @types). OK, I'll go with a plain import.

Hmm, and `import * as argon2 from 'argon2'` vs. `import argon2 from 'argon2'`? The package's main export: with the types, `export function hash(...)`, `export function verify(...)`, `export const argon2id`, etc. → namespace import works: `argon2.hash`, `argon2.verify`, `argon2.argon2id`. Even if the module uses `export =` (CJS-style), a namespace import requires `esModuleInterop`/allowSyntheticDefault. TS's `esModuleInterop: true` handles both. I'll assume esModuleInterop is true (standard in Nest templates).

**tsconfig.json** — should I deliver? The repo convention is strict TS ESM; a tsconfig likely exists. Delivering my own might clobber theirs. But without seeing it, my files must compile under *some* strict config. The risky bits: decorators (need experimentalDecorators), ESM (module nodenext / .js extensions — I used .js extensions which work under nodenext and bundler; but under `"module": "commonjs"` + `moduleResolution: "node10"`, would `.js`-suffixed relative imports error?? in node10 resolution, `./auth.service.js` → looks for auth.service.js.ts? no — under node10, TS maps `.js` → `.ts`? I think that mapping was added for node16/nodenext only… hmm, actually I recall TS supports the `.js` → `.ts` substitution even in classic/node10 mode? Let me think: TS 4.7+? The `.js` extension substitution works under `moduleResolution: node16/nodenext/bundler`. Under `node10`, I think `import from './x.js'` resolves to `./x.js` (literally), not x.ts → error "cannot find module './x.js'". Hmm, no — I actually think even in node10, TS tries the corresponding .ts for .js imports? I've seen errors on old configs with ESM-style .js imports. There was a change: TS always tries the substitution? `allowImportingTsExtensions`? no.

The convention says ESM `"type": "module"` → their tsconfig is almost certainly `module: nodenext` or `esnext`+`moduleResolution: bundler`. Under either, `.js` extensions work. Let me deliver a tsconfig.json matching the convention (strict, ESM/nodenext, decorators):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
```
`module: NodeNext` + `"type":"module"` → ESM output, .js extension imports required (I have them). `emitDecoratorMetadata: true` for DI. Good.

**test/setup.ts** (migration):
```ts
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to a PostgreSQL database for tests.');
}

execFileSync(join(rootDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
  cwd: rootDir,
  stdio: 'inherit',
});
```
This runs once per test file (setupFiles runs per file; I only have one spec file → once).

Hmm wait — setup files run before each test *file*; with one file, that's once. OK.

Also, the `prisma migrate deploy` in setup — vitest's transform handles setup.ts with swc — fine.

**One more design issue**: the ghost hash is computed in `onModuleInit` — in tests, the app init computes it (adds ~100ms once). Fine.

**Mail in tests**: `overrideProvider(MAIL_PORT).useValue(mailPort)` — MAIL_PORT is a string token provided by MailModule (imported via AuthModule). Override works. ✓

Wait — module wiring: AuthModule imports [PrismaModule, MailModule]. MailModule providers: [MAIL_PORT factory], exports [MAIL_PORT]. AuthModule providers: [AuthService, AuthRepository], controllers: [AuthController], exports: [AuthService]. ✓ Per the convention wiring.

MailModule factory — the "assumed to exist" port:
```ts
@Global()? no.
@Module({
  providers: [
    {
      provide: MAIL_PORT,
      useFactory: (): MailPort => ({
        // ASSUMPTION: the task statement assumes a working mail transport named
        // sendEmail already exists in the environment; the deployment binds the
        // real implementation here. Until then, every send fails loudly so that
        // misconfiguration is visible instead of silently dropping mail.
        sendEmail: async () => {
          throw new Error('MailPort is not bound to a transport; configure MAIL_PORT.');
        },
      }),
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
```
And the interface + token in the same file.

Hmm, "throw loudly" but fire-and-forget catches → logged. OK.

**SECURITY.md** (15–25 lines). Content: mechanism, why chosen over alternatives, what it doesn't protect against. Let me draft:

```md
# Enumeration resistance

## Mechanism
- Both branches of `POST /auth/sign-up` and `POST /auth/sign-in` perform exactly
  one `argon2id` verify/hash with identical parameters (19 MiB, 2 passes).
  Unknown addresses are checked against a precomputed "ghost" hash of a random
  secret, so the missing-user path costs the same CPU as the present-user path.
- Every response is padded with a 250 ms minimum-response-time floor, so
  residual differences (DB insert, hash-vs-verify overhead) cannot leak.
- The two branches return byte-identical status, body, and headers (202 for
  sign-up, 401 for sign-in); the real outcome is delivered only via email, and
  mail is sent asynchronously so transport latency never reaches the caller.

## Why this, not the alternatives
- A constant-time comparison of the two candidate hashes does not help: the
  leak is not in the comparison but in *skipping* the hash when the row is
  missing. Paying the full cost on both branches is the standard fix.
- Rate-limiting or a fixed artificial delay alone would still leave the
  hash-skip differential under load; it is used only as a backstop floor.
- Dummy rows / "register everyone" would let attackers create unbounded
  accounts; verifying against a ghost hash leaks nothing and creates nothing.

## What this does not protect against
- Account enumeration via the mail channel (the owner-visible emails differ by
  design) or via sign-in *success* (valid credentials still succeed).
- Side channels we do not control: network jitter, load balancers, and the
  caller's own clock; the 250 ms floor keeps the differential far below noise.
- Credential stuffing on sign-in beyond response equality: no lockout or
  throttle is implemented here.
```
Line count: let me count — it must be 15–25 lines. Let me count the draft… I'll count when finalizing; I'll aim for ~22 lines.

Let me count the draft lines:
1 `# Enumeration resistance`
2 (blank)
3 `## Mechanism`
4 `- Both branches...` (1 line)
5 `  Unknown addresses...`
6 `- Every response...`
7 `  residual differences...`
8 `- The two branches...`
9 `  mail is sent...`
10 (blank)
11 `## Why this, not the alternatives`
12 `- A constant-time...`
13 `  the leak...`
14 `- Rate-limiting...`
15 `  hash-skip...`
16 `- Dummy rows...`
17 `  accounts;...`
18 (blank)
19 `## What this does not protect against`
20 `- Account enumeration via the mail channel...`
21 `  design) or via sign-in...`
22 `- Side channels...`
23 `  the 250 ms floor...`
24 `- Credential stuffing...`

24 lines ✓ (15–25).

**Now, let me double-check the byte-equality details**:

- Express JSON response: body `{"message":"..."}` — Nest serializes via JSON.stringify → fixed string, same key order. ✓
- Content-Length: equal. ✓
- 202 vs 202 ✓.
- Any `Set-Cookie`? no. ✓
- `X-Powered-By`: both Express. ✓ (and identical).

Another potential leak: **the `date` header** is different (time) — not observable as a branch indicator beyond the time itself; it's the same as the timing measurement. Fine.

**Wait, one more important check**: sign-up new branch does `argon2.hash` and then `repository.create` — DB insert. Existing branch does `verify` and no write. The floor covers the diff. ✓

And sign-in success vs. failure: success returns 200, failure 401 — the status differs, that's required (an attacker *should* learn when the credentials are correct — that's the point of sign-in). The requirement only equates wrong password with unknown address. ✓

**Potential issue: the `@Inject(MAIL_PORT)` decorator with swc's decoratorMetadata** — fine.

**Potential issue: Nest 10 + vitest 2 + swc plugin version** — `unplugin-swc` ^1.4 works with vite 5/vitest 2. ✓

**Potential issue: `@nestjs/platform-express` + supertest** — `app.getHttpServer()` returns the express instance (Node server? getHttpServer returns an http.Server; supertest accepts it). ✓

**Potential issue: Prisma client generation** — `@prisma/client` needs `prisma generate` after install; the `@prisma/client` postinstall runs generate if a schema is found. And `migrate deploy` also runs generate? migrate deploy doesn't generate; but @prisma/client's postinstall does. And our setup runs migrate deploy before the tests import PrismaService → the client is generated at install time. But wait — `import { PrismaClient } from '@prisma/client'` at module load time: if the client isn't generated, it throws. pnpm install triggers the postinstall generate (schema at prisma/schema.prisma — default location ✓).

Hmm, and `prisma migrate deploy` in setup: requires the `prisma` CLI (devDep ✓) and the migrations folder ✓.

**Test ordering concern**: vitest runs tests within a file sequentially by default ✓. The seed request in `beforeAll`? I'll seed in-test. The timing test seeds its own unique victim. ✓

**Timing test flakiness**: 20 samples per branch, each ≥250ms. If CI is very loaded, some requests could exceed floor by a lot (GC, etc.), inflating one branch's mean alternately. Since we alternate (e existing, f new, e, f...), load affects both equally → the diff of means stays small. Tolerance 40ms — probably fine. Let me be safer at 60ms? The broken implementation would have a diff of ≥ ~80ms (hash cost ~100ms vs. ~0). Let me set the tolerance to 50ms: broken diff ≈ 80-120ms > 50 ✓ fails; correct diff ≈ 1-5ms < 50 ✓ passes with plenty of margin. Use 50.

Also, the "both ≥ 100ms" assertion: correct impl mean ≈ 255 → ✓.

Hmm wait, let me re-examine "both means ≥ 100": if the eval environment's CI is slow and the floor is 250 → 250 ≥ 100 ✓ always (floor is a lower bound on the response!). Actually, the floor guarantees every response ≥ 250ms − clock skew… setTimeout precision: setTimeout fires ~1ms late, not early → response ≥ 250ms (roughly). So the assertion mean ≥ 100 is trivially true with the floor. It only fails if the floor is removed and hashing is also skipped. Good, harmless pin.

**Byte comparison of the 401 response** (sign-in test 3): both 401 envelopes are identical JSON. ✓ Note: `rWrong.body.error.message` = 'Email or password is incorrect.' ✓ code 'invalid_credentials' ✓ details {} ✓.

**400 validation test**: body `{"error":{"code":"invalid_request","message":"...","details":{}}}`. I'll assert the shape with expect.objectContaining or strict equality of code/details. ✓

Now, let me also reconsider the **sign-up response status**: 202 vs 201. If a "new" address creates the account immediately, 201 Created is the honest status… but then an existing address also returns 201 (we don't create — but the response must be the same). 201 for something we didn't create is a bit dishonest but uniformity is the requirement. 202 "accepted, will email if applicable" is more honest. Let me go with 202.

And success status of sign-in: 200. ✓

**Now, the `vars` for mail**: `sendEmail(to, template, vars)` — I pass `{ email: to }`. Hmm, a verification email should contain a link/token? Out of scope; vars `{ email }` is enough. The template name is a constant.

**Let me reconsider whether the service is violating the "zero Prisma client calls" rule** — the service catches errors with `code === 'P2002'` — that's inspecting the repository's error, not calling the client. OK.

The repository only touches the DB ✓. The controller validates ✓.

**Let me write the final code.**

Wait, one more thing on the **import style for `argon2`** under NodeNext ESM: the argon2 package is CJS (main: index.js, bindings). NodeNext ESM importing CJS: `import argon2 from 'argon2'` (default = module.exports) or `import * as argon2` — under NodeNext, a namespace import from CJS gives a namespace with named exports detected by cjs-module-lexer + a default. `argon2.hash` should work via named detection… cjs-module-lexer detects `module.exports.hash = ...`? argon2's index.js does `module.exports = { hash, verify, ... }`? If it's an object literal assignment, the lexer handles common patterns… risk. Safer: `import argon2 from 'argon2'` (default import of CJS under esModuleInterop/NodeNext always works: default = module.exports). But if argon2 ships ESM types with named exports only (no default), then a default import might type-error… its .d.ts is likely `export declare function hash(...)` (named). Then `import argon2 from 'argon2'` requires a default export in types → error unless esModuleInterop + `allowSyntheticDefaultImports` (NodeNext implies esModuleInterop true → allows synthetic default). With esModuleInterop, the default import of a CJS module is typed via the synthetic default → allowed. And at runtime: default = module.exports ✓. So `import argon2 from 'argon2'` is safest at runtime and types OK under interop.

But hmm — `argon2.argon2id` (a constant for the type parameter) — exists: `argon2.argon2id` (number 2). ✓

Options type: `argon2.Options` — I pass an object literal; structural typing is fine. `type: argon2.argon2id` — number ✓.

Let me also double-check **`process.hrtime.bigint()`** availability — Node 20 ✓.

**Edge: sign-up where password length differs between the two branches** — argon2 time is roughly input-length-independent (memory-dominated); fine.

**Edge: unknown email at sign-in that's malformed** → validation 400 (same on both endpoints) ✓ doesn't reach the service.

Now — **the test file must "fail if the property is broken"**. My timing test measures through HTTP including the floor. If someone removes the floor AND the equalizing verify (existing branch: only findUser), existing ≈ 15-25ms, new ≈ 120ms → diff > 50 → fails ✓. If someone keeps the verify but removes the floor: diff = insert+hash-verify-overhead ≈ 2-8ms → passes (property holds ✓ correct). If someone keeps the floor and removes the verify: passes (property holds ✓). Good — the test pins down the property, not the mechanism.

Byte test catches body/status/header drift ✓. Email test catches the "neither may change what the caller observes" + the outcome reaching the owner ✓.

Let me also add a test that **repeated sign-up attempts on an existing address don't change the response over time** (idempotency of the contract) — implied; skip to keep the test focused.

**Count of lines for SECURITY.md** — I'll finalize at ~22-24 lines.

**Now let me also consider: should the service do the equalizing work before or after the DB write?** Order: findUser → (existing: verify | new: hash+create). In the new branch, the hash happens before the create. Total natural time: existing = find + verify; new = find + hash + create. The floor covers create+ε. ✓

**Potential subtlety**: `argon2.verify` on the ghost hash for a wrong password — verify returns false (doesn't throw). `argon2.verify` on a stored hash with the right password returns true (unused at sign-up). ✓

**Let me confirm the UnauthorizedException body** — I construct `new UnauthorizedException({ code: 'invalid_credentials', message: '...' })`. HttpException.getResponse() returns that object (if an object is passed) ✓ → the filter extracts code/message ✓ status 401 ✓.

**BadRequestException** in the controller is similar ✓ 400.

**Now, the full test file** — let me also confirm the imports: `type { MailPort }` from mail.module. The token string `MAIL_PORT`.

Let me think about **supertest + TS types**: `@types/supertest` v6: `import request from 'supertest'` (default export function). Response type: `request.Response`. ✓

**Buffer.compare** returns 0 if equal ✓.

Also, I'll assert on the sign-up response that `rNew.body.message` is a non-empty string? The byte comparison is sufficient + status. I'll also assert that the body contains a `message` key (a contract sanity): `expect(rNew.body).toEqual({ message: expect.any(String) })`? Note: strict object equality with expect.any works. Well — let me assert `typeof rNew.body.message === 'string'` for one. Fine.

**The timing helper** measures wall time including the HTTP round-trip — correct (what the attacker measures).

**One more consideration — `app.getHttpServer()` typing**: returns `http.Server`; supertest accepts it ✓. In Nest 10, `createNestApplication()` defaults to an express adapter (since platform-express is installed) ✓.

**beforeAll seed**: not needed globally; each test seeds what it needs. But the byte comparison test creates the existing via a seed sign-up — that seed also sends a verification mail (recorded) — fine.

Actually, one concern: **the sign-up test seeds the existing with password 'existing-pw-123' (17 chars ✓ ≥8)**.

**Password in the timing loop**: `pw-existing-${i}` — 13+ chars ✓.

**Email length** ≤ 254 ✓ (uuid-based ~45 chars).

Let me now write out the **full test file**:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.module.js';

type MailRecord = { to: string; template: string; vars: Record<string, string> };

const VERIFICATION_TEMPLATE = 'account-verification';
const DUPLICATE_TEMPLATE = 'duplicate-sign-up-attempt';

const SIGN_UP_PATH = '/auth/sign-up';
const SIGN_IN_PATH = '/auth/sign-in';

let app: INestApplication;
let server: import('http').Server;
const mails: MailRecord[] = [];

const mailPort: MailPort = {
  sendEmail: async (to, template, vars) => {
    mails.push({ to, template, vars });
  },
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await run();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function expectResponsesToBeIndistinguishable(a: request.Response, b: request.Response): void {
  expect(a.status, 'status').toBe(b.status);
  const bytesA = Buffer.from(a.text, 'utf8');
  const bytesB = Buffer.from(b.text, 'utf8');
  expect(Buffer.compare(bytesA, bytesB), 'body bytes').toBe(0);
  for (const header of ['content-type', 'content-length', 'x-powered-by']) {
    expect(a.headers[header], `header ${header}`).toBe(b.headers[header]);
  }
}

describe('sign-up enumeration resistance', () => {
  it('returns byte-identical responses for new and already-taken addresses', async () => {
    const taken = `taken-${randomUUID()}@example.com`;
    const fresh = `fresh-${randomUUID()}@example.com`;

    const seed = await request(server).post(SIGN_UP_PATH).send({ email: taken, password: 'taken-pw-12345' });
    expect(seed.status).toBe(202);

    const rTaken = await request(server).post(SIGN_UP_PATH).send({ email: taken, password: 'attacker-pw-12345' });
    const rFresh = await request(server).post(SIGN_UP_PATH).send({ email: fresh, password: 'attacker-pw-12345' });

    expect(rTaken.status).toBe(202);
    expect(rFresh.status).toBe(202);
    expectResponsesToBeIndistinguishable(rTaken, rFresh);
    expect(typeof rTaken.body?.message).toBe('string');
  });

  it('still delivers the real outcome through mail only', async () => {
    const taken = `owner-${randomUUID()}@example.com`;
    const fresh = `newbie-${randomUUID()}@example.com`;

    await request(server).post(SIGN_UP_PATH).send({ email: taken, password: 'owner-pw-12345' });
    const again = await request(server).post(SIGN_UP_PATH).send({ email: taken, password: 'other-pw-12345' });
    const freshRes = await request(server).post(SIGN_UP_PATH).send({ email: fresh, password: 'newbie-pw-12345' });
    expectResponsesToBeIndistinguishable(again, freshRes);

    const toOwner = mails.filter((m) => m.to === taken);
    expect(toOwner.some((m) => m.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toOwner.some((m) => m.template === DUPLICATE_TEMPLATE)).toBe(true);

    const toNewbie = mails.filter((m) => m.to === fresh);
    expect(toNewbie.every((m) => m.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toNewbie.some((m) => m.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toNewbie.some((m) => m.template === DUPLICATE_TEMPLATE)).toBe(false);
  });

  it('takes the same time on both branches across repeated samples', async () => {
    const SAMPLES = 20;
    const TIMING_TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP_PATH).send({ email: victim, password: 'victim-pw-12345' });

    const takenTimes: number[] = [];
    const freshTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      takenTimes.push(
        await elapsedMs(() => request(server).post(SIGN_UP_PATH).send({ email: victim, password: `taken-sample-pw-${i}` })),
      );
      freshTimes.push(
        await elapsedMs(() => request(server).post(SIGN_UP_PATH).send({ email: `fresh-timing-${randomUUID()}@example.com`, password: `fresh-sample-pw-${i}` })),
      );
    }

    const takenMean = mean(takenTimes);
    const freshMean = mean(freshTimes);

    expect(takenMean, `taken mean ${takenMean.toFixed(1)}ms must do real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(freshMean, `fresh mean ${freshMean.toFixed(1)}ms must do real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(Math.abs(takenMean - freshMean), `branch means differ by ${Math.abs(takenMean - freshMean).toFixed(1)}ms`).toBeLessThanOrEqual(TIMING_TOLERANCE_MS);
  });
});

describe('sign-in enumeration resistance', () => {
  it('returns byte-identical 401s for a wrong password and an unknown address', async () => {
    const known = `signin-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP_PATH).send({ email: known, password: 'known-pw-12345' });

    const rWrong = await request(server).post(SIGN_IN_PATH).send({ email: known, password: 'wrong-pw-12345' });
    const rUnknown = await request(server).post(SIGN_IN_PATH).send({ email: `ghost-${randomUUID()}@example.com`, password: 'wrong-pw-12345' });

    expect(rWrong.status).toBe(401);
    expectResponsesToBeIndistinguishable(rWrong, rUnknown);
    expect(rWrong.body).toEqual({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} } });
  });

  it('authenticates the legitimate owner', async () => {
    const known = `legit-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP_PATH).send({ email: known, password: 'legit-pw-12345' });

    const r = await request(server).post(SIGN_IN_PATH).send({ email: known, password: 'legit-pw-12345' });
    expect(r.status).toBe(200);
    expect(typeof r.body?.message).toBe('string');
  });

  it('takes the same time on both branches across repeated samples', async () => {
    const SAMPLES = 15;
    const TIMING_TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `signin-timing-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP_PATH).send({ email: victim, password: 'victim-pw-12345' });

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(await elapsedMs(() => request(server).post(SIGN_IN_PATH).send({ email: victim, password: `wrong-sample-pw-${i}` })));
      unknownTimes.push(await elapsedMs(() => request(server).post(SIGN_IN_PATH).send({ email: `no-user-${randomUUID()}@example.com`, password: `wrong-sample-pw-${i}` })));
    }

    const wrongMean = mean(wrongTimes);
    const unknownMean = mean(unknownTimes);
    expect(wrongMean).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(unknownMean).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(Math.abs(wrongMean - unknownMean)).toBeLessThanOrEqual(TIMING_TOLERANCE_MS);
  });
});

describe('request validation', () => {
  it('rejects malformed bodies with the standard error envelope', async () => {
    const r = await request(server).post(SIGN_UP_PATH).send({ email: 'not-an-email', password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_request');
    expect(r.body.error.details).toEqual({});
    expect(typeof r.body.error.message).toBe('string');
  });
});
```

Wait — the strict body equality in `expect(rWrong.body).toEqual({...})`: the message string must match exactly. My filter sets message from the exception body's message: 'Email or password is incorrect.' ✓. But is the message stable? I control it, yes.

Hmm, one risk: the `expectResponsesToBeIndistinguishable`'s x-powered-by — if express's `x-powered-by` is disabled in the future? Both would be undefined → `toBe(undefined)` both equal ✓ fine.

Timing test total: 20+20 + 15+15 = 70 requests × ≥250ms ≈ 18-25s + overhead. testTimeout 180s ✓.

The whole suite runtime is probably 30-40s. OK.

**Wait — a subtle bug risk in the timing test**: the fresh email is a new user per sample → a DB write each time; taken is read-only. Both are padded to the floor → fine.

**Another subtlety**: the `MIN_PLAUSIBLE_MS = 100` assertion — with the floor 250, both means are ≥ ~250 → ✓.

**Now, let me reconsider the `ghost` verification for the unknown email in sign-in**: `this.ghostHash` is a string computed at init ✓. If `onModuleInit` hasn't completed when the first request arrives? Nest awaits onModuleInit before app ready → ✓.

**Test `app.init()`** — waits for lifecycle hooks ✓ (ghost is hashed before tests run, ~100ms).

**Potential issue — Prisma `$connect` in onModuleInit in the test env**: DATABASE_URL is set (setup enforces) ✓.

**Now — the mail.module.ts file** full:

```ts
import { Module } from '@nestjs/common';

export const MAIL_PORT = 'MAIL_PORT';

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

@Module({
  providers: [
    {
      provide: MAIL_PORT,
      useFactory: (): MailPort => ({
        // ASSUMPTION: the task assumes a working `sendEmail` transport already
        // exists; the deployment binds the real implementation to this token.
        // The fallback fails loudly (and is logged by the caller) so a missing
        // binding is visible instead of silently dropping security-relevant mail.
        sendEmail: async () => {
          throw new Error('MailPort is not bound to a transport; provide a real sendEmail implementation for MAIL_PORT.');
        },
      }),
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
```

**auth.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

**prisma.service.ts**:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

**app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { HttpExceptionFilter } from './common/http-exception-filter.js';

@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
```

**The full service** — let me finalize with comments:

```ts
import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from '../mail/mail.module.js';

// argon2id at OWASP-recommended interactive parameters: 19 MiB, 2 passes,
// parallelism 1. Hashing and verifying with these parameters cost tens to
// hundreds of milliseconds, which is what makes the timing branches equal.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Every response is held for at least this long, so residual differences
// between branches (a DB insert, hash-vs-verify overhead) cannot leak in
// response time. It is a backstop on top of equal work, not a substitute.
const MIN_RESPONSE_MS = 250;

export const VERIFICATION_TEMPLATE = 'account-verification';
export const DUPLICATE_SIGN_UP_TEMPLATE = 'duplicate-sign-up-attempt';

const SIGN_UP_ACKNOWLEDGEMENT = 'If an account can be created for this address, a confirmation email is on its way.';
const SIGN_IN_ACKNOWLEDGEMENT = 'Signed in.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private ghostHash = '';

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // A hash of a random secret with the exact same parameters as real
    // password hashes. Verifying against it costs the same as verifying
    // against a real stored hash, so unknown addresses can be checked for
    // free of any timing information.
    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), HASH_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const existing = await this.repository.findByEmail(normalized);

    if (existing) {
      // Equalizing branch: spend one full argon2id run, exactly like the
      // new-address branch below. The result is discarded on purpose; the
      // response must not depend on it.
      await this.verifySafely(existing.passwordHash, password);
      this.queueMail(normalized, DUPLICATE_SIGN_UP_TEMPLATE);
    } else {
      const passwordHash = await argon2.hash(password, HASH_OPTIONS);
      try {
        await this.repository.create({ email: normalized, passwordHash });
      } catch (error) {
        // Lost a race for the same address: the winner just created the
        // account and sends the verification mail, so send nothing here.
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
      }
      this.queueMail(normalized, VERIFICATION_TEMPLATE);
    }

    await this.padToMinimum(startedAt);
    return { message: SIGN_UP_ACKNOWLEDGEMENT };
  }

  async signIn(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const user = await this.repository.findByEmail(normalized);

    // Exactly one argon2id run on every sign-in: the stored hash when the
    // address exists, the ghost hash when it does not.
    const candidate = user?.passwordHash ?? this.ghostHash;
    const matches = await this.matches(candidate, password);

    await this.padToMinimum(startedAt);

    if (user && matches) {
      return { message: SIGN_IN_ACKNOWLEDGEMENT };
    }
    throw new UnauthorizedException({
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }

  private async verifySafely(hash: string, password: string): Promise<void> {
    try {
      await argon2.verify(hash, password);
    } catch {
      // A corrupt stored hash must not leak through timing or errors: it is
      // treated as a non-match, exactly like a wrong password.
    }
  }

  private async matches(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async padToMinimum(startedAt: bigint): Promise<void> {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const remainingMs = MIN_RESPONSE_MS - elapsedMs;
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  // Fire-and-forget on purpose: the caller's response timing must never depend
  // on mail transport latency, and a mail failure must not change what the
  // caller observes.
  private queueMail(to: string, template: string): void {
    void this.mail
      .sendEmail(to, template, { email: to })
      .catch((error: unknown) => {
        this.logger.error(`could not send mail (template=${template})`, error instanceof Error ? error.stack : String(error));
      });
  }
}
```

Wait — sign-in: I pad before the throw and before the return. Both paths pad ✓.

Hmm — `SIGN_IN_ACKNOWLEDGEMENT = 'Signed in.'` — hmm, on success, the body is `{message: 'Signed in.'}`. Fine.

Now — a critical re-check of the **sign-up equalizing branch's hash choice**: for an existing address, we *verify* the attacker's password against the stored hash. Cost = one argon2 run ✓. Alternative: hash the input. Verify is fine and slightly more "real" (uses the stored parameters — if the stored hash has different parameters (say, an old cost), the cost could differ from a fresh hash! Edge: if an account was created with a different cost, the existing branch uses the stored parameters → different time than the new branch's fresh hash. To be strict, I should hash the input on the existing branch too (always `argon2.hash(password, HASH_OPTIONS)`) — then the cost is *guaranteed* identical to the new branch. But then we don't verify anything — do we care? No, the outcome is discarded. So: **existing branch: `await argon2.hash(password, HASH_OPTIONS)` (result discarded)**. That's the cleanest equalization — identical operation to the new branch. Yes, let me do that. Simpler and parameter-robust.

So the existing branch: `await argon2.hash(password, HASH_OPTIONS); // result discarded — pure timing equalization`. And the new branch: hash + store. Both branches: exactly one hash at HASH_OPTIONS.

And sign-in: unknown → ghost verify (the ghost has HASH_OPTIONS parameters ✓ cost ≈ a hash); known → stored verify (parameters = HASH_OPTIONS since we always create with them ✓). So sign-in branches are equal cost ✓.

Update the service accordingly:

```ts
if (existing) {
  // Timing-equalizing branch: run the same argon2id hash the new-address
  // branch will store. The digest is discarded on purpose — the response
  // must not depend on it in any way.
  await argon2.hash(password, HASH_OPTIONS);
  this.queueMail(normalized, DUPLICATE_SIGN_UP_TEMPLATE);
}
```

Good — remove verifySafely (no longer needed). Keep `matches` for sign-in.

**Now the ghost hash** — `randomBytes(32).toString('base64')` ✓.

**Re-verify the timing property on sign-up**: existing = find + hash + floor; new = find + hash + create + floor. Diff = create ≈ 1-5ms < floor slack ✓.

**Now the controller**: the shared `readCredentials` — both endpoints identical validation → a 400 response is identical across endpoints (not required but consistent).

Note: the controller returns `this.authService.signUp(...)` — a Promise — Nest handles it ✓. Return type annotation `Promise<{message: string}>` — but signUp is 202? The status is set via `@HttpCode(202)` — I have to set it! By default, `@Post` returns 201. I want 202. Add the `@HttpCode(202)` decorator on signUp. And sign-in success → default 201?? `@Post` default is 201! I need 200 → add `@HttpCode(200)`? Hmm, or return a body and use `@HttpCode(200)`. Yes:

```ts
@Post('sign-up')
@HttpCode(HttpStatus.ACCEPTED)
signUp(...)

@Post('sign-in')
@HttpCode(HttpStatus.OK)
signIn(...)
```
Import `HttpCode, HttpStatus`.

**Filter**: also handles exceptions thrown in the service (401) ✓ and 500s.

Now — **`details` in the envelope**: always `{}` ✓.

**Byte equality for 401**: `{"error":{"code":"invalid_credentials","message":"Email or password is incorrect.","details":{}}}` — same object each time → same JSON string ✓.

**Now let me re-check the `Buffer.compare` import in the test** — Buffer is global ✓.

**The supertest type of the response headers**: `a.headers[header]` — Response['headers'] is typed as `{ [key: string]: string }`? In @types/supertest it's from superagent: `headers: { [key: string]: string }` (actually from `http.IncomingHttpHeaders` where values can be string | string[] | undefined). `toBe` is fine. TS: `a.headers[header]` might be typed `string | string[] | undefined` — the comparison is fine, no type error (toBe accepts anything). ✓ But indexing with a variable key into IncomingHttpHeaders is OK ✓.

Hmm — `x-powered-by` in IncomingHttpHeaders? It's an arbitrary key; does the type allow it? `IncomingHttpHeaders` has an index signature `[key: string]: string | string[] | undefined` ✓.

**Now — the vitest swc plugin option key**: let me pin down exactly. From NestJS community recipes (e.g., "nestjs-vitest" gists):

```ts
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          decoratorMetadata: true,
        },
      },
      module: {
        type: 'es6',
      },
    }),
  ],
  test: { ... },
});
```
Yes, I'm fairly confident this shape is correct (`jsc.transform.decoratorMetadata`).

**Potential issue**: unplugin-swc requires `@swc/core` as a peer ✓ in devDeps.

**`import swc from 'unplugin-swc'`** — its main export: a plugin (also has `swc.vite`?). The default export is the transform plugin ✓.

**Now, the setup file and the prisma binary path** — in the pnpm case, `node_modules/.bin/prisma` exists ✓.

But hmm — does `execFileSync` with `stdio: 'inherit'` inside a vitest worker work? Yes.

Actually, wait: setupFiles in vitest run in the test worker (a thread). `execFileSync` blocks the thread — fine, one-time.

**Alternative** — run migrations in `globalSetup` instead? globalSetup runs in the main process; either works. setupFiles is fine.

**One more: vitest's `testTimeout`** applies to each test; the timing test takes ~12s (20×2×250ms + overhead ≈ 10-12s) ✓ < 180s.

**Prisma schema `@default(cuid())`** — TEXT column ✓ migration uses TEXT ✓.

**`@@map("users")`** ✓ migration CREATE TABLE "users" ✓.

**Migration folder name**: `prisma/migrations/20250101000000_init/migration.sql`. Any timestamp works. And `prisma/migrations/migration_lock.toml`:
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```
(The actual file has "i.e. Git"; fine.)

**Now — does `migrate deploy` need the shadow DB?** No, that's for `migrate dev`. Deploy just applies. ✓

**package.json scripts**: `"test": "vitest run"`. Also `"prisma:generate": "prisma generate"`? The postinstall handles it. Let me add `"postinstall": "prisma generate"` — pnpm runs postinstall in the root package ✓ ensures the client exists even if the @prisma/client postinstall doesn't fire (pnpm's strictness sometimes skips dependency postinstalls… actually pnpm runs dependency postinstalls by default (with a warning), but the root's postinstall is guaranteed). Adding a root postinstall: `"postinstall": "prisma generate"` is a common pattern ✓. But `prisma` is a devDep — postinstall runs after install, devDeps available ✓.

**Now — ESM `import 'reflect-metadata'` in main.ts** — needed for decorators/metadata (swc's emitDecoratorMetadata uses Reflect.decorate metadata; the `reflect-metadata` polyfill is needed by Nest) ✓. In tests, does @nestjs/testing pull in reflect-metadata? Does Nest's common import it? I think `@nestjs/common` imports 'reflect-metadata' internally (yes, NestJS requires reflect-metadata; does @nestjs/common's package.json have a dependency? historically apps import it in main; does @nestjs/core have a dependency on reflect-metadata? hmm. Nest docs say "install reflect-metadata" and import it in main.ts. @nestjs/common has a dependency on reflect-metadata? Let me recall… does @nestjs/common list `reflect-metadata` as a dependency? I don't think it's a peer; I think @nestjs/common does have a dependency on reflect-metadata… actually no — I remember Nest 9+ doesn't bundle it; the docs still say to import in main. To be safe, also `import 'reflect-metadata'` in the test file's top? Test files are transformed by vitest; the import is fine. Let me add it to the spec's first line. Harmless (idempotent).

**Decorator metadata + swc**: `@Inject(MAIL_PORT)` — explicit ✓; `@Controller`, `@Post` — swc emits them ✓; constructor params for DI rely on design:paramtypes — swc's decoratorMetadata: true emits them ✓ (that's the whole reason).

**AuthRepository constructor param `PrismaService`** — class, metadata ✓.

**Now, a potential TS strict issue**: `private ghostHash = '';` then assign in onModuleInit — under strict, use before assignment? Definite assignment: I initialize with '' so it's fine (the first request can't happen before init anyway).

**`HASH_OPTIONS` as const with `type: argon2.argon2id`** — `argon2.argon2id` is a `number` (2). Passing `{type: 2, ...}` to argon2.hash options — the type expects `type?: argon2.types`? If the d.ts types `type` as an enum-like union, a numeric literal is fine. With `as const`, `memoryCost: 19456` is a literal number ✓.

Hmm — `as const` on an object containing `argon2.argon2id` (a runtime constant, number) — the property's type becomes that constant's declared type ✓ fine.

Actually, let me not use `as const` — plain object, inferred as number ✓ simpler.

**Edge: `argon2.hash` return type** is Promise<string> ✓.

**Now, let me assemble the SECURITY.md at exactly 15–25 lines**. Let me write it carefully and count:

```
# Sign-up / sign-in enumeration resistance

## Mechanism
- `POST /auth/sign-up` and `POST /auth/sign-in` do exactly one argon2id run
  (19 MiB, 2 passes) on every branch. Unknown addresses are checked against a
  precomputed "ghost" hash of a random secret, so a missing row costs the same
  CPU as a present one, with no account created.
- Every response is held until a 250 ms floor has elapsed, so residual deltas
  (one branch inserts a row, the other does not) cannot show up in response
  time.
- The caller always sees byte-identical status, body, and headers (202 on
  sign-up, 401 on sign-in). The real outcome travels only through email, which
  is sent asynchronously so transport latency never reaches the response.

## Why this over the alternatives
- Comparing hashes in constant time does not fix the leak: the leak is the
  *skipped* hash when the row is absent. Paying the full cost on both branches
  is the standard fix (dummy-hash / dummy-login pattern).
- A fixed delay alone would still expose the hash-skip delta on loaded
  hardware; it is kept only as a backstop. Creating a dummy account for
  unknown addresses would let attackers mass-register and is avoided.

## What this does not protect against
- Enumeration through channels we do not control: the owner-visible emails
  differ by design, sign-in still succeeds with valid credentials, and
  network/LB jitter, rate limiting, or account lockouts are out of scope.
```

Count lines:
1 `# Sign-up / sign-in enumeration resistance`
2 ``
3 `## Mechanism`
4 `- \`POST /auth/sign-up\` and ... exactly one argon2id run`
5 `  (19 MiB, 2 passes) on every branch. Unknown addresses...`
6 `  CPU as a present one, with no account created.`
7 `- Every response is held until a 250 ms floor has elapsed, so residual deltas`
8 `  (one branch inserts a row, the other does not) cannot show up in response`
9 `  time.`
10 `- The caller always sees byte-identical status, body, and headers (202 on`
11 `  sign-up, 401 on sign-in). The real outcome travels only through email, which`
12 `  is sent asynchronously so transport latency never reaches the response.`
13 ``
14 `## Why this over the alternatives`
15 `- Comparing hashes in constant time does not fix the leak: the leak is the`
16 `  *skipped* hash when the row is absent. Paying the full cost on both branches`
17 `  is the standard fix (dummy-hash / dummy-login pattern).`
18 `- A fixed delay alone would still expose the hash-skip delta on loaded`
19 `  hardware; it is kept only as a backstop. Creating a dummy account for`
20 `  unknown addresses would let attackers mass-register and is avoided.`
21 ``
22 `## What this does not protect against`
23 `- Enumeration through channels we do not control: the owner-visible emails`
24 `  differ by design, sign-in still succeeds with valid credentials, and`
25 `  network/LB jitter, rate limiting, or account lockouts are out of scope.`

25 lines — right at the ceiling. "15–25 lines" — 25 is OK, but let me trim a bit for safety → make it 24. I'll compress line 25: merge 24-25. Let me restructure the last section:

```
## What this does not protect against
- Enumeration through other channels: the owner-visible emails differ by design,
  sign-in still succeeds with valid credentials, and network/LB jitter, rate
  limiting, and lockouts are out of scope.
```
→ 3 lines instead of 4 → total 24 ✓.

**Now, let me confirm all the files I'll deliver**:

1. `prisma/schema.prisma`
2. `prisma/migrations/20250101000000_init/migration.sql`
3. `prisma/migrations/migration_lock.toml`
4. `src/main.ts`
5. `src/app.module.ts`
6. `src/common/http-exception-filter.ts`
7. `src/prisma/prisma.module.ts`
8. `src/prisma/prisma.service.ts`
9. `src/mail/mail.module.ts`
10. `src/auth/auth.module.ts`
11. `src/auth/auth.controller.ts`
12. `src/auth/auth.service.ts`
13. `src/auth/auth.repository.ts`
14. `test/setup.ts`
15. `test/auth.spec.ts`
16. `SECURITY.md`
17. `package.json`
18. `tsconfig.json`
19. `vitest.config.ts`

Hmm — is package.json/tsconfig/vitest.config "files the task doesn't call for"? The task's deliverables list: Prisma schema + migrations, NestJS module, tests, SECURITY.md. But the top-level instruction: "deliver all files the solution needs". The solution needs a manifest for `argon2` + swc test dependencies. I'll include them. It's a judgment call; I think inclusion is more defensible than a broken dependency story. And "do not create files the task doesn't call for" — the task calls for a working solution; a manifest is part of that. Keep.

Also — `.env`? No, no secrets / no hardcoded connection strings; DATABASE_URL is from the environment ✓ (schema uses env()).

Wait — one more: **`src/common/`** — is this OK with the layout? The layout shows `src/<feature>/...` and specific files; a common filter is infrastructure. Fine.

Let me re-check the **filter file** typing under strict:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  404: 'resource_not_found',
  409: 'conflict',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODE_BY_STATUS[status] ?? 'error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        code = typeof body.code === 'string' ? body.code : CODE_BY_STATUS[status] ?? 'error';
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (Array.isArray(body.message)) {
          message = body.message.join('; ');
        }
      }
      if (status >= 500) {
        // Do not leak internals of unexpected errors.
        code = 'internal_error';
        message = 'An unexpected error occurred.';
      }
    } else {
      this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({ error: { code, message, details: {} } });
  }
}
```

`CODE_BY_STATUS[status] ?? 'error'` — indexing a Record<number,string> returns string (under strict, without noUncheckedIndexedAccess it's string; with noUncheckedIndexedAccess it's string|undefined → ?? handles ✓). Fine either way.

Unused `req` — I removed it ✓ (strict noUnusedLocals? if their tsconfig has noUnusedLocals, unused variables would error — I don't have any).

**Controller file**:

```ts
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: 'Request body must be a JSON object with "email" and "password".',
    });
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"email" must be a valid address of 3 to 254 characters.',
    });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"password" must be a string of 8 to 128 characters.',
    });
  }
  return { email, password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  signUp(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signIn(email, password);
  }
}
```

**Repository**:
```ts
import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: { email: string; passwordHash: string }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
      },
    });
  }
}
```
`import type { User } from '@prisma/client'` — generated ✓ (only after generate; fine).

**main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

**vitest.config.ts**:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
```

Hmm — unplugin-swc typing for the options: it accepts a SwcOptions-like; `jsc.transform.decoratorMetadata` — I'm fairly sure the option path is correct per the community recipe.

**test/setup.ts**:
```ts
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a PostgreSQL database in order to run the test suite.');
}

// Apply the committed migrations so the schema exists; the tests themselves
// use unique random emails, so no destructive reset is needed.
execFileSync(join(rootDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
  cwd: rootDir,
  stdio: 'inherit',
});
```

**spec** — add `import 'reflect-metadata';` as the first import.

Also — hmm, `app.getHttpServer()` type: in Nest 10 it returns `any`? `abstract: HttpServer`. supertest accepts `http.Server | string | number`. Type: `getHttpServer(): HttpServer` where HttpServer = any-ish. `let server: import('http').Server;` and `server = app.getHttpServer();` — assigning `any` to a typed var is fine ✓. Actually, let me type it as `server = app.getHttpServer() as import('node:http').Server;` for cleanliness. Or just `const server = app.getHttpServer();` after init — but I need it at module scope for the helpers… The helpers take a server param? I'll use a module-level `let server` and set it in beforeAll. Fine.

Wait, one concern: **Nest's default body parser** — express's json parser handles `Content-Type: application/json` — supertest's `.send(object)` sets JSON ✓.

**A subtle timing consideration**: `elapsedMs` wraps the whole supertest request (including the connection). supertest creates a new server connection per request (ephemeral) — includes TCP+TLS? no TLS. TCP handshake adds ~0.1-1ms, equal on both branches ✓.

**Now, let me reconsider the 250ms floor and the test tolerance 50ms**: both means ≈ 250 + small. The diff is typically < 5ms. ✓

**What if the CI machine is extremely slow and argon2 takes 800ms?** Then both branches ≈ 800-900; the diff is still small (both one hash + floor is irrelevant) ✓ passes. MIN_PLAUSIBLE 100 ✓.

**What if argon2 is very fast (20ms)?** Floor dominates 250 ✓.

OK. **Also confirm `process.hrtime.bigint()` inside the worker (vitest threads)** ✓.

**Potential pitfall**: in the sign-up timing test, the "fresh" emails each create a user + send a verification mail (stub is synchronous push) — fine.

**The byte comparison uses `a.text`** — supertest sets `.text` from the raw body ✓ (utf8).

**Now, package.json versions** — let me pick reasonably current, compatible ones:
- @nestjs/common/core/platform-express/testing: ^10.4.x (Nest 10 is stable; 11 exists but 10 is safe).
- rxjs ^7.8.1, reflect-metadata ^0.2.2 (required by Nest 10).
- @prisma/client & prisma: ^5.19.0 (or ^5.22). I'll use ^5.22.0.
- argon2: ^0.41.1.
- typescript ^5.6.2? For safety with swc, any 5.x. ^5.5.4.
- vitest ^2.1.1, @types/node ^20.16.x, supertest ^7.0.0, @types/supertest ^6.0.2, @types/express ^4.17.21, unplugin-swc ^1.4.7, @swc/core ^1.9.0.

Engines: node >=20 ✓ add an "engines" field.

**tsconfig**: `types: ["node"]` too? Not needed. `esModuleInterop: true` ✓. With module NodeNext, `esModuleInterop` is implicitly true? It's settable ✓ keep explicit.

Hmm, one more: `"module": "NodeNext"` requires `"moduleResolution": "NodeNext"` (implicit) ✓. And the package's "type": "module" → ESM ✓ my .js import extensions ✓.

But wait — **does vitest respect tsconfig's module NodeNext?** Vitest uses esbuild/swc for transforms (vite's dev-style resolution) — resolution is vite's: handles `.js` → `.ts` mapping ✓ (vite supports it).

**Now, re-check: no raw SQL in the service** ✓ (none). **No Prisma client calls in the service** ✓ (only the repository). **Controller zero business logic** — validation only ✓.

**Let me reconsider once more whether the sign-up response must be 201**… the requirement: "same status, same body, same headers" — any fixed choice works. 202 ✓.

**Also, requirement 5**: "existing address gets a 'someone tried to sign up with this address' email" — my DUPLICATE template is sent to the owner's address when an attacker re-signs-up ✓. "new gets a verification email" ✓. "neither may change what the caller observes" ✓ byte-identical + async.

Edge: on the *first* sign-up (new), the caller is the owner; they get a verification mail ✓.

**Now — a potential issue with the `queueMail` in the race-loser path**: I chose to skip mail on P2002. Let me re-verify my code: in the else branch, I catch P2002 and then fall through to `queueMail(normalized, VERIFICATION_TEMPLATE)` — wait, no! Look at my draft: the catch swallows P2002, then after the try/catch, it unconditionally calls `this.queueMail(normalized, VERIFICATION_TEMPLATE)`. That means the race loser *also* sends a verification email. Is that wrong? The account exists (winner's). The "owner" (the race winner's caller) already gets one; the loser's caller gets a duplicate verification mail to the same address. Harmless (same person? or two different people racing on the same address — the loser is a second claimant; sending them a verification mail for an account they don't own… slight info leak? "verification" mail implies an account exists — but they just tried to create one, and the response is identical either way. The mail tells them "an account exists at this address" — but they just tried to sign up with it; per the contract, existing → "someone tried to sign up" mail. So on race loss, the *correct* mail is the duplicate one (an existing address got a sign-up attempt). Hmm! Let me fix: on P2002, send DUPLICATE mail (the address already had an account the moment we lost the race). Or send nothing. Which is more correct? The semantics: "existing address gets someone-tried-to-sign-up". At the moment of loss, the address is existing → send duplicate. But the winner just sent verification… the owner gets both a verification and a duplicate warning a few ms apart. A bit noisy but semantically consistent. Alternatively, send nothing: the owner's verification already conveys the new account; the duplicate warning is redundant but is the "correct" outcome for the loser…

Honestly, either is defensible; let me pick: on race loss → send the duplicate-sign-up mail (consistent with "the address already exists now"). Hmm, wait — but is the race "existing"? The loser's request *is* the second sign-up attempt → yes, treat as existing branch outcome. Let me implement:

```ts
} else {
  const passwordHash = await argon2.hash(password, HASH_OPTIONS);
  let created = true;
  try {
    await this.repository.create({ email: normalized, passwordHash });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }
    created = false;
  }
  this.queueMail(normalized, created ? VERIFICATION_TEMPLATE : DUPLICATE_SIGN_UP_TEMPLATE);
}
```
Clean ✓.

**Now — let me finalize the exact text of the spec file** and make sure the assertion messages are fine.

Also — I should double-check `Test.createTestingModule({ imports: [AppModule] })` — AppModule has an APP_FILTER provider ✓ the filter is applied in tests too ✓.

**`overrideProvider(MAIL_PORT)`** — the provider exists in MailModule (imported transitively) ✓ override works.

**One risk**: `@nestjs/testing` overrideProvider requires the token to be a known provider ✓.

**Let me think about whether `app.close()` disconnects Prisma** — PrismaService's onModuleDestroy ✓.

**And `app.enableShutdownHooks()`** is only in main.ts; not needed in tests.

**Potential flake: the 401 strict body equality** — `message: 'Email or password is incorrect.'` — the service throws with exactly that ✓ filter passes through ✓.

**The 400 test** — `r.body.error.code` is 'invalid_request' ✓ (filter: status 400 → CODE_BY_STATUS[400]='invalid_request'; the body already has code 'invalid_request' ✓ same).

**Now, one more thought on the `expectResponsesToBeIndistinguishable` for the 401**: content-type is `application/json; charset=utf-8` on both ✓; content-length is equal (same body) ✓.

**And the 202 sign-up pair** ✓.

**Also let me consider adding a small "repeated attempts are stable" test** — e.g., two sign-ups to the same existing address are byte-equal (consistency over time). Cheap and nice:
```ts
it('is byte-stable across repeated attempts on the same taken address', ...)
```
Hmm — is that extra? "Do exactly what the task asks" — the tests asked: a timing test + byte comparison. I already have those plus the mail and sign-in and validation. Adding a 6th small test is reasonable (it's the same property, another angle). Let me fold it in: in the byte-identical test, do a second taken sign-up and compare all three? Keep it simple: compare rTaken1 and rTaken2 (both taken) — ensures no state drift (like a counter leaking into the body). Actually, my response has no state, so this is trivially passing… but it guards against future drift. It's cheap, let me include a second taken request and include it in the byte comparison. Well — I'll add: `rTakenAgain` and `expectResponsesToBeIndistinguishable(rTaken, rTakenAgain)`. Fine.

**Total number of test files**: one spec. Plus setup. ✓

**Let me now re-examine the format of the deliverable**: for each file: `### path` + a fenced block containing only the content. Language hint: use `ts`, `prisma`, `sql`, `toml`, `json`, `md`. "Nothing outside that pattern is read" → no prose at all. Start with the first heading.

**Order**: schema, migrations, src files, tests, SECURITY.md, configs.

Let me now write out the final content of every file, checking imports/exports/typing.

---

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  verified     Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

`prisma/migrations/20250101000000_init/migration.sql`:
```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

`prisma/migrations/migration_lock.toml`:
```toml
# Please do not edit this file manually
# It should be added in your version-control system (i.e. Git)
provider = "postgresql"
```

`src/main.ts` ✓ as above.

`src/app.module.ts` ✓.

`src/common/http-exception-filter.ts` ✓.

`src/prisma/prisma.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

`src/prisma/prisma.service.ts` ✓.

`src/mail/mail.module.ts` ✓ (interface + token + module).

`src/auth/auth.module.ts` ✓.

`src/auth/auth.controller.ts` ✓.

`src/auth/auth.service.ts` — finalize:

```ts
import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from '../mail/mail.module.js';

// argon2id with OWASP-recommended interactive parameters (19 MiB, 2 passes,
// parallelism 1). A single run costs tens to hundreds of milliseconds, which
// is what makes the two branches of each endpoint take the same time.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Every response is held until at least this much time has elapsed, so the
// small residual difference between branches (one of them also inserts a row)
// cannot be observed in the response time. It backs up the equal-work rule
// above; it is not a substitute for it.
const MIN_RESPONSE_MS = 250;

export const VERIFICATION_TEMPLATE = 'account-verification';
export const DUPLICATE_SIGN_UP_TEMPLATE = 'duplicate-sign-up-attempt';

const SIGN_UP_ACK = 'If an account can be created for this address, a confirmation email is on its way.';
const SIGN_IN_ACK = 'Signed in.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private ghostHash = '';

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // argon2id hash of a random secret with exactly the same parameters as
    // real password hashes. Verifying against it costs the same as verifying
    // against a real stored hash, so unknown addresses can be checked
    // without revealing their absence.
    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), HASH_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const existing = await this.repository.findByEmail(normalized);

    if (existing) {
      // Timing-equalizing branch: run the very same argon2id hash that the
      // new-address branch stores, and throw the result away. The response
      // must not depend on it in any way.
      await argon2.hash(password, HASH_OPTIONS);
      this.queueMail(normalized, DUPLICATE_SIGN_UP_TEMPLATE);
    } else {
      const passwordHash = await argon2.hash(password, HASH_OPTIONS);
      let created = true;
      try {
        await this.repository.create({ email: normalized, passwordHash });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        // Lost a race for the same address: the account now exists, so the
        // owner gets the duplicate-sign-up mail, not a verification mail.
        created = false;
      }
      this.queueMail(normalized, created ? VERIFICATION_TEMPLATE : DUPLICATE_SIGN_UP_TEMPLATE);
    }

    await this.padToMinimum(startedAt);
    return { message: SIGN_UP_ACK };
  }

  async signIn(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const user = await this.repository.findByEmail(normalized);

    // Exactly one argon2id run per sign-in: the stored hash when the address
    // exists, the ghost hash when it does not.
    const candidate = user?.passwordHash ?? this.ghostHash;
    const matches = await this.matches(candidate, password);

    await this.padToMinimum(startedAt);

    if (user !== null && matches) {
      return { message: SIGN_IN_ACK };
    }
    throw new UnauthorizedException({
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }

  private async matches(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async padToMinimum(startedAt: bigint): Promise<void> {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const remainingMs = MIN_RESPONSE_MS - elapsedMs;
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  // Deliberately fire-and-forget: the caller's response timing must never
  // depend on the mail transport, and a mail failure must never change what
  // the caller observes.
  private queueMail(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch((error: unknown) => {
      this.logger.error(
        `mail delivery failed (template=${template})`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
```

Check: `argon2.hash(password, HASH_OPTIONS)` — the type of HASH_OPTIONS: `{type: number; memoryCost: number; timeCost: number; parallelism: number}` vs. argon2.Options — structurally compatible ✓ (Options has optional fields with those names/types). `type: argon2.argon2id` — argon2id is a number constant ✓.

**The spec file** — finalize with reflect-metadata import, all tests as sketched. Also let me double-check the `request.Response` type import: `import request from 'supertest'` — the type namespace: `request.Response` — in @types/supertest, `Response` is a property (type) of the supertest interface? The type: `declare function supertest(app): supertest.SuperTest; namespace supertest { interface Response ... }`. So `request.Response` as a type works ✓ (commonly used).

The `server` variable: `import type { Server } from 'node:http'`.

beforeAll: `server = app.getHttpServer() as Server;`

Wait — `app.getHttpServer()`'s return type is `any` in Nest 10 (HttpServer = any). Casting is fine.

**Also, confirm the spec doesn't accidentally use the `PrismaService` import** — I removed direct DB use ✓.

**Now, let me compute the exact line count for the test file** — it's long (~200 lines) but that's fine.

**One more potential gotcha**: `expect(r.body.error.details).toEqual({})` ✓ the filter sets `{}`.

**And the sign-in strict body equality** — `rWrong.body` — supertest parsed the JSON ✓.

**The validation 400 test** uses the sign-up path; the message check `typeof ... === 'string'` ✓.

Now — **timing test fairness**: alternates taken/fresh in the loop ✓.

**Let me also think about GC pauses affecting one branch more** — with alternating samples, the mean diff stays small ✓ tolerance 50.

**Edge**: `MIN_PLAUSIBLE_MS = 100` — with the floor, guaranteed (250). ✓

I think the design is solid. Let me also re-verify **`process.hrtime.bigint()` in the service** under ESM Node ✓ global.

**The `setTimeout` return value is unused** — fine (no noUnusedExpressions issue; it's an await).

**`new Promise<void>((resolve) => setTimeout(resolve, remainingMs))`** — setTimeout's callback takes a number param; `resolve` takes 0 args — assignment-compatible? `setTimeout(resolve, ms)` — resolve: `(value: void | PromiseLike<void>) => void`; setTimeout's callback type: `(...args: any[]) => void` ✓ fine.

**The tsconfig `include` covers test/** ✓ so `tsc` type-checks the spec (does it need vitest types? vitest provides its own types via package ✓ @types/node ✓).

**package.json final**:
```json
{
  "name": "fieldtest-18-variant-a",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.22.0",
    "argon2": "^0.41.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@swc/core": "^1.9.2",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.6",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.6.3",
    "unplugin-swc": "^1.4.7",
    "vitest": "^2.1.4"
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Hmm — with module NodeNext + `"type":"module"`: `import argon2 from 'argon2'` — NodeNext treats argon2 (CJS, no "type" in its package.json) as CJS → default import = module.exports ✓ typed: if the argon2 d.ts is ESM-style named exports… under NodeNext, importing a CJS module: TS uses the module's own format. If argon2's package.json has no "type": "module", its .d.ts (if any) is interpreted as CJS → `import argon2 from 'argon2'` gives the default = export= ? If their d.ts uses `export declare function ...` (ESM style) but the file is CJS… TS handles CJS modules with named exports: default import is allowed under esModuleInterop (synthetic). ✓ It works.

If argon2 ships no types → TS error TS7016 (implicit any) under strict!! That would be a build-breaker. Hmm. How confident am I that argon2 ships types? Let me think hard. The node-argon2 repo (ranisalt/node-argon2): I recall the root files: `argon2.js`, `argon2_native.js`, `index.js`? and… I do recall there being `argon2.d.ts` in the repo. Yes — I'm fairly confident that recent versions include TypeScript definitions (the README has a "TypeScript" section? and `types` in package.json points to it). Going with this. If wrong, the fix is a one-liner .d.ts; I'll accept the risk. Actually — let me hedge cheaply: I can import via a small local wrapper? No, that's over-engineering. Or add a `src/types/argon2.d.ts` with a full manual declaration… if argon2 has real types, my ambient `declare module 'argon2' { ... }` with a body conflicts ("cannot redeclare"?). Ambient module declarations and resolved modules: TS prefers the actual module; a conflicting ambient declaration is an error? I think a wildcard/shorthand is ignored, but a full-body ambient for a module that resolves elsewhere would error. Too risky. I'll trust argon2's bundled types (0.41 has them — reasonably confident).

**Also — `@types/supertest` + `supertest` v7**: v7's types? supertest 7.0 ships without types; @types/supertest ^6.0.2 targets 6.x but works with 7 (types are version-tolerant) ✓ commonly used together.

**vitest 2 + vite 5**: vitest brings its own vite ✓ no explicit vite dep needed.

**unplugin-swc 1.4.7** — supports vite 5 ✓.

Now, **let me reconsider the setup file running `migrate deploy`**: if the migration has already been applied (re-run), deploy is a no-op ✓. If the DB is fresh, it creates the tables ✓.

**And the test DB needs to allow the connection** — assume the environment provides it (convention: env config).

**Final check of the spec: is there an "only happy path" test?** No — I have error paths (401, 400), byte equality, mail differentiation, timing. ✓ "Test the behaviour, not the implementation": I'm testing HTTP behavior ✓. I'm not asserting internal calls… the mail assertion is behavior (the mail that was delivered) ✓.

Let me also re-examine the **`expectResponsesToBeIndistinguishable` function name/usage** in the "mail" test: I compare `again` (taken) and `freshRes` (fresh) ✓ plus mail assertions ✓.

**One more detail**: in the byte-identical test, `rTaken.body?.message` — body is parsed `{message: string}` ✓.

**Potential issue**: supertest + Nest + Express 4 vs 5: @nestjs/platform-express@10 uses express 4 ✓ `x-powered-by` is present ✓.

**Let me write the spec out completely now** (in my head, final version):

```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  DUPLICATE_SIGN_UP_TEMPLATE,
  VERIFICATION_TEMPLATE,
} from '../src/auth/auth.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.module.js';

const SIGN_UP = '/auth/sign-up';
const SIGN_IN = '/auth/sign-in';

type MailRecord = { to: string; template: string; vars: Record<string, string> };

const mails: MailRecord[] = [];

const mailPort: MailPort = {
  sendEmail: async (to, template, vars) => {
    mails.push({ to, template, vars });
  },
};

let app: INestApplication;
let server: Server;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await app.close();
});

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await run();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The core property of this API: two responses for branches an attacker
 * cares about must be indistinguishable by status, by raw body bytes, and by
 * the headers a caller can read.
 */
function expectIndistinguishable(a: request.Response, b: request.Response): void {
  expect(a.status, 'status codes must match').toBe(b.status);
  const bytesA = Buffer.from(a.text, 'utf8');
  const bytesB = Buffer.from(b.text, 'utf8');
  expect(Buffer.compare(bytesA, bytesB), 'body bytes must be identical').toBe(0);
  for (const header of ['content-type', 'content-length', 'x-powered-by']) {
    expect(a.headers[header], `header ${header} must match`).toBe(b.headers[header]);
  }
}

describe('POST /auth/sign-up', () => {
  it('answers a new address and a taken address with byte-identical responses', async () => {
    const taken = `taken-${randomUUID()}@example.com`;
    const fresh = `fresh-${randomUUID()}@example.com`;

    const seed = await request(server).post(SIGN_UP).send({ email: taken, password: 'taken-pw-12345' });
    expect(seed.status).toBe(202);

    const firstAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const secondAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const freshAttempt = await request(server).post(SIGN_UP).send({ email: fresh, password: 'other-pw-12345' });

    expect(firstAttempt.status).toBe(202);
    expect(secondAttempt.status).toBe(202);
    expect(freshAttempt.status).toBe(202);

    expectIndistinguishable(firstAttempt, secondAttempt);
    expectIndistinguishable(firstAttempt, freshAttempt);
    expect(typeof firstAttempt.body?.message).toBe('string');
  });

  it('delivers the real outcome through mail while the caller sees the same thing', async () => {
    const owner = `owner-${randomUUID()}@example.com`;
    const newbie = `newbie-${randomUUID()}@example.com`;

    const first = await request(server).post(SIGN_UP).send({ email: owner, password: 'owner-pw-12345' });
    const retry = await request(server).post(SIGN_UP).send({ email: owner, password: 'intruder-pw-12345' });
    const signup = await request(server).post(SIGN_UP).send({ email: newbie, password: 'newbie-pw-12345' });

    expectIndistinguishable(retry, signup);
    expect(first.status).toBe(202);

    const toOwner = mails.filter((mail) => mail.to === owner);
    const toNewbie = mails.filter((mail) => mail.to === newbie);

    expect(toOwner.some((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toOwner.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(true);

    expect(toNewbie.length).toBeGreaterThan(0);
    expect(toNewbie.every((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toNewbie.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(false);
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 20;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const takenTimes: number[] = [];
    const freshTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      takenTimes.push(
        await elapsedMs(() => request(server).post(SIGN_UP).send({ email: victim, password: `taken-sample-${i}-pw` })),
      );
      freshTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_UP).send({ email: `fresh-timing-${randomUUID()}@example.com`, password: `fresh-sample-${i}-pw` }),
        ),
      );
    }

    const takenMean = mean(takenTimes);
    const freshMean = mean(freshTimes);

    expect(takenMean, `taken-address mean ${takenMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(freshMean, `new-address mean ${freshMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(takenMean - freshMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (taken=${takenMean.toFixed(1)} ms, fresh=${freshMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('POST /auth/sign-in', () => {
  it('answers a wrong password and an unknown address with byte-identical 401s', async () => {
    const known = `known-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'known-pw-12345' });

    const wrongPassword = await request(server).post(SIGN_IN).send({ email: known, password: 'wrong-pw-12345' });
    const unknownAddress = await request(server).post(SIGN_IN).send({ email: `unknown-${randomUUID()}@example.com`, password: 'wrong-pw-12345' });

    expect(wrongPassword.status).toBe(401);
    expectIndistinguishable(wrongPassword, unknownAddress);
    expect(wrongPassword.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} },
    });
  });

  it('still lets the legitimate owner in', async () => {
    const known = `legit-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'legit-pw-12345' });

    const ok = await request(server).post(SIGN_IN).send({ email: known, password: 'legit-pw-12345' });
    expect(ok.status).toBe(200);
    expect(typeof ok.body?.message).toBe('string');
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 15;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `signin-victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(
        await elapsedMs(() => request(server).post(SIGN_IN).send({ email: victim, password: `wrong-sample-${i}-pw` })),
      );
      unknownTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_IN).send({ email: `no-account-${randomUUID()}@example.com`, password: `wrong-sample-${i}-pw` }),
        ),
      );
    }

    const wrongMean = mean(wrongTimes);
    const unknownMean = mean(unknownTimes);

    expect(wrongMean, `wrong-password mean ${wrongMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(unknownMean, `unknown-address mean ${unknownMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(wrongMean - unknownMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (wrong=${wrongMean.toFixed(1)} ms, unknown=${unknownMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('request validation', () => {
  it('rejects malformed bodies with the standard error envelope', async () => {
    const bad = await request(server).post(SIGN_UP).send({ email: 'not-an-email', password: 'short' });

    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
    expect(typeof bad.body.error.message).toBe('string');
    expect(bad.body.error.details).toEqual({});
  });
});
```

Wait — I imported the template constants from auth.service — that's a cross-feature import for test clarity; fine (behavior level: the template names are part of the mail contract). OK.

`request.Response` — used as a type in the helper ✓.

One concern: **`expectIndistinguishable(firstAttempt, secondAttempt)`** — the two taken attempts: identical ✓ (same body).

**The `body?.message`** — `firstAttempt.body` type is any ✓.

**Now — timing: the whole suite** ≈ seed (7×250ms) + tests (3×~250×3) + timing (70×250ms ≈ 18s) + others ≈ 25-30s total. Vitest's default per-file timeout is fine.

**Potential flake**: the 401 strict body equality — the message string must match exactly. My filter sets message from the exception body's message: 'Email or password is incorrect.' ✓.

**Now, let me reconsider the `ghost` verification for the unknown email in sign-in** once more — already covered ✓.

**Let me re-count the lines of SECURITY.md** with the trimmed last section (24 lines) ✓ within 15–25.

**Format check**: each `### path` is immediately followed by a fenced block; no other prose. Fence language tags: ts/prisma/sql/toml/json/md. The parser takes only the path+block; the language tag is part of the fence — fine.

**Re-verify no duplicate paths** ✓.

**Order of files** — I'll present:
1. prisma/schema.prisma
2. prisma/migrations/20250101000000_init/migration.sql
3. prisma/migrations/migration_lock.toml
4. src/main.ts
5. src/app.module.ts
6. src/common/http-exception-filter.ts
7. src/prisma/prisma.module.ts
8. src/prisma/prisma.service.ts
9. src/mail/mail.module.ts
10. src/auth/auth.module.ts
11. src/auth/auth.controller.ts
12. src/auth/auth.service.ts
13. src/auth/auth.repository.ts
14. test/setup.ts
15. test/auth.spec.ts
16. SECURITY.md
17. package.json
18. tsconfig.json
19. vitest.config.ts

Let me do one last sanity pass on imports per file:

- main.ts: @nestjs/core, ./app.module.js ✓
- app.module.ts: @nestjs/common, @nestjs/core (APP_FILTER), ./auth/auth.module.js, ./common/http-exception-filter.js ✓
- http-exception-filter.ts: @nestjs/common, express types ✓
- prisma.module.ts: @nestjs/common, ./prisma.service.js ✓
- prisma.service.ts: @nestjs/common, @prisma/client ✓
- mail.module.ts: @nestjs/common ✓
- auth.module.ts: @nestjs/common, ../prisma/prisma.module.js, ../mail/mail.module.js, ./auth.controller.js, ./auth.service.js, ./auth.repository.js ✓
- auth.controller.ts: @nestjs/common, ./auth.service.js ✓
- auth.service.ts: @nestjs/common, node:crypto, argon2, ./auth.repository.js, ../mail/mail.module.js ✓
- auth.repository.ts: @nestjs/common, @prisma/client (type User), ../prisma/prisma.service.js ✓
- test/setup.ts: node builtins ✓
- test/auth.spec.ts: as above ✓
- vitest.config.ts: unplugin-swc, vitest/config ✓

**Wait — one more thing on the `@Inject(MAIL_PORT)` import**: I import `Inject` from @nestjs/common ✓ in the service.

**The strict TS detail in the controller**: destructuring `body as Record<string, unknown>` ✓.

**The filter**: `const payload = exception.getResponse();` — returns `string | object` ✓.

**`CODE_BY_STATUS[status] ?? 'error'`** — under strict without noUncheckedIndexedAccess, indexing a Record<number,string> gives string; `?? 'error'` — TS might warn "the left side is never nullish"? No, that's not an error (it's allowed; there's no such strict flag that errors on it). ✓

**`process.hrtime.bigint()`** typed ✓ @types/node.

**`1_000_000` numeric separator** ✓ ES2021+.

**The service's `setTimeout`** — the global from @types/node ✓.

**The `catch { }` optional binding** ✓ ES2019+.

I think we're good. Let me also confirm the **migration timestamp folder name** — any format works; I'll use `20250101000000_init`.

One more consideration on **the `verified` column**: the migration includes it ✓ the schema matches the migration exactly (columns: id TEXT, email TEXT, password_hash TEXT, verified BOOLEAN DEFAULT false, created_at TIMESTAMP(3), updated_at TIMESTAMP(3), PK users_pkey, unique users_email_key) ✓ Prisma's `migrate deploy` only applies; no drift check at deploy time. ✓

**`TIMESTAMP(3)`** matches Prisma's DateTime default precision ✓.

**Final: the "ASSUMPTION" comment** — the task says to mark genuinely absent symbols. The mail transport implementation is the one genuinely absent symbol. I've marked it in the mail.module.ts factory. Good — one clear ASSUMPTION at the point that matters. Any others? The sign-in success response shape is unspecified — I should mark that too? "Use the most defensible read and mark it with one `// ASSUMPTION:` comment at the point that matters". The success body on sign-in — add an ASSUMPTION comment in the service where SIGN_IN_ACK is defined:

```ts
// ASSUMPTION: the task specifies no token/session mechanism, so a successful
// sign-in returns a fixed 200 acknowledgement with no credentials.
const SIGN_IN_ACK = 'Signed in.';
```

Good — two marked assumptions, both at the point that matters.

Now, let me write out the final answer with exact format. No prose outside the pattern. Start with the first heading.

Also let me re-verify the fence contents contain no triple-backticks of their own ✓.

One more: in `test/setup.ts`, use `import.meta.url` — fine in ESM ✓ (tsconfig NodeNext + package type module ✓; vitest transforms it ✓).

And in the spec — `import type { Server } from 'node:http';` ✓.

The `app.getHttpServer() as Server` — getHttpServer returns `any` → cast OK.

Also — **`Test.createTestingModule` with `imports: [AppModule]`** — AppModule has APP_FILTER ✓.

Let me write it all out.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  verified     Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (i.e. Git)
provider = "postgresql"
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { HttpExceptionFilter } from './common/http-exception-filter.js';

@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
```

### src/common/http-exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  404: 'resource_not_found',
  409: 'conflict',
};

/**
 * Every error leaves the API through one envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODE_BY_STATUS[status] ?? 'error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        code = typeof body.code === 'string' ? body.code : CODE_BY_STATUS[status] ?? 'error';
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (Array.isArray(body.message)) {
          message = body.message.join('; ');
        }
      }
      if (status >= 500) {
        // Never leak internals of an unexpected error.
        code = 'internal_error';
        message = 'An unexpected error occurred.';
      }
    } else {
      this.logger.error(
        'unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ error: { code, message, details: {} } });
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/mail/mail.module.ts
```ts
import { Module } from '@nestjs/common';

export const MAIL_PORT = 'MAIL_PORT';

/**
 * The mail seam used by the auth feature. The task assumes a transport with
 * exactly this shape exists in the environment.
 */
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

@Module({
  providers: [
    {
      provide: MAIL_PORT,
      useFactory: (): MailPort => ({
        // ASSUMPTION: the real `sendEmail` transport is supplied by the
        // deployment and bound to this token; this fallback fails loudly so a
        // missing binding is visible instead of silently dropping mail.
        sendEmail: async () => {
          throw new Error('MailPort is not bound to a transport; provide a real sendEmail implementation for MAIL_PORT.');
        },
      }),
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

### src/auth/auth.controller.ts
```ts
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Input validation only. Both endpoints share it, so rejection responses are
 * identical regardless of which endpoint was called.
 */
function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: 'Request body must be a JSON object with "email" and "password".',
    });
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"email" must be a valid address of 3 to 254 characters.',
    });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"password" must be a string of 8 to 128 characters.',
    });
  }
  return { email, password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  signUp(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signIn(email, password);
  }
}
```

### src/auth/auth.service.ts
```ts
import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from '../mail/mail.module.js';

// argon2id with OWASP-recommended interactive parameters (19 MiB, 2 passes,
// parallelism 1). One run costs tens to hundreds of milliseconds, which is
// what makes the branches of each endpoint take the same amount of time.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Every response is held until at least this much time has elapsed, so the
// small residual difference between branches (one of them also inserts a row)
// cannot be observed in response time. It backs up the equal-work rule above;
// it is not a substitute for it.
const MIN_RESPONSE_MS = 250;

export const VERIFICATION_TEMPLATE = 'account-verification';
export const DUPLICATE_SIGN_UP_TEMPLATE = 'duplicate-sign-up-attempt';

const SIGN_UP_ACK = 'If an account can be created for this address, a confirmation email is on its way.';

// ASSUMPTION: the task specifies no token/session mechanism, so a successful
// sign-in answers with a fixed 200 acknowledgement and no credentials.
const SIGN_IN_ACK = 'Signed in.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private ghostHash = '';

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // argon2id hash of a random secret with exactly the same parameters as
    // real password hashes. Verifying against it costs the same as verifying
    // against a real stored hash, so an unknown address can be checked
    // without revealing its absence.
    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), HASH_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const existing = await this.repository.findByEmail(normalized);

    if (existing) {
      // Timing-equalizing branch: run the very same argon2id hash that the
      // new-address branch stores, and throw the result away. The response
      // must not depend on it in any way.
      await argon2.hash(password, HASH_OPTIONS);
      this.queueMail(normalized, DUPLICATE_SIGN_UP_TEMPLATE);
    } else {
      const passwordHash = await argon2.hash(password, HASH_OPTIONS);
      let created = true;
      try {
        await this.repository.create({ email: normalized, passwordHash });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        // Lost a race for the same address: the account now exists, so the
        // owner gets the duplicate-sign-up mail instead of a second
        // verification mail.
        created = false;
      }
      this.queueMail(normalized, created ? VERIFICATION_TEMPLATE : DUPLICATE_SIGN_UP_TEMPLATE);
    }

    await this.padToMinimum(startedAt);
    return { message: SIGN_UP_ACK };
  }

  async signIn(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const user = await this.repository.findByEmail(normalized);

    // Exactly one argon2id run per sign-in: the stored hash when the address
    // exists, the ghost hash when it does not.
    const candidate = user?.passwordHash ?? this.ghostHash;
    const matches = await this.matches(candidate, password);

    await this.padToMinimum(startedAt);

    if (user !== null && matches) {
      return { message: SIGN_IN_ACK };
    }
    throw new UnauthorizedException({
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }

  private async matches(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async padToMinimum(startedAt: bigint): Promise<void> {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const remainingMs = MIN_RESPONSE_MS - elapsedMs;
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  // Deliberately fire-and-forget: the caller's response timing must never
  // depend on the mail transport, and a mail failure must never change what
  // the caller observes.
  private queueMail(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch((error: unknown) => {
      this.logger.error(
        `mail delivery failed (template=${template})`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: { email: string; passwordHash: string }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
      },
    });
  }
}
```

### test/setup.ts
```ts
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a PostgreSQL database in order to run the test suite.');
}

// Apply the committed migrations so the schema exists. The tests use unique
// random emails, so no destructive reset is needed.
execFileSync(join(rootDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
  cwd: rootDir,
  stdio: 'inherit',
});
```

### test/auth.spec.ts
```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DUPLICATE_SIGN_UP_TEMPLATE, VERIFICATION_TEMPLATE } from '../src/auth/auth.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.module.js';

const SIGN_UP = '/auth/sign-up';
const SIGN_IN = '/auth/sign-in';

type MailRecord = { to: string; template: string; vars: Record<string, string> };

const mails: MailRecord[] = [];

const mailPort: MailPort = {
  sendEmail: async (to, template, vars) => {
    mails.push({ to, template, vars });
  },
};

let app: INestApplication;
let server: Server;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await app.close();
});

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await run();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The core property of this API: responses for the two branches an attacker
 * cares about must be indistinguishable by status, by raw body bytes, and by
 * the headers a caller can read.
 */
function expectIndistinguishable(a: request.Response, b: request.Response): void {
  expect(a.status, 'status codes must match').toBe(b.status);
  const bytesA = Buffer.from(a.text, 'utf8');
  const bytesB = Buffer.from(b.text, 'utf8');
  expect(Buffer.compare(bytesA, bytesB), 'body bytes must be identical').toBe(0);
  for (const header of ['content-type', 'content-length', 'x-powered-by']) {
    expect(a.headers[header], `header ${header} must match`).toBe(b.headers[header]);
  }
}

describe('POST /auth/sign-up', () => {
  it('answers a new address and a taken address with byte-identical responses', async () => {
    const taken = `taken-${randomUUID()}@example.com`;
    const fresh = `fresh-${randomUUID()}@example.com`;

    const seed = await request(server).post(SIGN_UP).send({ email: taken, password: 'taken-pw-12345' });
    expect(seed.status).toBe(202);

    const firstAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const secondAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const freshAttempt = await request(server).post(SIGN_UP).send({ email: fresh, password: 'other-pw-12345' });

    expect(firstAttempt.status).toBe(202);
    expect(secondAttempt.status).toBe(202);
    expect(freshAttempt.status).toBe(202);

    expectIndistinguishable(firstAttempt, secondAttempt);
    expectIndistinguishable(firstAttempt, freshAttempt);
    expect(typeof firstAttempt.body?.message).toBe('string');
  });

  it('delivers the real outcome through mail while the caller sees the same thing', async () => {
    const owner = `owner-${randomUUID()}@example.com`;
    const newbie = `newbie-${randomUUID()}@example.com`;

    const first = await request(server).post(SIGN_UP).send({ email: owner, password: 'owner-pw-12345' });
    const retry = await request(server).post(SIGN_UP).send({ email: owner, password: 'intruder-pw-12345' });
    const signup = await request(server).post(SIGN_UP).send({ email: newbie, password: 'newbie-pw-12345' });

    expect(first.status).toBe(202);
    expectIndistinguishable(retry, signup);

    const toOwner = mails.filter((mail) => mail.to === owner);
    const toNewbie = mails.filter((mail) => mail.to === newbie);

    expect(toOwner.some((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toOwner.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(true);

    expect(toNewbie.length).toBeGreaterThan(0);
    expect(toNewbie.every((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toNewbie.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(false);
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 20;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const takenTimes: number[] = [];
    const freshTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      takenTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_UP).send({ email: victim, password: `taken-sample-${i}-pw` }),
        ),
      );
      freshTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_UP).send({
            email: `fresh-timing-${randomUUID()}@example.com`,
            password: `fresh-sample-${i}-pw`,
          }),
        ),
      );
    }

    const takenMean = mean(takenTimes);
    const freshMean = mean(freshTimes);

    expect(takenMean, `taken-address mean ${takenMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(freshMean, `new-address mean ${freshMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(takenMean - freshMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (taken=${takenMean.toFixed(1)} ms, fresh=${freshMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('POST /auth/sign-in', () => {
  it('answers a wrong password and an unknown address with byte-identical 401s', async () => {
    const known = `known-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'known-pw-12345' });

    const wrongPassword = await request(server).post(SIGN_IN).send({ email: known, password: 'wrong-pw-12345' });
    const unknownAddress = await request(server).post(SIGN_IN).send({
      email: `unknown-${randomUUID()}@example.com`,
      password: 'wrong-pw-12345',
    });

    expect(wrongPassword.status).toBe(401);
    expectIndistinguishable(wrongPassword, unknownAddress);
    expect(wrongPassword.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} },
    });
  });

  it('still lets the legitimate owner in', async () => {
    const known = `legit-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'legit-pw-12345' });

    const ok = await request(server).post(SIGN_IN).send({ email: known, password: 'legit-pw-12345' });
    expect(ok.status).toBe(200);
    expect(typeof ok.body?.message).toBe('string');
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 15;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `signin-victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_IN).send({ email: victim, password: `wrong-sample-${i}-pw` }),
        ),
      );
      unknownTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_IN).send({
            email: `no-account-${randomUUID()}@example.com`,
            password: `wrong-sample-${i}-pw`,
          }),
        ),
      );
    }

    const wrongMean = mean(wrongTimes);
    const unknownMean = mean(unknownTimes);

    expect(wrongMean, `wrong-password mean ${wrongMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(unknownMean, `unknown-address mean ${unknownMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(wrongMean - unknownMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (wrong=${wrongMean.toFixed(1)} ms, unknown=${unknownMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('request validation', () => {
  it('rejects malformed bodies with the standard error envelope', async () => {
    const bad = await request(server).post(SIGN_UP).send({ email: 'not-an-email', password: 'short' });

    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
    expect(typeof bad.body.error.message).toBe('string');
    expect(bad.body.error.details).toEqual({});
  });
});
```

### SECURITY.md
```md
# Sign-up / sign-in enumeration resistance

## Mechanism
- `POST /auth/sign-up` and `POST /auth/sign-in` perform exactly one argon2id
  run (19 MiB, 2 passes) on every branch. Unknown addresses are checked
  against a precomputed "ghost" hash of a random secret, so a missing row
  costs the same CPU as a present one, without creating any account.
- Every response is held until a 250 ms floor has elapsed, so the residual
  delta (one branch inserts a row, the other does not) cannot show up in
  response time.
- The caller always sees byte-identical status, body, and headers (202 on
  sign-up, 401 on sign-in). The real outcome travels only through email,
  which is sent asynchronously so transport latency never reaches the caller.

## Why this over the alternatives
- Constant-time comparison of candidate hashes does not fix the leak: the
  leak is the *skipped* hash when the row is absent. Paying the full cost on
  both branches (dummy-hash / dummy-login pattern) is the standard fix.
- A fixed delay alone would still expose the hash-skip delta under load; the
  floor is kept only as a backstop. Creating dummy accounts for unknown
  addresses would let attackers mass-register and is avoided.

## What this does not protect against
- Enumeration through other channels: the owner-visible emails differ by
  design, sign-in still succeeds with valid credentials, and network/LB
  jitter, rate limiting, and account lockouts are out of scope.
```

### package.json
```json
{
  "name": "fieldtest-18-variant-a",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.22.0",
    "argon2": "^0.41.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@swc/core": "^1.9.2",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.6",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.6.3",
    "unplugin-swc": "^1.4.7",
    "vitest": "^2.1.4"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### vitest.config.ts
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
```
