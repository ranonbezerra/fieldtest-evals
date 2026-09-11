# solution

## reasoning

```
Let me organize what's needed. This task is to build the following:

1. Prisma schema + migration
2. NestJS module: controller, service, repository
3. Tests: timing test comparing two branches over multiple samples, byte comparison of responses, a test that fails if the timing equalization is removed, a test that fails if hashing is removed, a test that mail failures are invisible to the caller
4. `SECURITY.md` (15–25 lines)

Main requirements:
- `POST /auth/sign-up` — `{ email, password }`. New address creates the account. Existing address returns the same response (same status, body, headers).
- `POST /auth/sign-in` — `{ email, password }`. Wrong password and unknown address return the same response.
- Passwords hashed with argon2id or bcrypt at a real cost factor.
- Timing: an observer must not be able to distinguish the branches → both branches do the same work (dummy hash verification with the same parameters).
- Email: existing address → "someone tried to sign up with your address"; new address → verification email. Out-of-band, not awaited on the response path, mail failures are invisible.

Conventions:
- TypeScript strict, Node 20+, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM `"type": "module"`.
- Layout: `prisma/schema.prisma`, `src/main.ts`, `src/app.module.ts`, `src/<feature>/<feature>.module.ts`, controller, service, repository, `test/<feature>.spec.ts`.
- Layers: controller validates input and calls the service, zero business logic. Service has the logic, zero raw SQL, zero Prisma client calls. Repository is the only layer that touches the database.
- Naming: tables/columns snake_case via `@map`/`@@map`. Endpoints kebab-case, plural... wait, "Endpoint: `kebab-case`, plural." But the task says `POST /auth/sign-up` and `POST /auth/sign-in`. The task explicitly gives the endpoints. The convention says kebab-case, plural endpoints, but the task statement carries everything else, and the task explicitly says `POST /auth/sign-up`. The task takes priority — the task gives the exact endpoint paths. So I'll use `/auth/sign-up` and `/auth/sign-in`. Hmm, "plural" — sign-up/sign-in are verbs and don't pluralize cleanly. The task statement explicitly specifies the endpoints, so I'll follow the task.

- Error envelope: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }`.
- Wiring: providers/exports/imports.
- Migration: every schema change ships with a migration.
- Tests: Vitest, test behavior, don't just assert calls happened.
- Environment: config from env vars only, `DATABASE_URL`.

Now the design:

**Dummy hash approach**: The standard approach (from OWASP):
- Precompute a dummy hash with the same argon2id parameters.
- On sign-up: if the email exists, verify the supplied password against the existing user's stored hash? Wait, no. Let me think carefully.

Sign-up: the attacker sends `{ email, password }`.
- If email is new: create account with hashed password → hash cost.
- If email is existing: don't change anything, send "someone tried" email. But we need to do hash work to equalize timing. What do we hash? Options:
  a. Verify the supplied password against the existing user's stored hash. This does real work and reveals... wait, does it leak anything to the attacker? The attacker observes only time. Verification takes the same time as hashing. But subtle point: `argon2.verify` takes the same time as `argon2.hash` (argon2 verification is essentially hashing and comparing, roughly the same cost). So timing is equalized. But does verifying against the real hash leak info? The response is identical anyway. Timing: verify and hash take ~the same time. Actually there's a subtle difference: verify does hash + timingSafeEqual compare, marginally longer, but within noise. Many implementations use a dummy hash for both branches.

  b. Hash the supplied password against a fixed dummy salt (i.e. `argon2.hash(password, {salt: DUMMY_SALT, ...})`), or `argon2.verify(password, DUMMY_HASH)` where DUMMY_HASH is precomputed.

  The spec says: "the branch that has no hash to check must pay the same cost regardless — verify against a dummy hash generated with the same parameters". So the sign-up branch for the existing address: `verify(suppliedPassword, DUMMY_HASH)` (DUMMY_HASH = argon2id with same params, generated at startup or precomputed constant... but a precomputed constant hash would be fine too. Better to generate at module init with the same params).

  Actually a cleaner unified approach for sign-up:
  ```
  const user = await repo.findByEmail(email);
  if (user) {
    // do dummy verification to burn time
    await argon2.verify(password, DUMMY_HASH).catch(() => {});
    // send "tried to sign up" email (out of band)
  } else {
    const hash = await argon2.hash(password, params);
    await repo.create({ email, passwordHash: hash });
    // send verification email (out of band)
  }
  return sameResponse;
  ```

  But wait — timing: the `user` branch does verify (~hash cost). The `new` branch does hash (~hash cost). Both one argon2 operation. Good. Also the DB lookups differ slightly (existing row vs not) but that's a few ms vs argon2's ~100ms; with a proper cost factor it's noise. Should be fine.

  Alternative: always hash and then check existence:
  ```
  const hash = await argon2.hash(password, params);
  const user = await repo.findByEmail(email);
  if (user) { send tried-email; } else { await repo.create(...); send verification-email; }
  ```
  This always does one hash. This is actually the cleanest equalization: every request does exactly one hash, regardless of branch. Then the branch difference is only the presence/absence of the insert, which is negligible.

  But for sign-in:
  ```
  const user = await repo.findByEmail(email);
  if (user) {
    const ok = await argon2.verify(password, user.passwordHash);
    if (ok) → success
    else → error
  } else {
    await argon2.verify(password, DUMMY_HASH); // burn time
    → error
  }
  ```
  Here the unknown-address branch must verify against a dummy hash.

  For sign-up, "always hash first" works and is elegant: one hash per request, always. Let me reconsider though: does hashing before the DB lookup change observable behavior? No.

  But wait — there's a subtle point on the sign-up "existing" branch: even if we hash and discard, it's fine. The response is the same. Timing: both branches do one hash.

  However the spec (L2) says: "the branch that has no hash to check must pay the same cost regardless — verify against a dummy hash generated with the same parameters. Both paths then take the time of a hash, because both paths did one." This describes the sign-in case (no hash to check → dummy verify). For sign-up, "always hash" also satisfies "both paths did one [hash]". Either approach works. I'll do:

  - Sign-up: hash password (always), check DB, create or not. Both branches: exactly one argon2 hash.
  - Sign-in: look up user; if found verify against stored hash; if not verify against dummy hash. Both branches: exactly one argon2 verify.

  Wait, for sign-up should I verify against the existing user's hash instead of hashing fresh? Hashing fresh is fine and simpler, plus avoids any concern about comparing against a real hash. And `argon2.hash` and `argon2.verify` have equivalent costs.

  Hmm, one consideration: in sign-up, should we do the hash before or after the DB query? If the hash first, then both branches spend hash time before the DB call — good, uniform. If after, the "existing" branch is lookup + verify, the "new" branch is lookup + insert + hash — the hash timing interleaves differently, but total is the same. Either works. I'll hash first (or concurrently? no, keep it simple: hash first, then lookup). Actually, hashing first delays the DB lookup a bit; that's fine.

  Alternatively, do the DB lookup and the hash concurrently with `Promise.all`? That reduces latency, but the branch asymmetry remains (the new branch has an extra insert). Simpler to keep sequential: hash, lookup, branch. Both branches pay for one argon2 op.

**Dummy hash**: generated at service construction with the same params:
```ts
private readonly dummyHash: string;
constructor() {
  // generated at init
}
```
But construction is sync; argon2 hash is async. Options:
- Precompute a constant hash string (offline with the same params). A constant in the code is fine — it's a dummy, not secret. But it needs to match the params. I could write a known constant. But hand-generating a valid argon2 PHC string without running the code is risky. Better: lazily generate with an async init (NestJS's `onModuleInit` or a `beforeInit` async), or use `@Injectable` with an async constructor... Nest supports async constructor injection but it's unusual. Cleaner: `async onModuleInit()` to create the dummy hash, and tests await app.init() which triggers module init.

  Actually with supertest against the Nest app via `app.inject` or `app.getHttpServer()`, `app.init()` (or `app.listen`) runs `onModuleInit`. So generating the dummy in `onModuleInit` works.

  But there's a pitfall: requests before the dummy is ready → service must be robust. `onModuleInit` completes before `listen` accepts, so fine.

  Alternative: use `bcrypt` with a precomputed dummy hash constant (bcrypt hashes have a fixed 60-char format and a known dummy exists widely, e.g. `$2b$10$...`). But I can't hand-verify a real bcrypt hash. Safer to generate at init with argon2.

  Let me use `argon2` npm package, `argon2.hash` with `type: argon2.argon2id`, `memoryCost`, `timeCost`, `parallelism`. Real cost factor: e.g. `timeCost: 3, memoryCost: 65536` (64 MiB) — OWASP recommends m=19456 KiB (19 MiB), t=2 for argon2id as of 2024. For a timing test in CI, argon2 with m=19456, t=2, p=1 takes about 50-100ms per op. That's reasonable: a timing test of say 10 samples each takes 10*2*~80ms = ~1.6s. Fine.

  But the test environment: `argon2` native module — is it available? In a real repo, yes, `pnpm add argon2`. I'll assume it's in package.json. I don't see the repo files beyond the reference, so I need to deliver a full solution. The task says "build the full solution in one reply" and the layout section is generic. No existing files are given (the reference blocks are task material, not codebase files). So I create everything: package.json? Hmm. "Deliver every file the solution needs" — the deliverables list: Prisma schema + migration, NestJS module (controller, service, repository), tests, SECURITY.md. Plus the wiring: `src/main.ts`, `src/app.module.ts` are in the layout convention, so they're part of a runnable app. The mail port `sendEmail(to, template, vars): Promise<void>` is assumed to exist — I need to define its interface. "Assume the mail port exists" — so I define the interface/type and inject it. In tests I mock it. I should define a token for DI. E.g. `MAIL_SERVICE` injection token and a `MailPort` interface. But "assume exists" means I don't implement it; just declare the contract and inject. I'll declare the interface and token in a file (e.g. `src/mail/mail.port.ts` or within the auth module). To keep wiring clean: `src/mail/mail.module.ts` that provides the token? But there's no implementation... In the real app, the implementation would come from somewhere. I'll define:

  - `src/mail/mail.port.ts`: `export const MAIL_PORT = 'MAIL_PORT'; export interface MailPort { sendEmail(to, template, vars): Promise<void>; }`
  - Auth module provides a provider that binds `MAIL_PORT` to a concrete implementation? The implementation doesn't exist... "Assume the mail port exists" — treat it as an existing token `MAIL_PORT` provided elsewhere (app module). To keep the app runnable, I could provide a no-op/transport in `app.module.ts` marked as assumption. Hmm, "if a symbol you need truly doesn't exist in the task... use the most defensible interpretation and mark it with a single `// ASSUMPTION` comment at the point that matters."

  The most defensible: declare the `MailPort` interface and a `MAIL_PORT` token; the auth module imports/uses the token; in `app.module.ts` I provide a minimal concrete `MailPort` bound to the token marked as assumption (a console-log/transport stub) so the app runs. In tests, I override the token with a spy.

  Actually simpler: define the port in `src/mail/mail.port.ts` (interface + token), and in `app.module.ts` provide `{ provide: MAIL_PORT, useFactory: ... }` that returns the assumed existing implementation? I can't reference an existing implementation I haven't seen. So: I'll provide a concrete class `MailPort` implementation? No — "assume the mail port sendEmail(...) exists" means the environment supplies it; my code should consume it. The defensible reading: I define the token + interface (the contract), and in the app module bind the token to a factory that... hmm, a factory needs an implementation.

  Let me just do this: `src/mail/mail.module.ts`? The layout convention shows `src/<feature>/<feature>.module.ts`. I'll make `src/mail/mail.module.ts` that exports the `MAIL_PORT` provider, and in that module define an `AssumptionMailPort`?? That's inventing an implementation of what's assumed to exist.

  Cleanest defensible approach: in `src/mail/mail.port.ts`, export the token and interface. In `app.module.ts`:
  ```ts
  { provide: MAIL_PORT, useValue: mailPort } // // ASSUMPTION: mail port implementation is provided by the host app
  ```
  No...

  OK let me just do this: `src/mail/mail.module.ts` that has `MailModule` that `providers: [{ provide: MAIL_PORT, useClass: ConsoleMailPort }]` and `exports: [MAIL_PORT]`. And `ConsoleMailPort implements MailPort` with a `sendEmail` that just logs (a transport stub) marked `// ASSUMPTION: real mail transport is provided by the host app; this stand-in keeps the app bootable.` That's honest, keeps the wiring complete, and tests override with a spy. I think this is the most defensible. Keep it tiny.

  Wait — but "don't create files it doesn't ask for." The task asks for the full solution; the mail port is assumed to exist. Creating a stub module is creating something that's "assumed to exist" — but for a self-contained deliverable, DI needs a binding somewhere. Alternatively, I could inject `MailPort` via token in the auth service, and in tests provide the token via `overrideProvider`. In the app module, import `MailModule`... which doesn't exist. Ugh.

  Decision: keep the mail port as a token + interface file (`src/mail/mail.port.ts`), and in `app.module.ts` provide the token with a `useClass` to a minimal stand-in implementation defined in the same `src/mail/` directory (`src/mail/mail.port.ts` or a separate `src/mail/console-mail-port.ts`). Mark with a single ASSUMPTION comment. This keeps the app bootable and respects "assume the mail port exists" by keeping the interface exactly `sendEmail(to, template, vars): Promise<void>`.

  Hmm, actually, rereading: "Assume the mail port `sendEmail(to, template, vars): Promise<void>` exists." — this is telling me I don't have to implement mail sending; I can call it. The DI binding is the only glue. I'll do the minimal stand-in in the app module with an ASSUMPTION note.

**Response shape**: what does sign-up return? Same status/body/headers on both branches. E.g., 201? If the account is created the 201 is "truthful" but reveals. Common pattern: always 202 Accepted, body `{ "message": "If the address is new, a verification email has been sent." }` — the same for both. The spec says byte-identical, including length. So a single fixed body. Let me use:

```json
{ "message": "If this address is new, a verification email is on its way." }
```

Status: 200 or 202. Let me pick 202 Accepted. Sign-in: success → 200 with a token? Spec doesn't require tokens. "Sign-in: wrong password and unknown address return the same response." Success case can return something like `{ "message": "Signed in." }` or a JWT. To keep scope tight, sign-in success returns 200 with `{ "ok": true }`? Hmm, what's most defensible? The task only constrains the failure branch. A real sign-in returns a session/token. But adding JWT means adding deps (jsonwebtoken) and config. The task doesn't ask for it. "Do exactly what the task asks." So sign-in success: 200 with a minimal body, e.g. `{ "authenticated": true }`. Failure: 401 with the error envelope: `{ "error": { "code": "invalid_credentials", "message": "The email or password is incorrect.", "details": {} } }` — same for unknown email and wrong password.

Sign-up validation: controller validates input — email format, password length (e.g. min 8). Validation failure → 400 with the error envelope (this is a third branch, but it's pre-hash; timing there is different but it's a validation error and that's fine — an attacker can measure validation rejections but those reveal only format, not account existence; that's standard). The controller does the validation. "Controller validates input and calls the service. Zero business logic." So the controller checks email format + password min length and returns 400 error envelope if invalid.

**Equalizing headers**: NestJS default headers: `Content-Length` is computed from the body — same body → same length. `Set-Cookie`? Not unless we use sessions. So identical bodies → identical headers. Ensure no `Vary` differences — none. Good. Also make sure we don't leak in logs? Out of scope, but maybe mention in SECURITY.md. Keep it in code: both branches return the exact same object literal.

**Out-of-band mail**: "send is out-of-band, awaited by nothing on the response path, and mail failures change nothing the caller sees." So in the service, fire `void this.mail.sendEmail(...).catch(() => {})`? But then the test "mail failures invisible to caller" — the response is identical. Also the timing test: mail sending is async and un-awaited, so it doesn't affect the response time much. But careful: un-awaited promises in tests might cause unhandled rejections — handle with `.catch`. Also, should the mail send not delay the response? "Awaited by nothing on the response path" — right, fire-and-forget with a catch.

  But: "real outcomes still reach the account owner: existing addresses get a 'someone tried to sign up with your address' email; new addresses get a verification email." So the templates differ: e.g., `template: 'signup-existing'` vs `'signup-verify'`. Vars: `{ email }`.

  Important subtlety: mail sends happen on the branch — timing: mail send is fire-and-forget, not awaited, so response time is not affected. Good.

  Another subtlety: on sign-up existing branch, we send the "tried" email to the existing owner (the email address itself). Fine.

**Repository**: Prisma. Model `User` (or `Account`):
```prisma
model User {
  id           String   @id @default(uuid()) @map("id")
  email        String   @unique @map("email")
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```
Snake_case columns via @map, table `users`. Good.

Repository:
```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  findByEmail(email: string): Promise<User | null> { return this.prisma.user.findUnique({ where: { email } }); }
  create(email: string, passwordHash: string): Promise<User> { return this.prisma.user.create({ data: { email, passwordHash } }); }
}
```
Need a `PrismaService` (`src/prisma/prisma.service.ts`) that extends `PrismaClient`, plus `PrismaModule` that provides/exports it. That's the standard glue; the convention says the repository is the only layer that touches the DB, and PrismaService is the DB client wrapper. Include it.

Prisma client generation: in real repo, `pnpm prisma generate`. PrismaService imports from `@prisma/client`. That's assumed.

**Migration**: `prisma/migrations/20250101000000_init/migration.sql`:
```sql
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```
This matches Prisma's output for the schema above.

**Service logic**:

```ts
const ARGON2_PARAMS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 2, parallelism: 1 };
```
Wait — "real cost factor." OWASP (2024): argon2id, m=19 MiB (19456 KiB), t=2, p=1 as a minimum. In a test env, 19MiB/t=2 takes about 30-80ms. Let me pick `memoryCost: 65536 (64 MiB), timeCost: 2, parallelism: 2`? That might be ~100-200ms per op; timing test with e.g. 8 samples × 2 branches × 2 endpoints... the timing test probably focuses on sign-up branches and sign-in branches. Let me estimate test time: sign-up timing test: 10 samples new + 10 samples existing = 20 ops × ~100ms = 2s. Sign-in: same. Total ~4-6s. Acceptable for a security test. But for safety of CI speed, I'll use OWASP-recommended `memoryCost: 19456, timeCost: 2, parallelism: 1` (~50ms). "Real cost factor" — 19MiB/t2 is the OWASP minimum recommendation, defensible as "real." Hmm, but the L2 spec says "argon2 at a real cost factor takes tens to hundreds of milliseconds." 50ms fits "tens to hundreds." Good: `memoryCost: 19456, timeCost: 2, parallelism: 1`.

  Hmm wait, on slower/more constrained CI argon2 with 19MiB/2 might take 100-300ms; that's fine too.

  Test assertion "both are slow enough to be real work": assert median/min of each branch is above some floor, e.g. ≥ 20ms (argon2 with real params is way above 20ms even on fast machines; without hashing it's ~1-5ms per request through Nest). Let me assert `median >= 15` ms or so. To be safe against very fast machines: argon2 m=19456,t=2 is like 20-80ms even on a fast laptop. 15ms floor is safe. Or assert >= 10ms. The DB round-trip (localhost Postgres) adds ~1-3ms per request, plus HTTP overhead via supertest ~2-5ms. Without hashing, a request might take 5-15ms?? Hmm, could that flake the "slow enough" assertion? Let me think: no hashing, sign-up = HTTP + 1 DB lookup + 1 DB insert + response. On localhost, that's typically 5-15ms. If I set the floor at 20ms, then no-hashing is typically <20ms but could rarely hit 20ms on a loaded machine... To make the no-hashing fail robustly, better to assert the mean is above a floor that hashing comfortably exceeds (≥ 40ms? argon2 m=19M,t=2 ≈ 30-100ms). Hmm.

  Alternative: use a higher cost so hashed is comfortably ≥ 100ms and set the floor at 50ms. m=65536 (64MiB), t=3, p=1: on a modern CPU roughly 150-400ms. Test time: 20 samples × 2 endpoints × 2 branches × 250ms = 10s. Plus DB. A bit slow but OK? Vitest default timeout 5s per test → I'd set `testTimeout: 30_000`. Hmm.

  Let me settle: `memoryCost: 32768 (32 MiB), timeCost: 2, parallelism: 1`. Estimated ~50-120ms per op. 10 samples per branch per endpoint: sign-up 20 ops (~1-2.5s), sign-in 20 ops (~1-2.5s). Total test file maybe 5-10s. I'll set timeouts accordingly (30s). Floor assertion: mean of each branch ≥ 30ms? Hashed: comfortably ≥ 50ms on any machine (argon2 m=32M,t=2 ≥ ~40ms on fast hardware... let me think: argon2id 32MiB, 2 passes. Reference: argon2id m=19M,t=2 ≈ 30-60ms on modern hardware; 32MiB scales roughly linearly with memory → ~50-100ms. On older/slower, more). So floor 30ms is safe for "with hashing." Without hashing: request = 1-2 DB queries + HTTP. On a loaded CI, could it average ≥30ms? Possible, rare. To be robust, assert the *minimum* of the samples? No — with hashing, the min sample is still ≥ hash cost (~40ms+). Without hashing, the min of 10 samples is typically <10ms (the DB is warm). So assert: `Math.min(...samples) >= FLOOR` where FLOOR = 20ms? With hashing, min sample ≈ hash time + overhead ≥ 40ms. Without hashing, min ≈ 2-8ms. 20ms separates robustly. Let me use FLOOR = 20 and also assert the mean is within a tolerance.

  Equalization tolerance: |meanA - meanB| ≤ tol. With both branches doing one argon2 op, the difference is: sign-up: new branch has extra insert (~1-3ms); existing branch has none; sign-in: verify on real hash vs dummy — same cost. The mean difference is a few ms. Tolerance: relative, e.g. 25% of min mean, with an absolute floor (e.g. ≥ 15ms) and cap. L2: "statistically indistinguishable over repeated samples." A simple robust approach: assert |Δmean| ≤ max(15ms, 0.25 * min(meanA, meanB)). Or use Welch's t-test? That adds stats code; simpler: assert the 5th percentile of A is ≥ ... hmm. Keep it simple: mean difference tolerance + a check that both means are close, and maybe overlap of distributions (min of one ≥ ... too strict). I'll do: mean difference tolerance + floor. That satisfies "compares distributions over multiple samples" (multiple samples, mean, tolerance) plus the slow floor.

  Actually, to be a bit more "distributional," I could compute medians and compare means and medians within tolerance. Let me keep mean + floor. Maybe also assert each branch's spread? No, overkill. Keep: n=10 (or 12) samples each, assert |meanA−meanB| ≤ max(20, 0.25*min) ms and min(sample) ≥ 20ms each. Hmm wait, without hashing, could the branches still be "indistinguishable"? Yes, both fast — that's why the floor matters. Good.

  Also "timing test fails when equalization is removed": if I remove the dummy verify in sign-in unknown branch, that branch is ~5-10ms, the other is ~60-120ms → mean difference >> tolerance → fail. If I remove hashing entirely: floor fails.

**Now, testing strategy**: the test should run against the real service with a real database? The repo uses PostgreSQL; tests need a DB. Options:
1. E2E: spin up Nest app with real Prisma against a test Postgres (env DATABASE_URL), use supertest. Real argon2. Timing test is meaningful.
2. Unit: mock the repository, real argon2. Timing across branches: mock repo is fast; the argon2 difference still shows. Byte comparison is easy.

The timing test needs the real hash cost to matter → real argon2. DB can be mocked (repo is fast, a few ms difference, fine) or real. "Test behavior not implementation" — e2e with supertest is most behavior-oriented and tests byte-identical responses including headers. I'll do e2e tests: build the app with `Test.createTestingModule`, override `PrismaService` with an in-memory fake? Wait — "zero raw SQL, zero Prisma client calls" is in the service; the repo uses Prisma. In tests, overriding `PrismaService` with a fake that implements `user.findUnique/create` lets me avoid a real DB. But then the "repository is the only layer that touches the DB" — the test overrides the Prisma service, which is fine, common.

  But is an e2e with a fake DB still "testing behavior"? Response bytes, timing, mail behavior — yes. Timing: fake repo ≈ 0ms, argon2 dominates. Fine.

  Alternative: use a real Postgres via testcontainers — too heavy for a deliverable without tools. I'll go with e2e via supertest + PrismaService overridden by a Map-based fake + MailPort overridden by a spy. This keeps the test self-contained (no external DB needed) while exercising the full HTTP stack (real headers, real body, real service+repo logic, real argon2).

  Hmm, but the convention: "DATABASE_URL for Postgres" — the test env var. With the fake Prisma, no DATABASE_URL needed for tests. Good — tests don't need external services. I think that's the right call for a deliverable that must be runnable. I'll note it in comments.

  Wait, but is it legitimate to override PrismaService with a fake for a "byte comparison of responses"? Yes.

  Alternatively, I could make the tests integration tests against a real DB via `DATABASE_URL`... The safest deliverable: tests that run without external Postgres. I'll go with the fake.

  Also note: PrismaService constructor creates a `PrismaClient` — when overridden with `useValue: fakePrisma`, the real constructor isn't called, so no DB connection is attempted.

  The app module: `AppModule` imports `AuthModule` (and mail binding). In tests, I build the testing module directly from `AuthModule` + overrides, or from `AppModule` + overrides. Use `Test.createTestingModule({ imports: [AuthModule] })` + `.overrideProvider(PRISMA).useValue(fake)` + `.overrideProvider(MAIL_PORT).useValue(mailSpy)`. But if AuthModule imports PrismaModule, the override still works by token. Let me structure:

  - `src/prisma/prisma.module.ts`: `@Module({ providers: [PrismaService], exports: [PrismaService] })`
  - `src/auth/auth.module.ts`: imports PrismaModule, MailModule; providers: AuthService, AuthRepository; controllers: AuthController; (export AuthService? not needed).
  - `src/mail/mail.module.ts`: provides + exports MAIL_PORT (bound to a stand-in class, ASSUMPTION).
  - `src/app.module.ts`: imports AuthModule (and MailModule via AuthModule's import; app module just imports AuthModule).
  - `src/main.ts`: bootstrap, port from env `PORT` ?? 3000. Config is env only.

  Mail stand-in: `src/mail/console-mail-port.ts`? Or put the token in `src/mail/mail.port.ts` and the stand-in in the same file? The convention is `kebab-case.role.ts` file naming — "role" suffix. `mail.port.ts` fits (role = port). For the stand-in class, `mail.module.ts` can inline `{ provide: MAIL_PORT, useValue: { sendEmail: async () => {...} } }`. Inline useValue with a no-op? That would be "assume exists" — a stand-in that does nothing might be too silent; console.error is fine. Let me define the token + interface in `mail.port.ts`, and in `mail.module.ts` bind it with `useValue` to a stand-in that logs, marked `// ASSUMPTION:`. Keep it small.

  Hmm wait: "do not create files it doesn't ask for." The task asks for a full solution; mail port is assumed to exist. Creating a stub module is creating something "assumed to exist" — but for a self-contained deliverable, DI needs a binding somewhere. Alternatively, I could inject MailPort via token in the auth service and in tests provide the token via overrideProvider. In the app module, import MailModule... which doesn't exist. Ugh.

  Decision: keep the mail port as a token + interface file (`src/mail/mail.port.ts`), and in `app.module.ts` provide the token with a `useClass` to a minimal stand-in implementation defined in the same `src/mail/` dir (`src/mail/console-mail-port.ts`). Mark with a single ASSUMPTION comment. This keeps the app bootable and respects "assume the mail port exists" by keeping the interface exactly `sendEmail(to, template, vars): Promise<void>`.

  Hmm, actually rereading: "Assume the mail port `sendEmail(to, template, vars): Promise<void>` exists." — this is telling me I don't have to implement mail sending; I can call it. The DI binding is the only glue. I'll do the minimal stand-in in the app module with an ASSUMPTION note.

**Equalizing headers**: NestJS default headers: `Content-Length` computed from body — same body → same length. `Set-Cookie`? Not unless sessions. So identical body → identical headers. Ensure no `Vary` differences — none. Good. Also make sure I don't leak in logs? Out of scope but maybe mention in SECURITY.md. Keep it in code: both branches return the same object literal.

**Out-of-band mail**: "send is out-of-band, awaited by nothing on the response path, and mail failures change nothing the caller sees." So in the service, fire `void this.mail.sendEmail(...).catch(() => {})`? But then test "mail failures invisible to caller" — response is identical. Also the timing test: mail send is async and un-awaited, so it doesn't affect response time much. But careful: un-awaited promises in tests could cause unhandled rejections — handle with `.catch`. Also, should mail send not delay response? "Awaited by nothing on the response path" — yes, fire-and-forget with catch.

  But: "real outcomes still reach account owner: existing address gets 'someone tried to sign up with your address' email; new address gets a verification email." So templates differ: e.g. `template: 'signup-existing'` vs `'signup-verify'`. Vars: `{ email }`.

  Important subtlety: mail send happens on the branch — timing: mail send is fire-and-forget, un-awaited, so response time is not affected. Good.

  Another subtlety: on sign-up existing branch, we send "tried" email to the existing owner (the email address itself). Fine.

**Repository**: Prisma. Model `User` (or `Account`):
```prisma
model User {
  id           String   @id @default(uuid()) @map("id")
  email        String   @unique @map("email")
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```
Snake_case columns via @map, table `users`. Good.

Repository:
```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  findByEmail(email: string): Promise<User | null> { return this.prisma.user.findUnique({ where: { email } }); }
  create(email: string, passwordHash: string): Promise<User> { return this.prisma.user.create({ data: { email, passwordHash } }); }
}
```
Need `PrismaService` (`src/prisma/prisma.service.ts`) extending `PrismaClient`, plus `PrismaModule` providing/exporting it. That's the standard glue; the convention says the repository is the only layer touching DB, and PrismaService is the DB client wrapper. Include it.

Prisma client generation: in real repo, `pnpm prisma generate`. PrismaService imports from `@prisma/client`. That's assumed.

**Migration**: `prisma/migrations/20250101000000_init/migration.sql`:
```sql
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```
This matches Prisma's output for the schema above.

**Service logic**:

```ts
const ARGON2_PARAMS = { type: argon2.argon2id, type: argon2.argon2id, memoryCost: 65536, timeCost: 2, parallelism: 1 };
```
Wait — "real cost factor." OWASP (2024): argon2id, m=19 MiB (19456 KiB), t=2, p=1 as minimum. In a test env, 19MiB/t=2 takes about 30-80ms. Let me pick `memoryCost: 65536 (64 MiB), timeCost: 2, parallelism: 2`? That might be ~100-200ms per op; timing test with e.g. 8 samples × 2 branches × 2 endpoints... timing test probably focuses on sign-up branches and sign-in branches. Let me estimate test time: sign-up timing test: 10 samples new + 10 samples existing = 20 ops × ~100ms = 2s. Sign-in: same. Total ~4-6s. Acceptable for security test. But for CI speed safety, use OWASP-recommended `memoryCost: 19456, timeCost: 2, parallelism: 1` (~50ms). "Real cost factor" — 19MiB/t2 is OWASP minimum recommendation, defensible as "real." Hmm, but L2 spec says "argon2 at a real cost factor takes tens to hundreds of milliseconds." 50ms fits "tens to hundreds." Good: `memoryCost: 19456, timeCost: 2, parallelism: 1`.

  Hmm wait, on slower/more constrained CI argon2 with 19MiB/2 might take 100-300ms; that's fine too.

  Test assertion "both are slow enough to be real work": assert median/min of each branch above some floor, e.g. ≥ 20ms (argon2 with real params is way above 20ms even on fast machines; without hashing it's ~1-5ms per request through Nest). Let me assert `median >= 15` ms or so. To be safe against very fast machines: argon2 m=19456,t=2 is like 20-80ms even on fast laptop. 15ms floor is safe. Or assert >= 10ms. The DB round-trip (localhost Postgres) adds ~1-3ms per request, plus HTTP overhead via supertest ~2-5ms. Without hashing, a request might take 5-15ms?? Hmm, could that flake the "slow enough" assertion? Let me think: no hashing, sign-up = HTTP + 1 DB lookup + 1 DB insert + response. On localhost that's typically 5-15ms. If I set the floor at 20ms, then no-hashing is typically <20ms but could rarely hit 20ms on a loaded machine... To make the no-hashing fail robustly, better to assert the mean is above a floor that hashing comfortably exceeds (≥ 40ms? argon2 m=19M,t=2 ≈ 30-100ms). Hmm.

  Alternative: use a higher cost so hashed is comfortably ≥ 100ms and set floor at 50ms. m=65536 (64MiB), t=3, p=1: on modern CPU roughly 150-400ms. Test time: 20 samples × 2 endpoints × 2 branches × 250ms = 10s. Plus DB. A bit slow but OK? Vitest default timeout 5s per test → I'd set `testTimeout: 30_000`. Hmm.

  Let me settle: `memoryCost: 32768 (32 MiB), timeCost: 2, parallelism: 1`. Estimated ~50-120ms per op. 10 samples per branch per endpoint: sign-up 20 ops (~1-2.5s), sign-in 20 ops (~1-2.5s). Total test file maybe 5-10s. Set timeouts accordingly (30s). Floor assertion: mean of each branch ≥ 30ms? Hashed: comfortably ≥ 50ms on any machine (argon2 m=32M,t=2 ≥ ~40ms on fast hardware... let me think: argon2id 32MiB, 2 passes. Reference: argon2id m=19M,t=2 ≈ 30-60ms on modern hardware; 32MiB scales roughly linearly with memory → ~50-100ms. On older/slower, more). So floor 30ms is safe for "with hashing." Without hashing: request = 1-2 DB queries + HTTP. On loaded CI could it average ≥30ms? Possible, rare. To be robust, assert *minimum* of samples? No — with hashing, min sample is still ≥ hash cost (~40ms+). Without hashing, min of 10 samples is typically <10ms (DB is warm). So assert: `Math.min(...samples) >= FLOOR` where FLOOR = 20ms? With hashing, min sample ≈ hash time + overhead ≥ 40ms. Without hashing, min ≈ 2-8ms. 20ms separates robustly. Let me use FLOOR = 20 and also assert mean within tolerance.

  Equalization tolerance: |meanA - meanB| ≤ tol. With both branches doing one argon2 op, difference is: sign-up: new branch has extra insert (~1-3ms); existing branch has none; sign-in: verify on real hash vs dummy — same cost. Mean difference is a few ms. Tolerance: relative, e.g. 25% of min mean, with absolute floor (e.g. ≥ 15ms) and cap. L2: "statistically indistinguishable over repeated samples." A simple robust approach: assert |Δmean| ≤ max(15ms, 0.25 * min(meanA, meanB)). Or use Welch's t-test? Adds stats code; simpler: assert mean difference tolerance + a check that both means are close, and maybe overlap of distributions (min of one ≥ ... too strict). I'll do: mean difference tolerance + floor. That satisfies "compares distributions over multiple samples" (multiple samples, mean, tolerance) plus the slow floor.

  Actually, to be a bit more "distributional," I could compute medians and compare means and medians within tolerance. Let me keep mean + floor. Maybe also assert each branch's spread? No, overkill. Keep: n=10 (or 12) samples each, assert |meanA−meanB| ≤ max(20, 0.25*min) ms and min(sample) ≥ 20ms each. Hmm wait, without hashing, could the branches still be "indistinguishable"? Yes, both fast — that's why the floor matters. Good.

  Also "timing test fails when equalization is removed": if I remove the dummy verify in sign-in unknown branch, that branch is ~5-10ms, the other is ~60-120ms → mean difference >> tolerance → fail. If I remove hashing entirely: floor fails.

**Now, testing strategy**: the test should run against the real service with a real database? The repo uses PostgreSQL; tests need a DB. Options:
1. E2E: spin up Nest app with real Prisma against a test Postgres (env DATABASE_URL), use supertest. Real argon2. Timing test is meaningful.
2. Unit: mock the repository, real argon2. Timing across branches: mock repo is fast; the argon2 difference still shows. Byte comparison is easy.

The timing test needs the real hash cost to matter → real argon2. DB can be mocked (repo is fast, a few ms difference, fine) or real. "Test behavior not implementation" — e2e with supertest is most behavior-oriented and tests byte-identical responses including headers. I'll do e2e tests: build the app with `Test.createTestingModule`, override `PrismaService` with an in-memory fake? Wait — "zero raw SQL, zero Prisma client calls" is in the service; the repo uses Prisma. In tests, overriding `PrismaService` with a fake that implements `user.findUnique/create` lets me avoid a real DB. But then the "repository is the only layer that touches the DB" — the test overrides the Prisma service, which is fine, common.

  But is an e2e with a fake DB still "testing behavior"? Response bytes, timing, mail behavior — yes. Timing: fake repo ≈ 0ms, argon2 dominates. Fine.

  Alternative: use a real Postgres via testcontainers — too heavy for a deliverable without tools. I'll go with e2e via supertest + PrismaService overridden by a Map-based fake + MailPort overridden by a spy. This keeps the test self-contained (no external DB needed) while exercising the full HTTP stack (real headers, real body, real service+repo logic, real argon2).

  Hmm, but the convention: "DATABASE_URL for Postgres" — the test env var. With the fake Prisma, no DATABASE_URL needed for tests. Good — tests don't need external services. I think that's the right call for a deliverable that must be runnable. I'll note it in comments.

  Wait, but is it legitimate to override PrismaService with a fake for a "byte comparison of responses"? Yes.

  Alternatively, I could make the tests integration tests against a real DB via `DATABASE_URL`... The safest deliverable: tests that run without external Postgres. I'll go with the fake.

  Also note: PrismaService constructor creates a `PrismaClient` — when overridden with `useValue: fakePrisma`, the real constructor isn't called, so no DB connection is attempted.

  The app module: `AppModule` imports `AuthModule` (and mail binding). In tests, I build the testing module directly from `AuthModule` + overrides, or from `AppModule` + overrides. Use `Test.createTestingModule({ imports: [AuthModule] })` + `.overrideProvider(PRISMA).useValue(fake)` + `.overrideProvider(MAIL_PORT).useValue(mailSpy)`. But if AuthModule imports PrismaModule, the override still works by token. Let me structure:

  - `src/prisma/prisma.module.ts`: `@Module({ providers: [PrismaService], exports: [PrismaService] })`
  - `src/auth/auth.module.ts`: imports PrismaModule, MailModule; providers: AuthService, AuthRepository; controllers: AuthController; (export AuthService? not needed).
  - `src/mail/mail.module.ts`: provides + exports MAIL_PORT (bound to a stand-in class, ASSUMPTION).
  - `src/app.module.ts`: imports AuthModule (and MailModule via AuthModule's import; app module just imports AuthModule).
  - `src/main.ts`: bootstrap, port from env `PORT` ?? 3000. Config is env only.

  Mail stand-in: `src/mail/console-mail-port.ts`? Or put the token in `src/mail/mail.port.ts` and the stand-in in the same file? The convention is `kebab-case.role.ts` file naming — "role" suffix. `mail.port.ts` fits (role = port). For the stand-in class, `mail.module.ts` can inline `{ provide: MAIL_PORT, useValue: { sendEmail: async () => {...} } }`. Inline useValue with a no-op? That would be "assume exists" — a stand-in that does nothing might be too silent; console.error is fine. Let me define the token + interface in `mail.port.ts`, and in `mail.module.ts` bind it with `useValue` to a stand-in that logs, marked `// ASSUMPTION:`. Keep it small.

  Hmm wait: "do not create files it doesn't ask for." The task asks for a full solution; mail port is assumed to exist. Creating a stub module is creating something "assumed to exist" — but for a self-contained deliverable, DI needs a binding somewhere. Alternatively, I could inject MailPort via token in the auth service and in tests provide the token via overrideProvider. In the app module, import MailModule... which doesn't exist. Ugh.

  Decision: keep the mail port as a token + interface file (`src/mail/mail.port.ts`), and in `app.module.ts` provide the token with a `useClass` to a minimal stand-in implementation defined in the same `src/mail/` dir (`src/mail/console-mail-port.ts`). Mark with a single ASSUMPTION comment. This keeps the app bootable and respects "assume the mail port exists" by keeping the interface exactly `sendEmail(to, template, vars): Promise<void>`.

  Hmm, actually rereading: "Assume the mail port `sendEmail(to, template, vars): Promise<void>` exists." — this is telling me I don't have to implement mail sending; I can call it. The DI binding is the only glue. I'll do the minimal stand-in in the app module with an ASSUMPTION note.

**Controller**:

```ts
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-up')
  signUp(@Body() body: unknown) {
    const { email, password } = this.validate(body, ...);
    return this.auth.signUp(email, password);
  }
}
```

Validation: email non-empty, basic format regex, password string length ≥ 8 (and ≤ 72 for bcrypt? argon2 has no 72 limit; use ≤ 128). On invalid → 400 with envelope. To produce the envelope, the controller throws `HttpException` with a body that matches the envelope, or use a small helper. Since "errors — one envelope," I'll define `src/common/http-error.ts`? Hmm, "don't create files it doesn't ask for." The envelope needs a mechanism; Nest's default exception filter produces `{ statusCode, message }` unless we customize. To keep the envelope contract, I'll add a global exception filter in app.module/main that maps thrown errors to the envelope. That's 1 file `src/common/error-handler.filter.ts`. Is that "asked for"? The error envelope is a stated convention ("Errors — one envelope") with code as contract. So yes, implementing the envelope is part of the conventions. I'll add a `GlobalExceptionsFilter` that:
  - `HttpException` with a custom body `{ error: { code, message, details } }` → pass through.
  - Otherwise map: `NotFoundException` → `resource_not_found`, `BadRequestException` → `bad_request`, `UnauthorizedException` → `unauthorized`, default → `internal_error` (500, hide message).

  And the controller throws a domain error class? Simpler: define a small `HttpError` helper in the common file: `throw new HttpException({ error: { code: 'validation_failed', message, details } }, 400)`. The filter passes through bodies that already have the envelope shape.

  Let me keep the common file minimal: `src/common/envelope.filter.ts` with `EnvelopeFilter extends BaseExceptionFilter`.

  Auth failure (sign-in wrong/unknown): 401, code `invalid_credentials`, message "Email or password is incorrect." Details `{}`.

  Validation: 400 `validation_failed` with details listing fields? details is an object, e.g. `{ fields: ["password"] }`.

  Both sign-in failure branches produce the same → service returns a single failure value; controller maps service result to HTTP: service returns a typed result `{ ok: true }` / `{ ok: false }` and controller sets 200/401. Wait, "controller validates input and calls service. Zero business logic." Mapping a service result to a status code is presentation, not business logic — fine. Alternatively the service throws `UnauthorizedException` and the filter envelopes it. Either works. Let me have the service return an outcome union; controller decides status. Actually, cleaner Nest-style: service throws; filter formats. But the byte-identical requirement: the same exception in both branches → identical. Let me do this: service `signIn` returns `SignInResult = { status: 'ok' } | { status: 'rejected' }`; controller: if rejected → throw `HttpError(401, 'invalid_credentials', 'Email or password is incorrect.')`. Single code path → byte-identical.

  For sign-up: service returns `SignUpResult = { status: 'accepted' }` always (both branches). Controller always 202 with fixed body. Actually, the service could return the same object; controller returns it. To guarantee byte-identity, both branches literally return the same constant.

**Service**:

```ts
const ARGON2: Argon2Options = { type: argon2.argon2id, memoryCost: 32768, timeCost: 2, parallelism: 1 };

@Injectable()
export class AuthService {
  private readonly dummyHash: Promise<string>... 
```
Generate dummy in `onModuleInit`:
```ts
async onModuleInit(): Promise<void> {
  this.dummyHash = await argon2.hash(DUMMY_PLAINTEXT, ARGON2);
}
```
DUMMY_PLAINTEXT = a fixed non-secret string, e.g. `'dummy-password-for-timing-equalisation'`.

signUp:
```ts
async signUp(email, password): Promise<SignUpOutcome> {
  const hash = await argon2.hash(password, ARGON2); // both branches pay this
  const existing = await this.repo.findByEmail(email);
  if (existing) {
    this.deliver('signup-already-registered', email);
  } else {
    await this.repo.create(email, hash);
    this.deliver('signup-verify', email);
  }
  return ACCEPTED;
}
```
Wait — subtle timing: existing branch: hash + lookup. New branch: hash + lookup + insert. Difference = insert (~1ms) — negligible compared to ~60-100ms hash. Good.

  Hmm, one more consideration: unique constraint race — two concurrent sign-ups for the same email could both pass `findByEmail` and one insert fails with P2002. Handling: catch P2002 and treat as existing (send tried email). Is that "business logic"? It's a correctness detail; keep minimal: `try { create } catch (e) { if (isUniqueViolation(e)) send tried }`. But the service has zero Prisma calls... The error check `e.code === 'P2002'` is a string check, acceptable. Keep it minimal. Hmm — "do exactly what the task asks." The race isn't asked. But it's a real correctness bug for the "same response" property (a 500 on the race reveals + crashes). I'll include a small guard, 6 lines. Defensible. Actually wait — the service catching a repository error by Prisma error code couples the service to Prisma internals. Alternative: the repository exposes `createUniqueSafe` that returns `{ created: boolean }` handling the race internally (repo layer touches DB, knows P2002). Cleaner per the layer rules! Repository:

```ts
async createIfAbsent(email, passwordHash): Promise<{ created: boolean }> {
  try { await this.prisma.user.create(...); return { created: true }; }
  catch (e) { if (isUniqueConstraint(e)) return { created: false }; throw e; }
}
```
Then service:
```ts
const existing = await this.repo.findByEmail(email);
if (existing) { mail tried } else { const { created } = await this.repo.createIfAbsent(email, hash); if (!created) { mail tried } else { mail verify } }
```
Hmm, slightly awkward but correct. Simpler: service checks `findByEmail` first; if found → tried; else createIfAbsent; if it reports not created (race) → tried (and maybe no duplicate verify email sent — good).

  Or skip the race handling entirely? The property "existing and new produce byte-identical responses" — in a race, the second gets 500 ≠ identical. The task's tests are sequential so a race isn't tested. But "do exactly what the task asks" vs robustness... The L2 spec says nothing about races. Include the small repo guard — it's within the repository's remit and 5 lines. I'll include it; it strengthens the invariant.

signIn:
```ts
async signIn(email, password): Promise<SignInOutcome> {
  const user = await this.repo.findByEmail(email);
  const hash = user ? user.passwordHash : await this.dummyHash;
  const ok = await argon2.verify(password, hash).catch(() => false);
  if (user && ok) return SIGNED_IN;
  return REJECTED;
}
```
Note: unknown email → verify against dummy → false → rejected. Wrong password → verify fails → rejected. Same response, same work (one verify).

  Edge: `argon2.verify` throws on malformed stored hash → catch → false → but if user exists and hash is malformed, that's a server bug; returning false is safe. Fine.

  Wait, one more: `argon2.verify(password, hash)` where hash comes from user — the timing of verify depends on hash params (the stored params). The dummy uses the same params. Good.

**Mail deliver**:
```ts
private deliver(template: string, to: string): void {
  void this.mail.sendEmail(to, template, { email: to }).catch(() => {
    // mail failure is out of band; the caller must never observe it
  });
}
```
"awaited by nothing on the response path" ✓. A catch prevents unhandled rejection ✓.

**Byte-identical responses**: sign-up always 202 `{ "message": "If the address is new, a verification email is on its way." }`? Let me pick a fixed string. Both branches return the same const → same JSON serialization → same Content-Length.

Sign-in failure 401 `{ "error": { "code": "invalid_credentials", "message": "Email or password is incorrect.", "details": {} } }` — same for both branches.

Sign-in success 200 `{ "message": "Signed in." }`? Or a token... Task doesn't require a token. Keep minimal. Hmm, actually a real sign-in without a token is weird, but "do exactly what the task asks" — no token is asked. Return `{ "ok": true }`. Let me make it `{ "message": "Signed in." }` to be consistent style.

**Test file**: `test/auth.spec.ts` (convention: `test/<feature>.spec.ts` → feature = auth → `test/auth.spec.ts`).

Test setup:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAIL_PORT, MailPort } from '../src/mail/mail.port';
```

Fake prisma:
```ts
function makeFakePrisma() {
  const users = new Map<string, { id: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date }>();
  let seq = 0;
  return {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.get(where.email) ?? null,
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        if (users.has(data.email)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: `id-${++seq}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        users.set(data.email, row);
        return row;
      },
    },
    $connect: async () => {},
    $disconnect: async () => {},
  };
}
```
Type: cast to `PrismaService` via `as unknown as PrismaService`? The fake needs to satisfy only what the repo uses. `overrideProvider(PrismaService).useValue(fake as unknown as PrismaService)`.

  Mail spy:
```ts
const sent: Array<{ to: string; template: string; vars: Record<string, unknown> }> = [];
const mail: MailPort = { sendEmail: async (to, template, vars) => { sent.push({ to, template, vars }); } };
```
For failure test: a separate app instance where sendEmail rejects.

  Building the app:
```ts
async function buildApp(overrides: { prisma?: unknown; mail?: MailPort }) {
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
    .overrideProvider(PrismaService).useValue(overrides.prisma ?? makeFakePrisma())
    .overrideProvider(MAIL_PORT).useValue(overrides.mail ?? okMail)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new EnvelopeFilter()); // hmm — or set in main?
  await app.init();
  return app;
}
```
Wait — the global filter: register in `main.ts` via `app.useGlobalFilters(new EnvelopeFilter())` or `@Catch` with `APP_FILTER` provider in app.module. For tests to have identical envelope behavior, it's cleaner to register the filter in `AppModule` via the `APP_FILTER` token — then both main and tests get it. But tests import `AuthModule`, not `AppModule`. If the filter is in `AppModule` providers, tests that import AuthModule miss it. Options: tests build from `AppModule` and override providers (PrismaService, MAIL_PORT). That's cleanest: `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(...)`. AppModule imports AuthModule which imports PrismaModule/MailModule — overrides by token work across module boundaries. Let me do that: tests import `AppModule`.

  Then `main.ts` is just bootstrap with `process.env.PORT`.

  `APP_FILTER` in `AppModule.providers: [{ provide: APP_FILTER, useClass: EnvelopeFilter }]`.

  Filter file: `src/common/envelope.filter.ts`? Convention layout doesn't show `src/common/`, but it shows a per-feature layout; a cross-cutting filter needs a home. I'll put it in `src/common/error-envelope.filter.ts`. Hmm, "TS file: kebab-case.role.ts" → `error-envelope.filter.ts`? Role is filter. OK: `src/common/error-envelope.filter.ts`. Or name it `envelope.filter.ts`. Fine.

Tests:

1. **Byte-identical sign-up response** (status, body bytes, headers):
```ts
it('sign-up: new vs existing → byte-identical status, body, headers', async () => {
  // warm up: create user
  await post signUp {email:'a@x.io', password:'correct-horse-1'} → 202
  const r1 = await post signUp {email:'a@x.io', password:'different-pass-2'}; // existing
  // new address
  const r2 = await post signUp {email:'b@x.io', password:'another-pass-3'}; // new
  expect(r1.status).toBe(202); expect(r2.status).toBe(202);
  expect(Buffer.from(r1.text)).toEqual(Buffer.from(r2.text));
  // headers: compare the relevant header sets
  const h1 = omitVarying(r1.headers), h2 = omitVarying(r2.headers);
  expect(h1).toEqual(h2);
});
```
Which headers vary? `date` (supertest sets date header), maybe `set-cookie` (none). `transfer-encoding`/`content-length` same if same body. So compare headers excluding `date`. The spec says "including anything that leaks length differences" — content-length must be equal → body same → equal. I'll assert: for all header keys in the union, values are equal except `date`. Implementation:
```ts
const pick = (h: any) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'date'));
expect(pick(r1.headers)).toEqual(pick(r2.headers));
```
Also assert `content-length` is present and equal explicitly. Good.

2. **Sign-in wrong password vs unknown address byte-identical**:
```ts
seed user with known password.
r1 = signIn {email: known, password: 'wrong'}; // 401
r2 = signIn {email: unknown, password: 'whatever'}; // 401
status equal, body bytes equal, headers (minus date) equal.
```

3. **Sign-in success still works**: known + correct → 200.

4. **Account actually created / not created**: after new sign-up, a sign-in with that password succeeds (behavioral proof of creation). After existing sign-up, the old password still works and the new password does not (behavioral proof of no overwrite). Also check `users.size` via the fake? That's implementation... better behavioral: sign-in with new password on existing address fails; sign-in with original password succeeds.

5. **Mail**: new address → verification email sent to that address (template 'signup-verify'... wait template naming — I pick names: `'account-created'`? Task: "new address gets verification email" → template `verify-account`; "existing gets 'someone tried to sign up with your address'" → template `signup-attempt`). Since mail send is fire-and-forget, the test must wait for the send to be recorded. Use a polling helper: `await waitFor(() => sent.length === 1)`. Since un-awaited, after the response returns, the send promise is likely already resolved (microtasks) — but to be safe, poll with a small timeout. I'll write a `waitUntil` helper (up to 2s, 10ms tick).

   Existing address → template `signup-attempt` sent to owner, no `verify-account` sent.

6. **Mail failure invisible**: app with mail that rejects; sign-up existing and new → both 202, byte-identical body, no 5xx. Assert status 202 on both.

7. **Timing test** (the big one):
```ts
it('sign-up timing: new vs existing indistinguishable over N samples', async () => {
  const N = 8;
  const existingEmail = 'timing-ex@x.io'; // pre-seed
  const timesExisting: number[] = [];
  const timesNew: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await request(server).post('/auth/sign-up').send({ email: existingEmail, password: `pw-${i}-exist` });
    const t1 = process.hrtime.bigint();
    timesExisting.push(ms(t1 - t0));
    const u0 = process.hrtime.bigint();
    await request(server).post('/auth/sign-up').send({ email: `timing-new-${i}@x.io`, password: `pw-${i}-new` });
    const u1 = process.hrtime.bigint();
    timesNew.push(ms(u1 - u0));
  }
  const meanE = mean(timesExisting), meanN = mean(timesNew);
  const diff = Math.abs(meanE - meanN);
  const tol = Math.max(20, 0.25 * Math.min(meanE, meanN));
  expect(diff).toBeLessThanOrEqual(tol);
  // both slow enough to be real hash work
  expect(Math.min(...timesExisting)).toBeGreaterThan(20);
  expect(Math.min(...timesNew)).toBeGreaterThan(20);
});
```
Similarly for sign-in: known-wrong-password vs unknown-address.

  Timing with interleaved alternating samples helps control for drift. N=8 → sign-up: 16 hash ops; sign-in: 16 verify ops. At ~60-100ms each → ~2-3s each. OK. Set test timeout: `testTimeout`? In vitest, per-test `it('...', async () => {...}, 30_000)`. I'll pass 30000 to the timing tests.

  Warm-up: the first argon2 call might include JIT/native warm-up; also the fake DB is warm. Add 1-2 warmup calls (unmeasured) before sampling. Good practice — I'll note in a comment.

  Floor 20ms: hashed min sample is ~50ms+ → passes. Without hashing: min sample ~1-5ms → fails. Without equalization (no dummy verify in sign-in unknown branch): unknown branch mean ~3ms, other ~70ms → diff ~67ms > tol(20) → fails.

  One concern: with the fake Prisma, `findByEmail` is a microtask — the new branch of sign-up does hash+lookup(+insert), the existing does hash+lookup. The difference is ~ms. Fine.

  Another concern: `process.hrtime.bigint()` around `await request(...)` — supertest measures client+server round-trip over a real HTTP server (the app must be `app.listen(0)` or use `app.getHttpServer()`). Use `const server = app.getHttpServer(); request(server)`.

8. Also "no Math.random on response path" — acceptance criterion; my code doesn't use any. The test can't easily assert that; skip (the code simply doesn't). Should I grep? No. Just don't use it.

**Timing-test details — does the response path include mail?** No, un-awaited. But the un-awaited sendEmail in tests pushes to an array — negligible.

**Now the argon2 params and "real cost factor"**: `memoryCost: 32768` KiB = 32 MiB, `timeCost: 2`, `parallelism: 1`, `type: argon2id`. Also `output len` 32 is default. This is above the OWASP minimum (19 MiB, t=2). Real. ✓

  Actually wait — let me reconsider the cost for test runtime on constrained CI (e.g. GitHub Actions 2-core). argon2id 32MiB/t=2/p=1 ≈ probably 50-150ms. 32 total hash/verify ops in timing tests ≈ 2-5s. Plus other tests: byte-identical tests do a few more ops (~6-8 more). Total argon2 ops ~40 × 100ms ≈ 4s + overhead. Total test file ~6-12s. Acceptable.

  Hmm, but `parallelism: 1` means no CPU parallelism — fine.

**package.json / tsconfig / vitest config**: "Deliver every file the solution needs." A complete solution includes `package.json`, `tsconfig.json`, `vitest.config.ts`. The convention mentions pnpm, ESM, Node 20, Vitest. I'll include:
  - `package.json` with deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@prisma/client`, `argon2`, `reflect-metadata`, `rxjs`; devDeps: `@nestjs/testing`, `@types/node`, `@types/supertest`, `supertest`, `typescript`, `tsx`? (not needed), `vitest`, `prisma`. Scripts: `prisma:migrate`, `start:dev`? Minimal: `build`, `start`, `test`, `prisma:generate`, `prisma:migrate`.
  - `tsconfig.json` strict, ESM. NestJS needs `emitDecoratorMetadata`, `experimentalDecorators`, target ES2022, module NodeNext.
  - `vitest.config.ts`: `testTimeout`? Set `test: { testTimeout: 30000, hookTimeout: 30000 }`? Default 5s is too short for timing tests; set 30s globally in the config, or per-test. Set per-test timeout on the timing tests and keep config minimal but include `environment: 'node'` (default) and maybe `fileParallelism` default is fine. Actually simpler: set `testTimeout: 60_000` in vitest.config — harmless. Hmm, "don't create files it doesn't ask for" — but a runnable solution needs config; the instruction "build the full solution in one reply... deliver every file the solution needs" overrides minimalism for build files. I'll include package.json, tsconfig.json, vitest.config.ts. `nest-cli.json`? Not strictly needed if I run with `tsx`/`ts-node`... For Nest, the typical `nest build` uses tsc with a tsconfig.build. Simpler: scripts: `"start": "tsx src/main.ts"`? tsx adds a dep; or compile with tsc and run node dist. Since ESM + decorators, tsc works. Let me do:
    - `"build": "tsc -p tsconfig.json"`
    - `"start": "node dist/main.js"`
    - `"test": "vitest run"`
    - `"prisma:generate": "prisma generate"`
    - `"prisma:migrate": "prisma migrate deploy"`
  tsconfig: `"module": "nodenext", "moduleResolution": "nodenext", "target": "ES2022", "outDir": "dist", "strict": true, "emitDecoratorMetadata": true, "experimentalDecorators": true, "esModuleInterop": true, "skipLibCheck": true, "declaration": false, "sourceMap": true, "strictPropertyInitialization": true` (covered by strict). ESM: with NodeNext, relative imports in TS source need `.js` extensions! That's a hassle for a deliverable: `import { AuthModule } from './auth.module.js'`. NestJS docs now support ESM with `.js` extensions. Since the convention says ESM `"type": "module"`, I must use `.js` extension on relative imports in src. In tests (vitest), does vitest handle TS with `.js`→`.ts` mapping? Vitest supports importing `../src/auth/auth.module.js` and resolving to the .ts file (vite's resolver handles ESM TS with extensions... yes, Vite/Vitest resolves `.js` to `.ts` in TS projects — this works with `moduleResolution: nodenext`? Hmm, in Vitest, importing `./foo.js` when only `./foo.ts` exists: Vite's resolver has `isFromTsImporter` logic; it works in most setups. Actually I recall vitest handles this fine (resolves .js → .ts). Yes, Vitest supports this pattern (it's standard for ESM TS under vitest).

  Alternatively, `"module": "ESNext", "moduleResolution": "Bundler"` and no extensions in source, run via a bundler... but Node runtime ESM needs extensions; `tsc` with module ESNext emits without extensions → broken at runtime. So NodeNext with `.js` extensions is the correct ESM approach. I'll use `.js` extensions consistently in src and test files.

  Wait, do decorator + ESM + Nest work with plain tsc output? Yes, if `emitDecoratorMetadata` + NodeNext, NestJS ESM is supported (Nest 10+). Fine.

  `prisma/schema.prisma`: datasource postgres, `url = env("DATABASE_URL")`. Generator client.

**PrismaService**:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
In tests, overridden, so no real connection.

**Envelope filter**:
```ts
@Catch()
export class ErrorEnvelopeFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>(); // maybe for logging
    let status = 500; let code = 'internal_error'; let message = 'Unexpected server error.'; let details: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in (body as any)) {
        const e = (body as any).error;
        code = e.code ?? codeForStatus(status);
        message = e.message ?? message;
        details = e.details ?? {};
      } else if (typeof body === 'string') {
        code = codeForStatus(status); message = body;
      } else if (Array.isArray(body)) { message = body.join(', ') ... }
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
```
`codeForStatus`: 400→'bad_request', 401→'unauthorized', 403→'forbidden', 404→'resource_not_found', 409→'conflict', 422/400-validation... Keep a small map with default 'error'.

Hmm — the controller will throw `HttpException` with a pre-shaped envelope body for validation (400) and sign-in failure (401). Or the controller throws a small `AuthError` class... Simplest: a helper in the controller file? "Zero business logic" — the error codes are presentation. I'll throw directly with the envelope body in the controller:

```ts
private static badRequest(fields: string[], message: string) {
  return new HttpException({ error: { code: 'validation_failed', message, details: { fields } } }, 400);
}
```
404 doesn't arise in these endpoints.

**Validation in controller**:
```ts
const email = typeof body?.email === 'string' ? body.email.trim() : '';
const password = typeof body?.password === 'string' ? body.password : '';
if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest(['email'], ...);
if (password.length < 8 || password.length > 128) throw badRequest(['password'], ...);
```
EMAIL_RE: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — basic.

**Sign-up response body**: define in controller:
```ts
const SIGN_UP_ACK = { message: 'If this address is new, a verification email is on its way.' };
```
Return from `@Post('sign-up')` handler → 200 by default. I want 202: add `@HttpCode(202)`.

Wait — should the service return something the controller uses, or does the controller return a constant? "Controller validates input and calls service. Zero business logic." The controller must call the service (to trigger creation/mail). After `await this.auth.signUp(email, password)`, return the constant ACK. The service returns void/constant. The byte-identity is guaranteed by the single constant + single @HttpCode.

**Sign-in**:
```ts
@Post('sign-in')
signIn(@Body() body: unknown) {
  ... validate ...
  const outcome = await this.auth.signIn(email, password);
  if (!outcome) throw new HttpException({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} } }, 401);
  return { message: 'Signed in.' };
}
```
Service `signIn` returns `true | false`? More typed: `Promise<SignInOutcome>` with `type SignInOutcome = { result: 'accepted' } | { result: 'rejected' }`. Controller: `if (outcome.result === 'rejected') throw ...`. Fine.

**Timing subtlety — sign-in branches**: known+wrong: lookup (found) + verify(stored). Unknown: lookup (null) + verify(dummy). Both one verify. ✓

**Another subtlety — the `dummyHash` is not ready**: `onModuleInit` awaits it before the app listens. If a request comes before that... can't happen via HTTP before init completes. But the service's `onModuleInit` runs during `app.init()`; the dummy is ready. To be safe, make `dummyHash` a `Promise` generated in the constructor? `this.dummyPromise = argon2.hash(...)` in constructor (sync start, async result) — then no lifecycle needed and always "in flight"; first request awaits it. That's robust:
```ts
constructor(...) {
  this.dummyHashPromise = argon2.hash(DUMMY_PASSWORD, ARGON2_OPTIONS);
}
```
Then in signIn: `const hash = user?.passwordHash ?? await this.dummyHashPromise;` — wait, if user is null we await the promise (already resolved by then). Clean, no lifecycle hook. The dummy hash is computed in the background at construction.

  Edge: if the app handles a request within milliseconds of startup and the dummy isn't ready, the unknown-email branch waits on the dummy (extra ms). Negligible, no correctness issue.

**Dummy password**: a fixed string, e.g. `'__timing_equalisation_dummy__'`. Non-secret; it's public anyway (the dummy hash is public).

**SECURITY.md (15-25 lines)**: mechanism: constant-time work on both branches — one argon2id op per request: sign-up always hashes; sign-in verifies against stored or a precomputed dummy hash with identical params; fixed response; fire-and-forget mail. Why over alternatives: (a) random delay padding — variance doesn't hide mean difference, recoverable with enough samples; (b) artificial constant sleep floor — adds latency but the work difference remains measurable and wastes resources; equalizing work removes the difference at the source; (c) checking existence before hashing (early return) — the obvious leak. What it doesn't protect against: account existence via other channels (login page, reset email, other endpoints), network-level metadata, user enumeration via account deletion/recovery flows, correlation of timing with other signals, brute force on the password (rate limiting is separate), resource exhaustion via very long passwords (capped at 128), the dummy hash being discovered (harmless). Keep 15-25 lines.

Let me count lines carefully — must be 15-25 lines total. I'll write ~22 lines.

**File list**:
1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20250201000000_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/prisma/prisma.service.ts`
9. `src/prisma/prisma.module.ts`
10. `src/mail/mail.port.ts` (token + interface)
11. `src/mail/mail.module.ts` (stand-in binding, ASSUMPTION)
12. `src/auth/auth.module.ts`
13. `src/auth/auth.controller.ts`
14. `src/auth/auth.service.ts`
15. `src/auth/auth.repository.ts`
16. `src/common/error-envelope.filter.ts`
17. `test/auth.spec.ts`
18. `SECURITY.md`

Maybe also `test/timing` helpers inline in the spec. Keep one spec file per convention (`test/<feature>.spec.ts`).

Now let me carefully write the actual code.

### package.json
```json
{
  "name": "identity-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^5.22.0",
    "argon2": "^0.43.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.15",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.9",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```
`start`: tsc outDir dist, rootDir? With `"outDir": "dist"` and files in src+prisma, the structure is `dist/src/main.js`. Set `"rootDir": "."`? Then `dist/src/main.js`. Or set rootDir src so `dist/main.js`; but prisma/ isn't compiled. tsconfig include: `["src"]`. Then dist/main.js. `start: node dist/main.js`. But vitest config file is outside src — vitest doesn't need tsconfig include for that (it transpiles itself). The test imports from ../src — fine.

  Hmm wait: tsconfig include `["src"]` — the test file `test/auth.spec.ts` isn't type-checked by `tsc -p tsconfig.json` (good for build) but vitest transpiles it. For editor type-check, maybe include test too: `"include": ["src", "test", "vitest.config.ts"]` with `noEmit`? But then `build` script `tsc -p tsconfig.json` with outDir would emit test files too... Use a separate `tsconfig.build.json`? More files. Simpler: tsconfig include is `["src"]` only for build; vitest handles test type loosely. Fine — keep include `["src"]`, `noEmit: false`, outDir dist.

  Actually with NodeNext + emitDecoratorMetadata: known quirk — `emitDecoratorMetadata` with `module: nodenext` is fine.

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "useDefineForClassFields": false
  },
  "include": ["src"]
}
```
`useDefineForClassFields: false` — important for NestJS DI (constructor injection with decorators) under ES2022 target; Nest docs recommend it. Yes, include.

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

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
  id           String   @id @default(uuid()) @map("id")
  email        String   @unique @map("email")
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
```

### Migration
`prisma/migrations/20250201000000_init/migration.sql`:
```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```
This matches Prisma's output for this schema. (Prisma names the PK constraint `users_pkey`, the unique index `users_email_key`.)

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```
Is `import 'reflect-metadata'` needed? @nestjs/core re-exports it? Nest docs: `import 'reflect-metadata'` in main for standalone TS. Include it.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_FILTER, useClass: ErrorEnvelopeFilter }],
})
export class AppModule {}
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

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
Global to avoid import dance? Convention says explicit import/export: "a provider used by another module is exportsed by its own module and that module is importsed by the other." So not @Global; AuthModule imports PrismaModule. Follow convention: no @Global.

### src/mail/mail.port.ts
```ts
/**
 * Contract for the outbound mail transport. The concrete implementation is
 * supplied by the host application; the auth feature only depends on this port.
 */
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
```
Symbol token is fine.

### src/mail/mail.module.ts
```ts
import { Module } from '@nestjs/common';
import { MAIL_PORT, MailPort } from './mail.port.js';

/**
 * Stand-in transport so the app boots without an external mail provider.
 * // ASSUMPTION: the real sendEmail implementation is supplied by the host app;
 * this binding exists only to keep the container resolvable.
 */
const consoleMailPort: MailPort = {
  async sendEmail(to, template, vars) {
    console.info(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  },
};

@Module({
  providers: [{ provide: MAIL_PORT, useValue: consoleMailPort }],
  exports: [MAIL_PORT],
})
export class MailModule {}
```
Hmm wait, the ASSUMPTION comment format: "mark with a single `// ASSUMPTION: <what was unresolved>` comment at the point that matters." Let me put exactly:
`// ASSUMPTION: a concrete sendEmail implementation is assumed to exist in the host app; this stand-in keeps the app bootable until one is bound.`
One comment. OK.

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateResult {
  created: boolean;
  user: User;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Creates the account unless a concurrent request already did; the unique
   * constraint is the source of truth, so the loser of the race reports
   * created=false instead of surfacing a 500.
   */
  async createIfAbsent(email: string, passwordHash: string): Promise<CreateResult> {
    try {
      const user = await this.prisma.user.create({ data: { email, passwordHash } });
      return { created: true, user };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user) return { created: false, user };
      }
      throw error;
    }
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

/**
 * argon2id at a real cost factor (32 MiB, 2 passes, OWASP recommends at least
 * 19 MiB / 2 passes). The cost is intentional: it is the work both branches
 * must perform so that no branch is cheaper than the other.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
};

// Public by design: its only purpose is to burn hash-time on the branch that
// has no stored hash to verify.
const DUMMY_PLAINTEXT = 'timing-equalisation-dummy';

export interface SignUpOutcome { accepted: true }
export interface SignInOutcome { result: 'accepted' | 'rejected' }
```
Hmm, let me define the outcomes:
```ts
export type SignUpOutcome = { result: 'accepted' };
export type SignInOutcome = { result: 'signed-in' } | { result: 'rejected' };
```

```ts
@Injectable()
export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    // Precomputed once per process, with the same parameters as real hashes,
    // so verifying against it takes the same time as verifying a real one.
    this.dummyHash = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    // Both branches pay one argon2 hash: a new address gets its password
    // stored, an existing address discards it. The branch below never gets a
    // chance to skip the work.
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      this.notify(email, 'signup-attempted');
      return { result: 'accepted' };
    }
    const { created } = await this.repository.createIfAbsent(email, passwordHash);
    this.notify(email, created ? 'verify-account' : 'signup-attempted');
    return { result: 'accepted' };
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const user = await this.repository.findByEmail(email);
    // Unknown address verifies against the dummy hash: identical parameters,
    // identical cost, identical (false) result. Wrong password verifies
    // against the stored hash and fails the same way.
    const hash = user ? user.passwordHash : await this.dummyHash;
    const verified = await argon2.verify(password, hash).catch(() => false);
    return user && verified ? { result: 'signed-in' } : { result: 'rejected' };
  }

  private notify(to: string, template: string): void {
    // Out of band: never awaited by the response path, never fails the request.
    void this.mail.sendEmail(to, template, { email: to }).catch(() => undefined);
  }
}
```
Wait — in the race case in signUp: createIfAbsent returns created=false → we've already hashed and the user exists → send 'signup-attempted'. But hmm, the `existing` check found null but create failed → someone created concurrently → correct to send attempted. But subtle: could we send both emails? No — single branch. Good.

  One more subtlety: `this.dummyHash` is constructed in the constructor via argon2.hash — it's in-flight during app init; the first sign-in on unknown email might await it. Fine.

  Also: sign-up "existing" branch — do I want to also `verify` against the stored hash to be extra safe? No — hashing fresh is already equal work. Hash and verify have near-identical cost (verify = hash + constant-time compare). Both ~one argon2 op. The L2 spec explicitly says "verify against a dummy hash generated with the same parameters" for the branch with no hash to check — in my sign-up, both branches do a hash (the branch without an account also does a hash). This satisfies "both paths did one [hash]."

  Hmm wait, actually let me reread L2 §2: "the cost of the password hash is what the attacker measures, so the branch with no hash to check must pay the same cost regardless — verify against a dummy hash generated with the same parameters. Both paths then take the time of a hash, because both paths did one."

  For sign-in: unknown-address branch has no hash to check → dummy verify. ✓ (my implementation).
  For sign-up: new-address branch has a hash to do; existing branch has none → my existing branch still does `argon2.hash` (which happens before the branch even!). Even stronger: the work happens unconditionally before the branch. ✓.

### src/auth/auth.controller.ts
```ts
import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// One fixed acknowledgment for every sign-up: neither branch reveals itself.
const SIGN_UP_ACKNOWLEDGEMENT = {
  message: 'If this address is new, a verification email is on its way.',
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<typeof SIGN_UP_ACKNOWLEDGEMENT> {
    const { email, password } = this.readCredentials(body);
    await this.authService.signUp(email, password);
    return SIGN_UP_ACKNOWLEDGEMENT;
  }

  @Post('sign-in')
  async signIn(@Body() body: unknown) {
    const { email, password } = this.readCredentials(body);
    const outcome = await this.authService.signIn(email, password);
    if (outcome.result === 'rejected') {
      // Deliberately the same error for unknown address and wrong password.
      throw new HttpException(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Email or password is incorrect.',
            details: {},
          },
        },
        401,
      );
    }
    return { message: 'Signed in.' };
  }

  private readCredentials(body: unknown): { email: string; password: string } {
    const raw = (typeof body === 'object' && body !== null ? body : {}) as { email?: unknown; password?: unknown };
    const email = typeof raw.email === 'string' ? raw.email.trim() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';
    const problems: string[] = [];
    if (!EMAIL_PATTERN.test(email) || email.length > 254) problems.push('email');
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) problems.push('password');
    if (problems.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_failed',
            message: `The following fields are invalid: ${problems.join(', ')}.`,
            details: { fields: problems },
          },
        },
        400,
      );
    }
    return { email, password };
  }
}
```
Endpoint path: the controller is 'auth' + 'sign-up' → `/auth/sign-up` ✓ (kebab-case; the task fixes these exact paths).

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}
```

### src/common/error-envelope.filter.ts
```ts
import { ArgumentsHost, BaseExceptionFilter, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, code, message, details } = this.describe(exception);
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const inner = (body as { error: Record<string, unknown> }).error;
        return {
          status,
          code: typeof inner.code === 'string' ? inner.code : this.codeForStatus(status),
          message: typeof inner.message === 'string' ? inner.message : this.codeForStatus(status),
          details: typeof inner.details === 'object' && inner.details !== null ? (inner.details as Record<string, unknown>) : {},
        };
      }
      if (typeof body === 'string') {
        return { status, code: this.codeForStatus(status), message: body, details: {} };
      }
      return { status, code: this.codeForStatus(status), message: 'Request failed.', details: {} };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'internal_error', message: 'Unexpected server error.', details: {} };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST: return 'bad_request';
      case HttpStatus.UNAUTHORIZED: return 'unauthorized';
      case HttpStatus.FORBIDDEN: return 'forbidden';
      case HttpStatus.NOT_FOUND: return 'resource_not_found';
      case HttpStatus.CONFLICT: return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY: return 'validation_failed';
      default: return 'error';
    }
  }
}
```
`HttpException.getResponse()` can return a string or an object. For a string body, Nest usually wraps? If you throw `new HttpException('msg', 400)`, getResponse returns the string 'msg'. Handled.

Note: when Nest can't parse a body (invalid JSON), it throws a 400 with an array message... `Cannot read properties` etc. — handled by the string/array fallback → 'bad_request'. Enough.

Also: 404 from an unknown route → Nest throws NotFoundException('Cannot POST /x') → envelope `resource_not_found`. Good.

### test/auth.spec.ts

Now the important one. Let me write it carefully.

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT } from '../src/mail/mail.port.js';
import type { MailPort } from '../src/mail/mail.port.js';
import type { User } from '@prisma/client';
```

Wait — importing `User` type from `@prisma/client` requires the generated client. In the test environment, `prisma generate` must have run. The fake returns objects shaped like User. To avoid a hard dependency on the generated client types in tests, I can type the fake rows structurally: `{ id: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date }`. The repo returns `User | null` per its type — the fake is cast `as unknown as PrismaService`. So no need to import User in tests. Good — fewer dependencies.

Fake prisma:
```ts
interface FakeRow { id: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date }

function createFakePrisma(): { service: object; rows: Map<string, FakeRow> } {
  const rows = new Map<string, FakeRow>();
  let nextId = 0;
  const service = {
    user: {
      async findUnique(args: { where: { email: string } }) {
        return rows.get(args.where.email) ?? null;
      },
      async create(args: { data: { email: string; passwordHash: string } }) {
        const { email, passwordHash } = args.data;
        if (rows.has(email)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row: FakeRow = {
          id: `row-${++nextId}`,
          email,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(email, row);
        return row;
      },
    },
  };
  return { service, rows };
}
```

Mail recorder:
```ts
interface SentMail { to: string; template: string; vars: Record<string, unknown> }
function createMailRecorder(fail = false) {
  const sent: SentMail[] = [];
  const port: MailPort = {
    async sendEmail(to, template, vars) {
      if (fail) throw new Error('mail transport down');
      sent.push({ to, template, vars });
    },
  };
  return { port, sent };
}
```

Build app:
```ts
async function buildApp(prisma: object, mail: MailPort) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prisma as unknown as PrismaService)
    .overrideProvider(MAIL_PORT).useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, server: app.getHttpServer() };
}
```
`createNestApplication({ logger: false })` to keep test output clean.

Helper to wait for async mail:
```ts
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for mail');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
```

Now the tests:

**describe sign-up byte-identity**:
```ts
it('returns byte-identical responses for a new and an existing address', async () => {
  const { service: prisma } = createFakePrisma();
  const { port } = createMailRecorder();
  const { app, server } = await buildApp(prisma, port);
  try {
    // Seed an account so we can compare the "existing" branch against a fresh "new" branch.
    const seed = await request(server).post('/auth/sign-up').send({ email: 'seed@example.test', password: 'seed-password-1' });
    expect(seed.status).toBe(202);

    const existing = await request(server).post('/auth/sign-up').send({ email: 'seed@example.test', password: 'other-password-9' });
    const fresh = await request(server).post('/auth/sign-up').send({ email: 'fresh-1@example.test', password: 'fresh-password-1' });

    expect(existing.status).toBe(202);
    expect(fresh.status).toBe(202);
    // Body, byte for byte
    expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text));
    // Headers, including content-length
    expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers));
    expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
  } finally { await app.close(); }
});
```
`stripVolatileHeaders`: remove `date`. Maybe also `set-cookie` (none). Implementation:
```ts
function stripVolatileHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'date' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}
```

  Note: supertest's `response.headers` — with Express, `content-length` is present. `connection` too? Does supertest set `connection: keep-alive`? The server response might not echo connection... Node's http server sets `Content-Type`, `Content-Length`, `Date`, `Connection: keep-alive`/`close`... Both responses go through the same server so same connection header. OK.

  Important: both responses have the same body → same content-length. ✓ "including anything that leaks length differences."

**sign-up creates / doesn't overwrite** (behavioral):
```ts
it('creates the account once and never overwrites an existing one', async () => {
  ...
  // create
  await post sign-up {email: 'u@example.test', password: 'original-pass-1'};
  // attempt again with a different password
  await post sign-up {email: 'u@example.test', password: 'rival-pass-99'};
  // original password still signs in...
  expect((await post sign-in {email, password:'original-pass-1'}).status).toBe(200);
  // ...and the rival password does not (the second sign-up must not have replaced the hash)
  expect((await post sign-in {email, password:'rival-pass-99'}).status).toBe(401);
});
```

**Mail behavior**:
```ts
it('sends a verification email for a new address', async () => {
  const { sent, port } = createMailRecorder();
  ...
  await post sign-up {email: 'new-1@example.test', password: 'password-123'};
  await waitUntil(() => sent.length === 1);
  expect(sent[0]).toEqual({ to: 'new-1@example.test', template: 'verify-account', vars: { email: 'new-1@example.test' } });
});

it('sends a "someone tried to sign up" email for an existing address and does not overwrite', async () => {
  seed; then sign-up again with a different password;
  await waitUntil(() => sent.filter(m => m.template === 'signup-attempted').length === 1);
  expect no 'verify-account' in sent;
});
```

**Mail failure invisible**:
```ts
it('a mail failure changes nothing the caller observes', async () => {
  const { port } = createMailRecorder(true); // always rejects
  seed first with a working mail app? No — seed in the same failing app: the first sign-up fires verify (fails), still 202.
  const first = await post sign-up new → 202
  const second = await post sign-up existing → 202
  expect bodies equal; status 202; no 5xx.
});
```

**sign-in byte-identity**:
```ts
it('returns byte-identical responses for a wrong password and an unknown address', async () => {
  seed user 'known@example.test' / 'known-pass-123';
  const wrongPassword = await post sign-in {email: 'known@example.test', password: 'wrong-pass-123'};
  const unknownAddress = await post sign-in {email: 'ghost@example.test', password: 'ghost-pass-123'};
  both 401; bytes equal; headers (minus date) equal; error envelope code 'invalid_credentials'.
});
```
Also assert the envelope shape: `expect(JSON.parse(wrongPassword.text)).toEqual({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} } })`.

**sign-in success**:
```ts
it('signs in with the correct credentials', ... expect 200 and body { message: 'Signed in.' });
```

**Validation envelope** (maybe):
```ts
it('rejects malformed input with the error envelope', async () => {
  const r = await post sign-up {email: 'nope', password: 'short'};
  expect(r.status).toBe(400);
  expect(JSON.parse(r.text)).toEqual({ error: { code: 'validation_failed', message: expect.any(String), details: { fields: ['email', 'password'] } } });
});
```
Message is a string with fields; use toMatchObject or check the code+details. Use:
```ts
expect(r.body).toMatchObject({ error: { code: 'validation_failed', details: { fields: ['email', 'password'] } } });
```

**Timing tests** — the core. Two tests (sign-up, sign-in), each: warmup, N interleaved samples, assert (a) |mean diff| ≤ tolerance, (b) min sample ≥ floor (real work).

```ts
const SAMPLES = 8;
const MIN_REAL_WORK_MS = 20;   // one argon2 pass at the configured cost is far above this
const MEAN_TOLERANCE_MS = 25;

async function timed(request: ..., server, payload): Promise<number> {
  const start = process.hrtime.bigint();
  const res = await request(server).post(path).send(payload);
  const end = process.hrtime.bigint();
  expect(res.status).toBe(expectedStatus);
  return Number(end - start) / 1e6;
}
```
Hmm, better to inline per test for clarity.

Sign-up timing:
```ts
it('sign-up: a new address and an existing address take statistically the same time', async () => {
  const { service } = createFakePrisma();
  const { port } = createMailRecorder();
  const { app, server } = await buildApp(service, port);
  try {
    const existingEmail = 'timing-existing@example.test';
    // Warm-up: JIT, sockets, argon2 native init — not measured.
    await request(server).post('/auth/sign-up').send({ email: existingEmail, password: 'warm-up-password' });
    await request(server).post('/auth/sign-up').send({ email: 'warm-new@example.test', password: 'warm-up-password' });

    const existingTimes: number[] = [];
    const freshTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      existingTimes.push(await timedPost(server, '/auth/sign-up', { email: existingEmail, password: `existing-${i}-pass` }));
      freshTimes.push(await timedPost(server, '/auth/sign-up', { email: `timing-fresh-${i}@example.test`, password: `fresh-${i}-pass` }));
    }

    const existingMean = average(existingTimes);
    const freshMean = average(freshTimes);
    const difference = Math.abs(existingMean - freshMean);
    const tolerance = Math.max(MEAN_TOLERANCE_MS, 0.25 * Math.min(existingMean, freshMean));

    // The two distributions must not be separable...
    expect(difference).toBeLessThanOrEqual(tolerance);
    // ...and both must actually be paying for a real hash, so the test cannot
    // pass by making both branches fast.
    expect(Math.min(...existingTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    expect(Math.min(...freshTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
  } finally {
    await app.close();
  }
}, 60_000);
```
`timedPost` helper:
```ts
async function timedPost(server: Server, path: string, payload: Record<string, unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  const response = await request(server).post(path).send(payload);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  expect(response.status).toBeLessThan(500);
  return elapsedMs;
}
```
Hmm — should the timing test assert status 202/401? For sign-up: 202. For sign-in: 401 (both branches are rejections). Asserting the expected status per branch ensures we're measuring the right branches. Let me pass an expected status:
```ts
async function timedPost(server, path, payload, expectedStatus: number) {
  ...
  expect(response.status).toBe(expectedStatus);
  ...
}
```

Sign-in timing:
```ts
it('sign-in: a wrong password and an unknown address take statistically the same time', async () => {
  seed known@example.test / 'known-pass-123';
  warm-up: sign-in known+wrong, sign-in ghost.
  loop i: known+`wrong-${i}` → 401; ghost-${i}@ + pass → 401.
  same assertions.
});
```

Also the floor: `Math.min(...times) >= 20`. Let me double-check the floor against the actual argon2 cost on a fast machine: argon2id 32MiB, t=2, p=1. On a 3GHz modern core, argon2id with 32MiB/2 passes: rough estimate ~30-80ms. Hmm, on a very fast machine (e.g. Apple M3) maybe 25-50ms. Min sample 20ms → safe. On a slow machine, it's bigger. OK.

  And the "remove hashing" scenario: requests are ~2-10ms (fake DB). Min < 20 → floor fails. ✓ (unless the machine is pathologically slow; acceptable.)

  Equalization-removed scenario (no dummy verify): unknown branch ~3ms, wrong-pass branch ~60ms → diff ≥ ~50ms > tolerance (25 or 25% of min mean ≈ 15-25) → fails. ✓

**One risk**: supertest's `request(server)` with the Nest app — the response is buffered; timing includes the full round-trip. Good.

**Another risk**: GC pauses or CI jitter could push the mean difference above 25ms. Tolerance `max(25, 25% of min mean)`: if the mean is ~80ms, tolerance = 25ms. Real diff between branches: sign-up: new does an extra insert (fake: microseconds! fake prisma is in-memory — insert is ~0.01ms). So the actual diff ≈ 0 + noise. Sign-in: both verify; stored vs dummy hash — same params, same cost. Diff ≈ noise. Noise on localhost: typically <5ms; occasional 10-20ms spikes from GC could push the *mean* of 8 samples? Mean of 8 with one 30ms outlier shifts the mean by ~4ms. Should be fine. Maybe bump SAMPLES to 10 and tolerance formula to `max(25, 0.3 * min)`. Let me use SAMPLES=10, tolerance `Math.max(25, 0.3 * Math.min(means))`. At mean 80 → 24 → tolerance 25. Fine.

  Hmm, actually let me reconsider the cost to balance runtime: with 32MiB/t2 at ~100ms per op: sign-up timing = warmup 2 + 20 samples = 22 ops ≈ 2.2s; sign-in = 22 ops ≈ 2.2s; other tests ≈ 10 more ops ≈ 1s. Total ~6-8s. Fine.

**Now, a critical check — `@Inject(MAIL_PORT)` with a Symbol token**: the controller/service uses `@Inject(MAIL_PORT)`. The override in tests is by the same token. ✓. The MailModule's provider `useValue`. ✓.

**Prisma override**: the AuthModule imports PrismaModule which provides PrismaService; the test overrides with `PrismaService` token → `useValue(fake)`. ✓. Since it's overridden, the real `PrismaService` (which extends PrismaClient) is never instantiated → no DB connection. ✓.

  But wait: `PrismaService extends PrismaClient` — the class definition is imported by prisma.service.ts, which imports `@prisma/client` — the generated client must exist for TS to compile/run. That's a repo prerequisite (`prisma generate`), standard. In a test run, `@prisma/client` without generate throws "did not initialize yet." The import itself (module load) — the default `@prisma/client` index throws on import if not generated? Yes: the `require('@prisma/client')` default entry throws an error when the client isn't generated. So tests need `prisma generate` first. That's normal Prisma workflow. Alternatively, make the fake not require the real client... but the service module imports PrismaService which imports @prisma/client — unavoidable. Document in package.json scripts? Add a `"pretest": "prisma generate"` script? That helps: `"test": "prisma generate && vitest run"`? Hmm, `prisma generate` needs the schema — fine, it's in the repo. Let me add `"pretest": "prisma generate"` — pnpm/npm runs pretest automatically. Wait, does `vitest run` trigger `pretest`? npm runs `pretest` before `test`. With pnpm too. But if someone runs `vitest` directly, no pretest. Let me do `"test": "prisma generate && vitest run"` — explicit. But generate is fast (~1-2s). OK.

  Hmm, does `prisma generate` work without DATABASE_URL? Yes, generate doesn't need a connection. ✓. And `@prisma/client` in dependencies; the postinstall typically generates. I'll rely on the script.

**ESM import extensions**: in the test file, imports of `../src/app.module.js` etc. — Vitest resolves `.js` → `.ts`. I'm fairly confident Vitest (Vite) handles this in a Node ESM project with a tsconfig module nodenext... Actually let me double-check: Vite's resolver has special handling: if the importer is a TS file and the specifier ends in `.js`/`.jsx`/`.mjs`, it tries the corresponding `.ts`. Yes — this is standard and works in Vitest for TS projects (it's how people test ESM TS packages). OK.

  Also `import request from 'supertest'` — supertest is CJS; the default import with esModuleInterop works.

  `import argon2 from 'argon2'` — argon2 is CJS (node-gyp-build). Default import OK. `argon2.argon2id` is accessible as a named property via default: `argon2.argon2id` — with default import, `argon2.argon2id` works (the CJS exports object). ✓.

  `argon2.Options` type: argon2 ships types; `argon2.Options` as a type — with default import in CJS, the namespace types: `import argon2 from 'argon2'` gives a value; for a type, I'd use `import type { Options } from 'argon2'`. The argon2 package types: it exports `Options` interface. Let me use `import argon2, { type Options } from 'argon2';`? Hmm, CJS + esModuleInterop: named type imports from a CJS module with a d.ts using `export =`... argon2's d.ts: I think it uses named exports (`export interface Options {...}`, `export function hash(...)`). With NodeNext resolution on a CJS dep, `import argon2 from 'argon2'` maps to the default = module.exports. And `import { Options } from 'argon2'` for types — in NodeNext, importing a named type from CJS is allowed (types are erased). To be safe:
  ```ts
  import argon2 from 'argon2';
  ...
  const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 32_768,
    timeCost: 2,
    parallelism: 1,
  } as const;
  ```
  Wait, `as const` makes type a literal `typeof argon2.argon2id`... `argon2.hash(password, ARGON2_OPTIONS)` — the parameter type is `Options | undefined`; the literal object with `type: Argon2Type` (a numeric enum-ish const) is structurally compatible. `as const` makes parallelism a literal 1 — assignable to number. Fine. Or type it: `import type { Options } from 'argon2'` — if argon2's d.ts is `export =`-style this fails in NodeNext... Let me check what I recall about argon2's types: `argon2.d.ts` uses ES named exports:
  ```ts
  declare const argon2: { ... };
  export = argon2;
  ```
  Hmm, I really recall argon2's types being `export = argon2` style (a namespace with properties including the `Options` interface and `argon2id` etc). With `export =` under NodeNext, `import argon2 from 'argon2'` is correct (esModuleInterop), and for a type: `import argon2 = require('argon2')`? No — under NodeNext, in an ESM file, `import argon2 from 'argon2'` works with esModuleInterop for the value. For a type from an `export =` namespace: `import type { Options } from 'argon2'`? Under NodeNext, if the CJS module uses `export =` with a namespace, `import { Options } from 'argon2'` is... allowed in TS if the namespace has that member? For a CJS module with `export =`, TS allows `import { X } from 'cjs'` if X is a member (via interop). Types only: `import type { Options } from 'argon2'` should work.

  To eliminate risk, let me avoid the `Options` type entirely:
  ```ts
  const ARGON2_OPTIONS: {
    type: typeof argon2.argon2id;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  } = { ... };
  ```
  Ugh. Simpler: just inline the object without a type annotation; TS infers; `argon2.hash` accepts `Options` — structural check at the call site. `type: argon2.argon2id` is inferred as `2` (numeric literal) — `Options['type']` is a numeric union (1|2|3 via the argon2d/i/id constants). Inferred literal 2 is assignable. But widening: without `as const`, the inferred type of `type: argon2.argon2id` — `argon2.argon2id` is a const numeric (declared `const argon2id: 3`? or `number`?). In argon2's d.ts: `argon2id: 3;` I think it's declared as a property of type number... If it's `number`, then `type: number` is not assignable to `1 | 2 | 3`?? Let me recall argon2's actual types:

  ```ts
  export interface Options {
      parallelism?: number;
      memoryCost?: number;
      timeCost?: number;
      type?: 1 | 2 | 3;
      outputLen?: number;
      ad?: Buffer;
      secretKey?: Buffer;
      hashLength?: number; // older
  }
  export const argon2d: 1;
  export const argon2i: 2;
  export const argon2id: 3;
  ```
  I think the constants are typed as literal types (`1`, `2`, `3`). If so, `type: argon2.argon2id` infers as `3` ✓.

  Under `export =` namespace: `argon2.argon2id` — property type. Should be fine.

  Safest: skip the annotation:
  ```ts
  const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 32_768,
    timeCost: 2,
    parallelism: 1,
  };
  ```
  And pass directly. If `argon2id` is literal 3 → fine. I'll go with this.

**Vitest + Nest ESM**: NestJS decorators with ESM output under vitest — vitest transpiles TS with esbuild; decorators are supported (esbuild supports experimentalDecorators via tsconfig). Nest's DI uses `reflect-metadata` — in vitest, `import 'reflect-metadata'` in main is only loaded in main; but the tests don't import main. Do tests need reflect-metadata? Nest's testing module needs decorator metadata — `emitDecoratorMetadata`/esbuild's `useDefineForClassFields:false` + design:paramtypes. esbuild supports emitting decorator metadata? esbuild supports `experimentalDecorators` and emits `design:type` etc.? Yes, esbuild supports `emitDecoratorMetadata`? Hmm — historically esbuild didn't support `emitDecoratorMetadata`... Actually esbuild does support it now? Let me think. esbuild's docs: "esbuild supports TypeScript decorators... `experimentalDecorators`... `emitDecoratorMetadata` is not supported by esbuild" — I recall esbuild doesn't support emitDecoratorMetadata. But NestJS works under Vitest in thousands of projects... How? Nest's DI for constructor injection: if there's no metadata, Nest uses the parameter's injection token from... For `constructor(private readonly repository: AuthRepository)`, Nest needs design:paramtypes to resolve `AuthRepository`. Without metadata, Nest can't resolve → error "Nest can't resolve dependencies."

  But: does esbuild actually support emitDecoratorMetadata? Let me recall more carefully. esbuild added TypeScript `experimentalDecorators` support long ago; and `emitDecoratorMetadata`? Searching my memory: the esbuild issue #1878 "support emitDecoratorMetadata" — I think esbuild implemented it (in v0.14.51? or later, added support for emitting `design:type` metadata for some types). Hmm. Actually I now recall: esbuild supports `emitDecoratorMetadata` since v0.14.?? — there was a changelog entry "Add support for TypeScript's emitDecoratorMetadata" — yes, I'm fairly confident esbuild emits the standard decorator metadata (design:paramtypes, design:type) when `experimentalDecorators` + `emitDecoratorMetadata` are set in tsconfig. Vitest reads tsconfig. And there's a well-known caveat: it doesn't emit for things that TS can't infer (e.g. type-only imports) — same as tsc.

  Given the widespread use of NestJS + Vitest (e.g. `@nestjs/testing` with vitest is a common modern setup), this works. To be safer, I can add explicit `@Inject` tokens for constructor deps? That deviates from the convention. Alternatively, add `reflect-metadata` import in the spec: `import 'reflect-metadata';` at the top of the test — needed so `Reflect.getMetadata` works. @nestjs/core imports it itself? @nestjs/common has a dependency on reflect-metadata and loads it. Usually just works. Let me add `import 'reflect-metadata';` at the top of the spec file for safety — harmless.

  Also, the vitest config could set `esbuild: { target: 'es2022' }` and pick up the tsconfig for decorators. Vitest reads tsconfig.json by default via esbuild. tsconfig has `experimentalDecorators: true, emitDecoratorMetadata: true`. OK.

  Hmm, one more wrinkle: `useDefineForClassFields: false` — esbuild also honors tsconfig's `useDefineForClassFields`. Fine.

**Nest + ESM + `@Inject(MAIL_PORT)` Symbol**: fine.

**Now the timing test and `app.close()`**: closing the app closes the HTTP server. Between tests, build a new app. `beforeEach`/per-test build is cleanest. Each app build is ~100-300ms + dummy hash in-flight (not awaited). Fine.

  Note: each `buildApp` constructs `AuthService` → starts a background `argon2.hash` for the dummy. On `app.close()`, the dummy promise might still be pending — that's OK, it resolves in the background; no unhandled rejection (argon2.hash resolves or rejects; if it rejects, unhandled!). For safety: `.catch`? The dummy hash should never fail. But to be strictly safe against unhandled rejection warnings in tests:
  ```ts
  this.dummyHash = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS).catch((error) => {
    throw error; // hmm, that's still unhandled
  });
  ```
  No — let me just leave `this.dummyHash = argon2.hash(...)`; it won't reject in practice. OK.

**Sign-up: email case normalization?** "existing address" — is `Foo@x.com` vs `foo@x.com` the same? Real systems normalize to lowercase. If I don't normalize, an attacker could probe with different casings and get different DB hits → but the response is the same anyway (202 always). Timing: the casing variant of an existing email is treated as "new" → different branch timing (hash+insert vs hash) — tiny (insert ~ms). But more importantly, we'd create a duplicate account with different casing → data integrity issue. Normalize: `email.toLowerCase()` in the controller (input normalization = validation territory). I'll trim + lowercase. Add a test? "sign-up with different casing of an existing address produces the same response" — the response is always the same anyway; the behavioral test: casing variant doesn't create a duplicate: sign-up 'User@X.test', then sign-up 'user@x.test' with a different password → sign-in with the original password still works. Include as a small assertion in the "doesn't overwrite" test. Keep it light.

**Response `content-type`**: `application/json; charset=utf-8` — same for both. ✓

**Now — "same headers"**: does Express add `X-Powered-By`? Same for both. `Date` differs (per-request timestamp) — stripped in the comparison, noted in a comment. Everything else is deterministic. ✓

**Double-check the service's zero-Prisma-calls rule**: the service calls only the repository ✓. Controller: only validation + calling the service + throwing HttpException ✓ (no business logic). Repository: only Prisma ✓.

**Migration filename**: `20250201000000_init` — Prisma convention `<timestamp>_name`. Fine.

**`.gitignore` too?** Not asked. Skip. **README?** Not asked. Skip.

Now, **line count for SECURITY.md (15-25 lines)**. Let me draft:

```md
# Sign-up / sign-in enumeration protection

## Mechanism

- Every `POST /auth/sign-up` performs exactly one argon2id hash (32 MiB, 2 passes,
  parallelism 1) before touching the database: a new address stores it, an existing
  one discards it. Neither branch can skip the work.
- Every `POST /auth/sign-in` performs exactly one argon2id verify: against the
  stored hash for a known address, or against a precomputed dummy hash with
  identical parameters for an unknown one.
- Both branches of both endpoints return the same status, body, and headers; the
  only per-branch side effect (verification vs "attempted" email) is fired without
  being awaited, so it neither changes the response nor its timing.

## Why this, and not the alternatives

- Early-return on a found address (the naive fix) is the leak itself.
- Random delay padding adds variance, not equivalence: the mean of the two
  branches still differs, and enough samples recover the signal.
- A constant sleep floor masks nothing but the floor itself — the hash cost
  difference remains on top of it, and it taxes every request. Equalising the
  *work* removes the difference at the source.

## What this does not protect against

- Enumeration via other surfaces (password reset, account deletion, other
  endpoints that answer differently for known vs unknown addresses).
- An attacker who can observe the *database* (write amplification: the new
  branch inserts a row) or correlate with unrelated signals.
- Brute force of the password: nothing here rate-limits; add throttling
  separately.
- The dummy hash is public knowledge by design; it protects timing, not secrecy.
```
Let me count lines: I'll count when writing. The target is 15-25 lines total including headings/blank lines? "SECURITY.md (15–25 lines)" — I'll keep the total line count (including blanks) in 15-25. The draft above: let me count:

1 `# Sign-up / sign-in enumeration protection`
2 ``
3 `## Mechanism`
4 ``
5 `- Every POST...`
6 `  one discards it...`
7 `- Every POST /auth/sign-in...`
8 `  identical parameters...`
9 `- Both branches...`
10 `  being awaited...`
11 ``
12 `## Why this, and not the alternatives`
13 ``
14 `- Early-return...`
15 `- Random delay padding...`
16 `  branches still differs...`
17 `- A constant sleep floor...`
18 `  difference remains...`
19 ``
20 `## What this does not protect against`
21 ``
22 `- Enumeration via other surfaces...`
23 `  endpoints that answer differently...`
24 `- An attacker who can observe the database...`
25 `  branch inserts a row)...`
26 `- Brute force...`
27 `  separately.`
28 `- The dummy hash...`

28 lines — slightly over. Trim to ≤25. Let me compress:

```md
# Enumeration protection for /auth/sign-up and /auth/sign-in

## Mechanism
Every sign-up performs exactly one argon2id hash (32 MiB, 2 passes, parallelism 1)
before any database access: a new address stores it, an existing address discards it.
Every sign-in performs exactly one argon2id verify: against the stored hash for a
known address, or against a precomputed dummy hash with identical parameters for an
unknown one. Both branches of both endpoints return the same status, body, and
headers; the only per-branch side effect (verification vs "attempted" email) is
fired without being awaited, so it changes neither the response nor its timing.

## Why this, and not the alternatives
- Early-return on a found address is the naive fix and is the leak itself.
- Random delay padding adds variance, not equivalence: the branch means still
  differ, and enough samples recover the signal.
- A constant sleep floor sits on top of the unremoved work difference and taxes
  every request; equalising the work removes the difference at the source.

## What this does not protect against
- Enumeration through other surfaces (password reset, deletion, other endpoints
  that answer differently for known vs unknown addresses).
- A database-side observer: the new-account branch writes a row.
- Password brute force; this is not rate limiting.
- The dummy hash is public by design: it equalises timing, it is not a secret.
```
Count:
1 `# Enumeration protection...`
2 ``
3 `## Mechanism`
4 `Every sign-up...`
5 `before any database...`
6 `Every sign-in...`
7 `known address, or...`
8 `unknown one. Both...`
9 `headers; the only...`
10 `fired without...`
11 ``
12 `## Why this...`
13 `- Early-return...`
14 `- Random delay...`
15 `  differ, and enough...`
16 `- A constant sleep...`
17 `  every request...`
18 ``
19 `## What this does not...`
20 `- Enumeration through...`
21 `  that answer...`
22 `- A database-side...`
23 `- Password brute force...`
24 `- The dummy hash...`

24 lines ✓ (within 15-25).

Now the full **test file**. Let me write it out completely and carefully.

```ts
import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.port.js';
```
Wait — does `@nestjs/common`'s INestApplication type export exist? Yes: `import { INestApplication } from '@nestjs/common';` (type-only usage is fine, use `import type`).

Fake prisma and mail recorder as above.

Full spec:

```ts
type FakeRow = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

function createFakePrisma(): { service: unknown; rows: Map<string, FakeRow> } {
  const rows = new Map<string, FakeRow>();
  let nextId = 0;
  const service = {
    user: {
      async findUnique(args: { where: { email: string } }): Promise<FakeRow | null> {
        return rows.get(args.where.email) ?? null;
      },
      async create(args: { data: { email: string; passwordHash: string } }): Promise<FakeRow> {
        const { email, passwordHash } = args.data;
        if (rows.has(email)) {
          throw Object.assign(new Error('Unique constraint failed on users_email_key'), { code: 'P2002' });
        }
        const row: FakeRow = {
          id: `row-${++nextId}`,
          email,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(email, row);
        return row;
      },
    },
  };
  return { service, rows };
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

function createMailPort(fail: boolean): { port: MailPort; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const port: MailPort = {
    async sendEmail(to, template, vars) {
      if (fail) throw new Error('mail transport unavailable');
      sent.push({ to, template, vars });
    },
  };
  return { port, sent };
}

async function buildApp(prisma: unknown, mailPort: MailPort): Promise<{ app: INestApplication; server: Server }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma as PrismaService)
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, server: app.getHttpServer() };
}

async function signUp(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-up').send({ email, password });
}

async function signIn(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-in').send({ email, password });
}

function stripVolatileHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'date' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function timedPost(server: Server, path: string, email: string, password: string, expectedStatus: number): Promise<number> {
  const startedAt = process.hrtime.bigint();
  const response = await request(server).post(path).send({ email, password });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  expect(response.status).toBe(expectedStatus);
  return elapsedMs;
}

const SAMPLES = 10;
// One argon2id pass at the configured cost (32 MiB, 2 passes) is far above
// this; a request that skips the hashing sits well below it.
const MIN_REAL_WORK_MS = 20;
```

Now the describe blocks:

```ts
describe('POST /auth/sign-up', () => {
  it('returns byte-identical responses for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const seed = await signUp(server, 'seeded@example.test', 'seeded-password-1');
      expect(seed.status).toBe(202);

      const existing = await signUp(server, 'seeded@example.test', 'rival-password-9');
      const fresh = await signUp(server, 'brand-new@example.test', 'brand-new-pass-1');

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text));
      expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
    } finally {
      await app.close();
    }
  });

  it('creates the account once and never overwrites an existing one', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      await expect(signUp(server, 'owner@example.test', 'original-password-1')).resolves.toBe(202)?? 
```
Hmm — `signUp` returns a supertest response (a thenable). `await signUp(...)` returns the response. Let me write it plainly:
```ts
      const first = await signUp(server, 'owner@example.test', 'original-password-1');
      expect(first.status).toBe(202);
      const again = await signUp(server, 'owner@example.test', 'rival-password-99');
      expect(again.status).toBe(202);

      const withOriginal = await signIn(server, 'owner@example.test', 'original-password-1');
      expect(withOriginal.status).toBe(200);

      const withRival = await signIn(server, 'owner@example.test', 'rival-password-99');
      expect(withRival.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('treats case variants of the same address as the same address', async () => {
    ... signUp 'Mixed.Case@Example.test' / 'original-password-1';
    ... signUp 'mixed.case@example.test' / 'rival-password-99';
    sign-in with 'MIXED.CASE@example.test' + original → 200;
    sign-in with rival → 401;
  });

  it('sends a verification email, and only one, for a new address', async () => {
    const { port, sent } = createMailPort(false);
    ...
    const res = await signUp(server, 'newbie@example.test', 'newbie-password-1');
    expect(res.status).toBe(202);
    await waitUntil(() => sent.length === 1, 'the verification email');
    expect(sent).toEqual([
      { to: 'newbie@example.test', template: 'verify-account', vars: { email: 'newbie@example.test' } },
    ]);
  });

  it('sends a "someone tried to sign up" email for an existing address', async () => {
    seed; then sign-up again with a different password;
    await waitUntil(() => sent.filter((m) => m.template === 'signup-attempted').length === 1, 'the attempted email');
    expect(sent.some((m) => m.template === 'verify-account')).toBe(false);
    expect(sent.find((m) => m.template === 'signup-attempted')?.to).toBe('seeded@example.test');
  });

  it('changes nothing the caller observes when mail delivery fails', async () => {
    const { port } = createMailPort(true);
    const { service } = createFakePrisma();
    const { app, server } = await buildApp(service, port);
    try {
      const fresh = await signUp(server, 'no-mail-1@example.test', 'no-mail-pass-1');
      const existing = await signUp(server, 'no-mail-1@example.test', 'no-mail-pass-2');
      expect(fresh.status).toBe(202);
      expect(existing.status).toBe(202);
      expect(Buffer.from(fresh.text)).toEqual(Buffer.from(existing.text));
    } finally { await app.close(); }
  });

  it('rejects malformed input with the error envelope', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const res = await request(server).post('/auth/sign-up').send({ email: 'not-an-email', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'validation_failed', details: { fields: ['email', 'password'] } },
      });
      expect(typeof res.body.error.message).toBe('string');
    } finally { await app.close(); }
  });

  it('takes statistically the same time for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const existingEmail = 'timing-existing@example.test';
      // Warm-up: socket, argon2 native init — not part of the measurement.
      await signUp(server, existingEmail, 'warm-up-password-1');
      await signUp(server, 'warm-up-new@example.test', 'warm-up-password-1');

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        existingTimes.push(await timedPost(server, '/auth/sign-up', existingEmail, `existing-sample-${i}-pass`, 202));
        freshTimes.push(await timedPost(server, '/auth/sign-up', `timing-fresh-${i}@example.test`, `fresh-sample-${i}-pass`, 202));
      }

      const existingMean = average(existingTimes);
      const freshMean = average(freshTimes);
      const toleranceMs = Math.max(25, 0.3 * Math.min(existingMean, freshMean));

      // The two distributions must not be separable...
      expect(Math.abs(existingMean - freshMean)).toBeLessThanOrEqual(toleranceMs);
      // ...and both must be paying for real hashing, so removing the hashing
      // (and making both branches fast) cannot pass this test.
      expect(Math.min(...existingTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...freshTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});
```

Wait — in the sign-up timing test, the fresh branch of each iteration inserts a new row (unique email per i) ✓; the existing branch hits the same row ✓.

**sign-in describe**:
```ts
describe('POST /auth/sign-in', () => {
  it('returns byte-identical responses for a wrong password and an unknown address', async () => {
    seed 'known@example.test' / 'known-password-123' via sign-up;
    const wrongPassword = await signIn(server, 'known@example.test', 'wrong-password-123');
    const unknownAddress = await signIn(server, 'ghost@example.test', 'ghost-password-123');
    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(401);
    expect(Buffer.from(wrongPassword.text)).toEqual(Buffer.from(unknownAddress.text));
    expect(stripVolatileHeaders(wrongPassword.headers)).toEqual(stripVolatileHeaders(unknownAddress.headers));
    expect(wrongPassword.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} },
    });
  });

  it('accepts the correct credentials', async () => {
    seed; sign-in correct → 200 { message: 'Signed in.' };
  });

  it('takes statistically the same time for a wrong password and an unknown address', async () => {
    seed known;
    warm-up: sign-in known + wrong (401), ghost (401);
    loop: known + `wrong-${i}` → 401; `ghost-${i}@example.test` + pass → 401;
    same mean/floor assertions.
  }, 60_000);
});
```

Timing sign-in: the wrong-password branch verifies against the stored hash; the unknown branch verifies against the dummy. Both 401. ✓

**Now — a potential issue: `expect(...).resolves` on supertest?** Not used; always `await`.

**`res.body`** — supertest parses JSON when content-type is json ✓.

**Timing test flake risk**: the first `timedPost` in each branch might include socket reuse effects... warm-up covers it. OK.

**Another subtlety**: in the sign-up timing test, each fresh sample creates a new row — the Map grows to 10 rows; negligible.

**Mail recorder in the timing tests**: sendEmail resolves immediately and pushes; the un-awaited fire-and-forget — after the response, the promise chain (async function) resolves on a microtask → sent grows. No interference.

**`app.close()`** with pending fire-and-forget mail — the recorder has no sockets; fine.

**Now, `createNestApplication({ logger: false })`** — signature: `createNestApplication(httpAdapter?, options?)`. Passing options as the first argument works: `createNestApplication({ logger: false })` ✓ (options without an adapter).

**PrismaService override**: `useValue(prisma as PrismaService)` — prisma is `unknown`/object; the cast is fine.

**Import of AppModule in the test**: AppModule imports AuthModule → PrismaModule (provides the real PrismaService — overridden) and MailModule (provides the real stand-in — overridden). ✓

**Now, re-check the convention "Endpoints: kebab-case, plural"**: `/auth/sign-up`, `/auth/sign-in` — kebab ✓; plural — these are task-mandated exact paths; the task overrides the convention (the task statement carries everything). Fine.

**File naming**: `auth.controller.ts` etc. ✓ kebab + role.

**main.ts port**: `process.env.PORT` only (config from env) — `Number(process.env.PORT ?? 3000)`. Hmm, default 3000 is a hardcoded fallback, not a secret — acceptable? "Configuration from environment variables only." A default for the dev port is standard. Keep the fallback.

**Check: the service has no Prisma calls** ✓; the repository only Prisma ✓.

**`@Inject` import**: in the service: `import { Injectable, Inject } from '@nestjs/common';` ✓.

**argon2 default import under NodeNext**: argon2's package.json has no "exports"? It has `main: argon2.js` (CJS). NodeNext: `import argon2 from 'argon2'` in a TS ESM file → resolves to CJS default = module.exports ✓. Runtime under vitest: Vite interop ✓. Runtime under compiled Node: CJS default import ✓.

  argon2 native: needs a prebuild for the platform — the standard.

**Check for unhandled rejection in the "mail failure" test**: `void this.mail.sendEmail(...).catch(() => undefined)` — handled ✓. The test asserts 202 ✓.

**One more consideration — `Promise` rejection from `argon2.verify` on unknown email**: the hash is the dummy (valid), the verify is false (not throw) ✓. On a known user with a valid stored hash, verify is false on wrong password ✓.

**Edge: `argon2.verify` with an empty password?** The controller enforces min 8 ✓.

**Byte-identity check with `stripVolatileHeaders`**: supertest's headers object keys are lowercase ✓.

Now — the timing test asserts `min >= 20ms`. One worry: on a very fast machine, argon2id 32MiB/2/1 is ~25-40ms; plus overhead; min ≥ 20 ✓. On Windows CI (slower), it's bigger ✓.

And the mean difference tolerance: the actual diff ≈ (insert cost in the fake ≈ 0) + noise. Safe.

But wait — one real asymmetry in the sign-up timing: the fresh branch's `createIfAbsent` → the fake's `create` — microseconds. The existing branch — no create. Both ~equal. ✓

In the sign-in timing: the wrong-password branch — `user.passwordHash` (real ~97-char string); the unknown — the dummy (same length, same params). argon2 verify cost depends on the params encoded in the hash — identical. ✓

**Vitest globals**: I import explicitly from 'vitest' ✓ (no globals config needed).

**vitest.config.ts** — with a `test` block; also `esbuild: { ... }`? Vitest picks up tsconfig for esbuild options (experimentalDecorators etc.) — yes, Vite reads tsconfig.json for esbuild. ✓

Now, **package.json "pretest"** — I'll go with `"test": "prisma generate && vitest run"`. Hmm, but `prisma generate` writes to node_modules/.prisma — fine.

  Actually, also add `"postinstall": "prisma generate"`? Common in Prisma templates. Include it? Helpful; harmless. Let me include it.

**tsconfig `types`**: `@types/node` is picked up automatically. ✓

**Check `stripVolatileHeaders` types**: supertest's `response.headers` type is `IncomingHttpHeaders` (Record<string, string | string[] | undefined>). My function signature `Record<string, unknown>` — IncomingHttpHeaders is assignable to Record<string, unknown>? An index signature with string | string[] | undefined values → values are unknown ✓, keys are string ✓. Assignable ✓.

**`expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers))`** ✓.

Now let me also double-check the **error envelope for validation**: the controller throws an HttpException with a body object that has `error` — the filter detects `'error' in body` → uses the code/message/details from the body ✓.

**404 unknown route** → Nest's NotFoundException → getResponse returns an object `{ statusCode: 404, message: 'Cannot POST /x', error: 'Not Found' }` — note: that object has an `error` key (a string 'Not Found')! My filter: `'error' in body` is true; `inner = body.error` is a string → `typeof inner === 'object'`? My check: `typeof body === 'object' && body !== null && 'error' in body` then `inner = (body as {error: Record}).error` — inner is the string 'Not Found' → `typeof inner.code === 'string'` is false → falls back to codeForStatus(404) = 'resource_not_found' ✓; message: `typeof inner.message === 'string'`? inner is a string → `.message` is undefined → message = codeForStatus = 'resource_not_found'?? Hmm, message would be 'resource_not_found' — ugly. Better handling: if inner is a string → treat as message. Let me restructure:

```ts
const body = exception.getResponse();
if (typeof body === 'string') {
  return { status, code: this.codeForStatus(status), message: body, details: {} };
}
if (typeof body === 'object' && body !== null) {
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'object' && record.error !== null) {
    const inner = record.error as Record<string, unknown>;
    return {
      status,
      code: typeof inner.code === 'string' ? inner.code : this.codeForStatus(status),
      message: typeof inner.message === 'string' ? inner.message : this.codeForStatus(status),
      details: isPlainObject(inner.details) ? inner.details : {},
    };
  }
  // Nest's default shape: { statusCode, message, error? }
  return { status, code: this.codeForStatus(status), message: typeof record.message === 'string' ? record.message : 'Request failed.', details: {} };
}
```
`isPlainObject` helper: `typeof v === 'object' && v !== null && !Array.isArray(v)`.

That's robust.

**Now, let me write out all files completely.** Also decide the app name and keep the code in English.

Also: **`src/common/error-envelope.filter.ts`** — the layout convention doesn't have `src/common`, but it's needed; acceptable ("decide the file layout yourself").

Wait, one more: the convention says "controller validates input" — my controller's `readCredentials` does validation ✓ and "calls the service" ✓.

**Repository return types**: `findByEmail(email: string): Promise<User | null>` — Prisma's findUnique returns `Prisma.UserGetPayload... | null` = `User | null` ✓.

**`createIfAbsent` return**: I said `Promise<CreateResult>` with `{ created, user }`. The service uses only `created`. Keep `user`? Unused → drop it to avoid dead code: return `Promise<boolean>` (created?). Hmm, name: `createIfAbsent(...): Promise<boolean>` — true if it created. Let me do that.

Race note: after the unique violation, no need to re-fetch — the service only needs the boolean. Simpler:
```ts
async createIfAbsent(email: string, passwordHash: string): Promise<boolean> {
  try {
    await this.prisma.user.create({ data: { email, passwordHash } });
    return true;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}
```
✓.

**Service signUp with the race**:
```ts
async signUp(email: string, password: string): Promise<SignUpOutcome> {
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  const existing = await this.repository.findByEmail(email);
  if (existing) {
    this.deliverAttemptNotice(email);
    return { result: 'accepted' };
  }
  const created = await this.repository.createIfAbsent(email, passwordHash);
  if (created) this.deliverVerification(email); else this.deliverAttemptNotice(email);
  return { result: 'accepted' };
}
```

**Mail templates**: 'verify-account' and 'signup-attempted'. Fine.

**Outcome types**:
```ts
export type SignUpOutcome = { result: 'accepted' };
export type SignInOutcome = { result: 'signed-in' } | { result: 'rejected' };
```

The controller uses `outcome.result === 'rejected'`.

**Now, a potential issue: does the `@prisma/client` import in the repository (`import { User } from '@prisma/client'`) work before generate in the editor?** Requires generate — standard.

**Check: the test imports `AppModule` which imports `AuthModule` → `PrismaModule` → `PrismaService` → `@prisma/client` — the generated client loads `PrismaClient` — instantiation is only attempted on `onModuleInit` if not overridden. It's overridden → the real class is not instantiated. But the import of `@prisma/client` at module load: the generated client module loads fine (no connection). ✓ (requires generate to have run — the pretest script).

**Another potential issue: the `PrismaClient` constructor runs on module import?** No, only on instantiation.

**Now — `vitest` and `process.hrtime.bigint()`** ✓ Node.

**Check the timing test total runtime**: sign-up: warm-up 2 + 20 = 22 hashes ≈ 22 × ~80ms ≈ 1.8s; sign-in: 22 verifies ≈ 1.8s; other tests: ~15 argon2 ops ≈ 1.2s. Total ~5s + overhead. Vitest's testTimeout 60s in the config covers each test ✓.

**Potential flake: `Math.min(...times) >= 20`** — with hashing, each single op ≥ ~25ms. ✓

**Let me also reconsider SAMPLES=10** → 20 requests per timing test, each ≥25ms → ≥0.5s just in hash + overhead. Fine.

**Also re-check the sign-up "existing" timing test branch**: the password varies per iteration (`existing-sample-${i}-pass`) — the hash is always computed on that password — same cost (argon2 cost doesn't depend on the password). ✓ Varying the password prevents any accidental memoization/cache (there's none anyway).

**Also confirm that the controller's `@HttpCode(202)`** applies to both branches — yes, decorator on the route ✓.

**Sign-in success status**: default 200 ✓ (POST with a body returning an object → 201 by default in Nest for @Post! Nest's default for POST is 201 Created!). Note: for `@Post` without `@HttpCode`, Nest returns 201 on success. For sign-in I want 200 → add `@HttpCode(200)`. For sign-up I set 202 explicitly ✓. Good catch.

**And the 401 for sign-in** is thrown → the filter sets 401 ✓ regardless of the route default.

**Validation 400** ✓.

Now let me write **SECURITY.md** (final, 24 lines as counted).

**Also — "no Math.random on the response path"** — my code: none ✓ (no random padding; uuid is DB-side, default value — not on the response path... `uuid()` default is computed by Postgres at insert time — not in the response. ✓).

Now let me write the **full test file** (assembling everything, ~230 lines). Also include a describe for the envelope? Covered inline.

Let me reconsider the byte-comparison test's header equality once more: Express sets `content-type: application/json; charset=utf-8`, `content-length`, `date`, `connection: keep-alive`? When using supertest against the server, the request uses keep-alive... The response's `connection` header: Node adds `Connection: keep-alive` if the agent keeps alive... supertest's default agent? supertest uses its own agent per request; the response might not have a `connection` header, or `close`. Both requests are treated identically → equal ✓.

**Potential difference: `etag`?** Express's `res.json` sets `ETag` by default (weak etag, generated from body content — `W/"3x-<hash>"`), the hash depends on body length+content — same body → same ETag ✓ deterministic. If bodies differ in length, the ETag would differ — that's a length leak the spec cares about; same body → same. ✓ Good — actually ETag is a nice automatic equalizer check.

**Let me write the final code.**

One more check — **`import request from 'supertest'`** with `@types/supertest` ✓. supertest v7 is ESM-friendly CJS ✓.

**`Test.createTestingModule({ imports: [AppModule] })`** — AppModule has an APP_FILTER provider ✓ the filter applies in tests ✓.

**`moduleRef.createNestApplication({ logger: false })`** — options type `NestApplicationOptions` includes `logger: false` ✓.

**Now — `tsconfig.json` rootDir src, include src** — `tsc -p tsconfig.json` emits `dist/main.js` etc. ✓ `start: node dist/main.js` ✓.

**vitest.config.ts** at the root — not included in the tsconfig build (include src only) — but tsc only compiles `include`; the vitest config is handled by vitest itself ✓.

**package.json** — also `"prisma": { ... }`? No. Keep it clean.

Now, the **migration timestamp**: `20250101000000_init`. Fine.

Also **`prisma/schema.prisma`** — model `User`. The repository's `AuthRepository` uses `this.prisma.user`. ✓

Let me also think about **whether the service should verify against the real stored hash in the sign-up existing branch** instead of a fresh hash — is there any leakage? The fresh hash is discarded; the response is identical; the timing is identical (one hash op). The L2 spec's dummy-hash language targets the "no hash to check" branch — in my sign-up design, no branch skips the hash. I'm confident this satisfies "both branches do the same work." And it's actually more robust (the existing branch doesn't depend on the stored hash's params — a legacy hash with different params would create a timing asymmetry!). This is a strong argument for hashing fresh in sign-up: the stored hash's params could differ (e.g. a future cost bump), and verify would take a different time. Fresh hash with fixed params → constant.

For sign-in, the unknown branch uses the dummy with the same params as today's hashes. If a user was created with older params, their wrong-password sign-in takes the old cost — a subtle leak limited to the attacker's own accounts... The attacker can't know their own timing baseline beyond noise; out of scope. The dummy matches current params ✓.

**Now, the final file contents. Let me write them all out.**

---

### package.json

```json
{
  "name": "identity-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "prisma generate && vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^5.22.0",
    "argon2": "^0.43.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.15",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.10",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
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
    "rootDir": "src",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

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
  id           String   @id @default(uuid()) @map("id")
  email        String   @unique @map("email")
  passwordHash String   @map("password_hash")
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

### src/main.ts

```ts
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
```

### src/common/error-envelope.filter.ts

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Single error envelope for the whole API:
 * { "error": { "code": ..., "message": ..., "details": ... } }.
 * `code` is the stable contract; `message` is developer-facing English.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { status, code: this.codeForStatus(status), message: body, details: {} };
      }
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const inner = record.error;
        if (this.isPlainObject(inner)) {
          return {
            status,
            code: typeof inner.code === 'string' ? inner.code : this.codeForStatus(status),
            message: typeof inner.message === 'string' ? inner.message : this.codeForStatus(status),
            details: this.isPlainObject(inner.details) ? inner.details : {},
          };
        }
        return {
          status,
          code: this.codeForStatus(status),
          message: typeof record.message === 'string' ? record.message : 'Request failed.',
          details: {},
        };
      }
      return { status, code: this.codeForStatus(status), message: 'Request failed.', details: {} };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Unexpected server error.',
      details: {},
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'resource_not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'validation_failed';
      default:
        return 'error';
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
```
Wait: `inner.code` — inner is `Record<string, unknown>` (after the type guard) → `inner.code` is unknown → `typeof inner.code === 'string'` narrows ✓.

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

### src/mail/mail.port.ts

```ts
/**
 * Outbound mail contract. The concrete transport is supplied by the host
 * application; the auth feature depends only on this port.
 */
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
```

### src/mail/mail.module.ts

```ts
import { Module } from '@nestjs/common';
import { MAIL_PORT, type MailPort } from './mail.port.js';

// ASSUMPTION: a real sendEmail implementation is assumed to exist in the host
// application; this stand-in keeps the container resolvable until one is bound.
const consoleMailPort: MailPort = {
  async sendEmail(to, template, vars) {
    console.info(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  },
};

@Module({
  providers: [{ provide: MAIL_PORT, useValue: consoleMailPort }],
  exports: [MAIL_PORT],
})
export class MailModule {}
```

### src/auth/auth.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Creates the account unless a concurrent request already did. The unique
   * constraint is the source of truth, so the loser of a race reports
   * created=false instead of surfacing a 500 (which would both fail and leak
   * that the address existed).
   */
  async createIfAbsent(email: string, passwordHash: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
```

### src/auth/auth.service.ts

```ts
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, type MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

/**
 * argon2id at a real cost factor (32 MiB, 2 passes, parallelism 1; OWASP's
 * current floor is 19 MiB / 2 passes). The cost is deliberate: it is the
 * work both branches must perform so that no branch can be cheaper.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
};

// Public by design. Its only purpose is to burn one full hash's worth of time
// on the sign-in branch that has no stored hash to verify.
const DUMMY_PLAINTEXT = 'timing-equalisation-dummy';

export type SignUpOutcome = { result: 'accepted' };
export type SignInOutcome = { result: 'signed-in' } | { result: 'rejected' };

@Injectable()
export class AuthService {
  // Precomputed once per process with the same parameters as real hashes, so
  // verifying against it takes the same time as verifying a real one.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    this.dummyHash = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    // Both branches pay one argon2 hash before the branch even exists: a new
    // address stores it, an existing address discards it. No branch can skip
    // the work, so no branch is faster.
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const existing = await this.repository.findByEmail(email);
    if (existing) {
      this.deliver(email, 'signup-attempted');
      return { result: 'accepted' };
    }

    const created = await this.repository.createIfAbsent(email, passwordHash);
    // The race loser (concurrent sign-up between the lookup and the insert)
    // must observe and report the same outcome as the lookup miss.
    this.deliver(email, created ? 'verify-account' : 'signup-attempted');
    return { result: 'accepted' };
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const user = await this.repository.findByEmail(email);
    // Unknown address: verify against the dummy hash — identical parameters,
    // identical cost, and the same (false) result as a wrong password.
    const storedHash = user ? user.passwordHash : await this.dummyHash;
    const verified = await argon2.verify(password, storedHash).catch(() => false);
    return user && verified ? { result: 'signed-in' } : { result: 'rejected' };
  }

  private deliver(to: string, template: string): void {
    // Out of band: the send is never awaited by the response path, so a slow
    // or failing mail transport changes nothing the caller observes.
    void this.mail.sendEmail(to, template, { email: to }).catch(() => undefined);
  }
}
```

### src/auth/auth.controller.ts

```ts
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

// The one and only sign-up acknowledgement. Both branches return it verbatim,
// so status, body bytes, and derived headers (content-length, etag) are
// identical by construction.
const SIGN_UP_ACKNOWLEDGEMENT = {
  message: 'If this address is new, a verification email is on its way.',
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<typeof SIGN_UP_ACKNOWLEDGEMENT> {
    const { email, password } = this.readCredentials(body);
    await this.authService.signUp(email, password);
    return SIGN_UP_ACKNOWLEDGEMENT;
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = this.readCredentials(body);
    const outcome = await this.authService.signIn(email, password);
    if (outcome.result === 'rejected') {
      // Deliberately the same error for an unknown address and a wrong
      // password; the service already spent equal time in both cases.
      throw new HttpException(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Email or password is incorrect.',
            details: {},
          },
        },
        401,
      );
    }
    return { message: 'Signed in.' };
  }

  private readCredentials(body: unknown): { email: string; password: string } {
    const raw = (
      typeof body === 'object' && body !== null ? body : {}
    ) as { email?: unknown; password?: unknown };

    // Normalisation (trim + lowercase) is input validation, not business
    // logic: the database treats case variants as the same address.
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';

    const invalidFields: string[] = [];
    if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
      invalidFields.push('email');
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      invalidFields.push('password');
    }
    if (invalidFields.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_failed',
            message: `Invalid or missing fields: ${invalidFields.join(', ')}.`,
            details: { fields: invalidFields },
          },
        },
        400,
      );
    }
    return { email, password };
  }
}
```

### src/auth/auth.module.ts

```ts
import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}
```

### test/auth.spec.ts

Let me write the complete file:

```ts
import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.port.js';

// ---------------------------------------------------------------------------
// In-memory stand-ins for the two ports the app depends on. The HTTP stack,
// the controller, the service, the repository logic, and the argon2 work are
// all real; only the database and the mail transport are faked, so no test
// needs an external Postgres or SMTP server.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

function createFakePrisma(): { service: unknown; rows: Map<string, FakeRow> } {
  const rows = new Map<string, FakeRow>();
  let nextId = 0;

  const service = {
    user: {
      async findUnique(args: { where: { email: string } }): Promise<FakeRow | null> {
        return rows.get(args.where.email) ?? null;
      },
      async create(args: { data: { email: string; passwordHash: string } }): Promise<FakeRow> {
        const { email, passwordHash } = args.data;
        if (rows.has(email)) {
          throw Object.assign(new Error('Unique constraint failed on users_email_key'), {
            code: 'P2002',
          });
        }
        const row: FakeRow = {
          id: `row-${++nextId}`,
          email,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(email, row);
        return row;
      },
    },
  };

  return { service, rows };
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

function createMailPort(fail: boolean): { port: MailPort; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const port: MailPort = {
    async sendEmail(to, template, vars) {
      if (fail) {
        throw new Error('mail transport unavailable');
      }
      sent.push({ to, template, vars });
    },
  };
  return { port, sent };
}

async function buildApp(
  prisma: unknown,
  mailPort: MailPort,
): Promise<{ app: INestApplication; server: Server }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma as PrismaService)
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, server: app.getHttpServer() };
}

async function signUp(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-up').send({ email, password });
}

async function signIn(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-in').send({ email, password });
}

/**
 * Every header except `date` must match between two responses; `date` is a
 * wall-clock timestamp and may legitimately differ between requests.
 */
function stripVolatileHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'date' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Mail is fire-and-forget by design, so assertions about it must poll until
 * the (unawaited) send lands.
 */
async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function timedPost(
  server: Server,
  path: string,
  email: string,
  password: string,
  expectedStatus: number,
): Promise<number> {
  const startedAt = process.hrtime.bigint();
  const response = await request(server).post(path).send({ email, password });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  // Guard: if a branch started failing, we must not silently time a different
  // (fast error) path and pass on the wrong data.
  expect(response.status).toBe(expectedStatus);
  return elapsedMs;
}

const SAMPLES = 10;
// One argon2id pass at the configured cost (32 MiB, 2 passes) takes far
// longer than this on any machine; a request that skips the hashing sits well
// below it. This is what makes "both branches are fast" fail the test.
const MIN_REAL_WORK_MS = 20;
// How far the two branch means may drift apart and still be treated as
// indistinguishable.
const MEAN_TOLERANCE_MS = 25;

// ---------------------------------------------------------------------------

describe('POST /auth/sign-up', () => {
  it('returns byte-identical responses for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const seed = await signUp(server, 'seeded@example.test', 'seeded-password-1');
      expect(seed.status).toBe(202);

      const existing = await signUp(server, 'seeded@example.test', 'rival-password-9');
      const fresh = await signUp(server, 'brand-new@example.test', 'brand-new-pass-1');

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      // Body, byte for byte.
      expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text));
      // Headers, including content-length and etag, which would both change
      // if the bodies differed in length or content.
      expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
    } finally {
      await app.close();
    }
  });

  it('creates the account once and a second sign-up never overwrites it', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const first = await signUp(server, 'owner@example.test', 'original-password-1');
      expect(first.status).toBe(202);
      const again = await signUp(server, 'owner@example.test', 'rival-password-99');
      expect(again.status).toBe(202);

      // The original password still works...
      expect((await signIn(server, 'owner@example.test', 'original-password-1')).status).toBe(200);
      // ...and the rival password from the second sign-up does not, i.e. the
      // stored hash was not replaced.
      expect((await signIn(server, 'owner@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('treats case variants of the same address as the same address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'Mixed.Case@Example.test', 'original-password-1')).status).toBe(202);
      expect((await signUp(server, 'mixed.case@example.test', 'rival-password-99')).status).toBe(202);

      expect((await signIn(server, 'MIXED.CASE@example.test', 'original-password-1')).status).toBe(200);
      expect((await signIn(server, 'MIXED.CASE@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('sends exactly one verification email for a new address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'newbie@example.test', 'newbie-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the verification email');
      expect(sent).toEqual([
        { to: 'newbie@example.test', template: 'verify-account', vars: { email: 'newbie@example.test' } },
      ]);
    } finally {
      await app.close();
    }
  });

  it('sends a "someone tried to sign up" email for an existing address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'seeded@example.test', 'seeded-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the first email');

      expect((await signUp(server, 'seeded@example.test', 'rival-password-9')).status).toBe(202);
      await waitUntil(
        () => sent.filter((mail) => mail.template === 'signup-attempted').length === 1,
        'the attempted email',
      );

      expect(sent.find((mail) => mail.template === 'signup-attempted')).toEqual({
        to: 'seeded@example.test',
        template: 'signup-attempted',
        vars: { email: 'seeded@example.test' },
      });
      expect(sent.some((mail) => mail.template === 'verify-account')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('changes nothing the caller observes when mail delivery fails', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(true);
    const { app, server } = await buildApp(service, port);
    try {
      const fresh = await signUp(server, 'no-mail@example.test', 'no-mail-password-1');
      const existing = await signUp(server, 'no-mail@example.test', 'no-mail-password-2');

      expect(fresh.status).toBe(202);
      expect(existing.status).toBe(202);
      expect(Buffer.from(fresh.text)).toEqual(Buffer.from(existing.text));
      expect(stripVolatileHeaders(fresh.headers)).toEqual(stripVolatileHeaders(existing.headers));
    } finally {
      await app.close();
    }
  });

  it('rejects malformed input with the error envelope before any work is done', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const response = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'not-an-email', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: 'validation_failed', details: { fields: ['email', 'password'] } },
      });
      expect(typeof response.body.error.message).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const existingEmail = 'timing-existing@example.test';
      // Warm-up: sockets, argon2 native init, JIT — outside the measurement.
      await signUp(server, existingEmail, 'warm-up-password-1');
      await signUp(server, 'warm-up-new@example.test', 'warm-up-password-1');

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        existingTimes.push(
          await timedPost(server, '/auth/sign-up', existingEmail, `existing-sample-${i}-pass`, 202),
        );
        freshTimes.push(
          await timedPost(server, '/auth/sign-up', `timing-fresh-${i}@example.test`, `fresh-sample-${i}-pass`, 202),
        );
      }

      const existingMean = average(existingTimes);
      const freshMean = average(freshTimes);
      const toleranceMs = Math.max(MEAN_TOLERANCE_MS, 0.3 * Math.min(existingMean, freshMean));

      // (1) The two distributions must not be separable. Fails if the
      // existing-address branch skips the hashing.
      expect(Math.abs(existingMean - freshMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...existingTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...freshTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe('POST /auth/sign-in', () => {
  it('returns byte-identical responses for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);

      const wrongPassword = await signIn(server, 'known@example.test', 'wrong-password-123');
      const unknownAddress = await signIn(server, 'ghost@example.test', 'ghost-password-123');

      expect(wrongPassword.status).toBe(401);
      expect(unknownAddress.status).toBe(401);
      expect(Buffer.from(wrongPassword.text)).toEqual(Buffer.from(unknownAddress.text));
      expect(stripVolatileHeaders(wrongPassword.headers)).toEqual(stripVolatileHeaders(unknownAddress.headers));
      expect(wrongPassword.body).toEqual({
        error: {
          code: 'invalid_credentials',
          message: 'Email or password is incorrect.',
          details: {},
        },
      });
    } finally {
      await app.close();
    }
  });

  it('accepts the correct credentials', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);
      const response = await signIn(server, 'known@example.test', 'known-password-123');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Signed in.' });
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const knownEmail = 'timing-known@example.test';
      expect((await signUp(server, knownEmail, 'timing-known-pass-1')).status).toBe(202);
      // Warm-up: sockets, dummy-hash generation, native init.
      await signIn(server, knownEmail, 'warm-up-wrong-1');
      await signIn(server, 'warm-up-ghost@example.test', 'warm-up-pass-1');

      const wrongPasswordTimes: number[] = [];
      const unknownAddressTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        wrongPasswordTimes.push(
          await timedPost(server, '/auth/sign-in', knownEmail, `wrong-sample-${i}-pass`, 401),
        );
        unknownAddressTimes.push(
          await timedPost(server, '/auth/sign-in', `timing-ghost-${i}@example.test`, `ghost-sample-${i}-pass`, 401),
        );
      }

      const wrongPasswordMean = average(wrongPasswordTimes);
      const unknownAddressMean = average(unknownAddressTimes);
      const toleranceMs = Math.max(MEAN_TOLERANCE_MS, 0.3 * Math.min(wrongPasswordMean, unknownAddressMean));

      // (1) The two distributions must not be separable. Fails if the
      // unknown-address branch skips the dummy verification.
      expect(Math.abs(wrongPasswordMean - unknownAddressMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...wrongPasswordTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...unknownAddressTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});
```

Wait — one issue with the sign-in timing test: the first `signIn(server, knownEmail, 'warm-up-wrong-1')` — that's a wrong-password sign-in (401) that's fine. The dummy hash: generated at AuthService construction (at buildApp time); by the time warm-up runs, it's probably ready; even if not, the unknown-address warm-up awaits it. Fine.

One more check: **the timing test's `timedPost` uses `request(server)`** — each call creates a new agent; connections are fresh per request → consistent overhead per sample, and interleaved alternation cancels drift. ✓

**Potential issue — `expect(response.status).toBe(expectedStatus)` inside `timedPost`**: if it fails, the sample isn't recorded; the test fails on the assertion ✓ (we're not silently measuring error paths).

**Now, the byte test's `existing.headers['content-length']`** — supertest's response.headers is a plain object ✓.

**One concern: `stripVolatileHeaders` comparing headers that include `etag`** — Express etag for the same body: `W/"...-hash"`, the hash is from the body → equal ✓.

**Another concern: `res.body` equality for the 401** — the envelope is exactly as constructed ✓.

**Vitest `it(..., 60_000)`** — the third-argument timeout ✓ (testTimeout is also 60s in the config).

**Now — will `Test.createTestingModule({ imports: [AppModule] })` complain about an unknown token?** All providers are resolvable: APP_FILTER (provided), AuthController→AuthService→(AuthRepository, MAIL_PORT✓), AuthRepository→PrismaService✓ (overridden), MailModule provides MAIL_PORT✓ (overridden), PrismaModule provides PrismaService✓ (overridden). ✓

**`app.getHttpServer()`** returns `http.Server` ✓ (express adapter).

**Type of `response.headers`** in supertest: `IncomingHttpHeaders`. My `stripVolatileHeaders(headers: Record<string, unknown>)` — passing `IncomingHttpHeaders`: an index-signature compat — `IncomingHttpHeaders` is `Record<string, string | string[] | undefined> & { ... }` — assignable to `Record<string, unknown>`? An object with an index signature `string | string[] | undefined` → `unknown` ✓.

**`expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text))`** ✓.

Now — **the argon2 cost and the test's MIN_REAL_WORK_MS=20**: let me sanity-check argon2id 32MiB/t=2/p=1 on a fast machine. Known data points: argon2id m=19MiB,t=2 ≈ 30-50ms on a 2020 laptop; m=32MiB ≈ scales ~1.7x → ~50-85ms. On a very fast server CPU maybe 40-60ms. Min ≥ 20 ✓ with margin.

**What about a machine where argon2 is slow (ARM CI)**? 100-300ms/op → timing test: 22+22 ops ≈ 4.4-13s each... under the 60s timeout ✓.

**Total number of argon2 ops across the whole file**: byte test: 1+2=3 (seed, existing, fresh) → 3 hashes... plus sign-in: 2 verifies. Creates/no-overwrite: 2+2=4. Case: 4. Mail tests: 1, 2. Mail failure: 2. Validation: 0. Sign-up timing: 22. Sign-in: seed 1 + warm-up 2 + 20 = 23. Accept: 2. Total ≈ 3+2+4+4+1+2+2+0+22+23+2 = 65 ops × ~70ms ≈ 4.5s + HTTP overhead ~1-2s. Fine.

**Hmm — one more subtle timing issue in the sign-up byte test and "creates once" test: none.

**`createFakePrisma`'s `service: unknown`** — I typed the return as `{ service: unknown; rows: Map<...> }` and cast in buildApp. The service object's methods are async → fine.

**Now — does anything in the tests use `rows`?** Not directly (behavioral assertions via HTTP). The `rows` field is unused in the tests... I return it but never use it. Drop it? It's harmless but dead. Keep the API minimal: return only `{ service }`. Let me drop `rows` from the return. Actually, maybe I could use `rows` to assert that no duplicate row was created... behavioral tests already cover that via sign-in. Drop `rows`.

**`import type { Server } from 'node:http'`** ✓.

**Unused imports check**: `afterAll/beforeEach` — not used; import only `describe, expect, it`. ✓

**`Test` from '@nestjs/testing'** ✓.

Now **SECURITY.md** final (24 lines). Let me recount with the exact content:

```
1  # Enumeration protection for /auth/sign-up and /auth/sign-in
2  
3  ## Mechanism
4  Every sign-up performs exactly one argon2id hash (32 MiB, 2 passes,
5  parallelism 1) before any database access: a new address stores it, an
6  existing address discards it. Every sign-in performs exactly one argon2id
7  verify: against the stored hash for a known address, or against a
8  precomputed dummy hash with identical parameters for an unknown one. Both
9  branches of both endpoints return the same status, body, and headers; the
10 only per-branch side effect (verification vs "attempted" email) is fired
11 without being awaited, so it changes neither the response nor its timing.
12 
13 ## Why this, and not the alternatives
14 - Early-return on a found address is the naive fix and is the leak itself.
15 - Random delay padding adds variance, not equivalence: the branch means
16   still differ, and enough samples recover the signal.
17 - A constant sleep floor sits on top of the unremoved work difference and
18   taxes every request; equalising the work removes it at the source.
19 
20 ## What this does not protect against
21 - Enumeration through other surfaces (password reset, account deletion,
22   other endpoints that answer differently for known vs unknown addresses).
23 - A database-side observer: the new-account branch writes a row.
24 - Password brute force; this is not rate limiting.
25 - The dummy hash is public by design: it equalises timing, it is no secret.
```
25 lines ✓ (within 15-25).

Now, let me double-check the **`error` envelope for the sign-up validation test's `response.body`**: the body is `{ error: { code: 'validation_failed', message: 'Invalid or missing fields: email, password.', details: { fields: ['email','password'] } } }`. `toMatchObject({ error: { code: 'validation_failed', details: { fields: ['email', 'password'] } } })` ✓.

**Confirming the controller's validation order**: email 'not-an-email' fails the pattern ✓; password 'short' (5 < 8) ✓ → both fields ✓.

**`MAX_EMAIL_LENGTH` 254** ✓.

Now, potential **Nest ESM + decorator metadata** issue with the constructor of `AuthController(private readonly authService: AuthService)` — esbuild emits design:paramtypes with the AuthService class reference (value import) ✓. `AuthService` constructor: `AuthRepository` (value import ✓), `@Inject(MAIL_PORT)` explicit ✓ (metadata not needed). `AuthRepository(PrismaService)` value ✓. `PrismaService` extends PrismaClient — no constructor. ✓

**One risk**: esbuild and `emitDecoratorMetadata` — I'm now fairly sure Vitest handles Nest projects fine (it's a common setup). Proceeding.

**`import argon2 from 'argon2'` under `module: NodeNext`**: argon2's package.json — does it have an `"exports"` field? argon2@0.43's package.json: `{ "main": "argon2.js", ... }` — I don't think it has exports. NodeNext: resolves main, CJS → default import OK. TS types: `types: "argon2.d.ts"`. With `export =`? If argon2.d.ts is `export =`... Let me recall the actual argon2.d.ts:

```ts
// Type definitions for argon2
import { BinaryLike } from 'crypto';
...
export interface Options { ... }
export interface Argon2 { ... }
declare const argon2: Argon2;
export default argon2;
```
Hmm, I think argon2's types use named exports + a default export (it's a somewhat modern d.ts). `import argon2 from 'argon2'` → the default ✓. And `argon2.argon2id` — a property on the Argon2 interface: `argon2id: 3`? The Argon2 interface is:
```ts
export interface Argon2 {
  (buffer: BinaryLike, hash: string): Promise<boolean>;
  hash(data: BinaryLike, options?: Options): Promise<string>;
  verify(hash: string, data: BinaryLike, options?: VerifyOptions): Promise<boolean>;
  raw: ...;
  argon2d: 1;
  argon2i: 2;
  argon2id: 3;
  ...
}
```
I'm fairly sure the constants exist as members with literal types. OK.

If the d.ts is `export =` style, `import argon2 from 'argon2'` also works (interop), and `argon2.argon2id` ✓. Either way, fine.

**`argon2.verify(password, storedHash)`** — the signature `verify(hash, data)`? Wait! argon2 API: `argon2.verify(encodedHash, plaintextOrBuffer)` — the hash first, the data second! Let me get this right: `argon2.hash(data, options)` → hash. `argon2.verify(hash, data)` → boolean. Yes: verify(hash, data). So my call must be `argon2.verify(storedHash, password)`. Let me fix in the service:

```ts
const verified = await argon2.verify(storedHash, password).catch(() => false);
```
✓ Good catch.

**`argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS)`** — data first ✓.

**Now — the `Options` type of ARGON2_OPTIONS**: inferred object; `hash(data, options?: Options)` — structurally: `type: 3` (literal, since `argon2.argon2id` is a const member typed 3) ✓, memoryCost: number ✓, timeCost ✓, parallelism ✓. Even if `argon2id` is typed `number`, then `type: number` vs `Options['type']`... if Options.type is `1|2|3`, then `number` isn't assignable → compile error. Risk. Mitigation: annotate explicitly:

```ts
const ARGON2_OPTIONS = {
  type: argon2.argon2id as const,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
} as const;
```
`as const` on the whole object: `type: 3` (if the argon2id literal is 3) or `type: number`?? `as const` doesn't change the type of `argon2.argon2id` — it stays whatever the declared type is. If declared as `number`, still number.

Alternative: avoid the `type` field ambiguity by using a string? argon2's Options.type accepts only numbers (1,2,3). Hmm.

The safest: check the actual argon2 types. argon2 v0.43 `argon2.d.ts`:

```ts
export declare const argon2d: 1;
export declare const argon2i: 2;
export declare const argon2id: 3;
export interface Options {
    parallelism?: number | undefined;
    memoryCost?: number | undefined;
    timeCost?: number | undefined;
    type?: 1 | 2 | 3 | undefined;
    outputLen?: number | undefined;
    ad?: Buffer | undefined;
    secretKey?: Buffer | undefined;
}
...
declare const argon2: { ... argon2d: 1; argon2i: 2; argon2id: 3; ... }
```
I'm now fairly confident the constants are literal-typed (`1`, `2`, `3`) — the argon2 author types them as literals. So `type: argon2.argon2id` → type `3` ✓ assignable. I'll go with the plain object, no `as const`:

```ts
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
};
```
If `argon2id: 3` literal → OK. This is the standard usage from argon2's README: `const hash = await argon2.hash('abc', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });` — exactly this pattern from the README ✓.

**Now, one more design double-check against the L2 acceptance items**:
- "Sign-up: existing and new addresses produce byte-identical responses" ✓ test.
- "Sign-in: wrong password and unknown address produce byte-identical responses" ✓ test.
- "Both branches take statistically indistinguishable time over repeated samples" ✓ timing tests.
- "The timing test fails when the equalization is removed, and when the hashing is removed" ✓ (diff assertion and floor).
- "Mail is delivered out of band and mail failure is invisible to the caller" ✓ fire-and-forget + test.
- "No Math.random on the response path" ✓ none.
- "If you also want a floor, make it a constant and layer it on top of equalized work" — I use no artificial floor at all; only equalized work. ✓ (mention in SECURITY.md? I mention rejecting the constant sleep floor. Good.)

Variant A requirements:
1. ✓ 202 identical.
2. ✓ 401 identical.
3. ✓ argon2id 32MiB/t2.
4. ✓ equal work.
5. ✓ out-of-band mail, both templates.

Deliverables:
- Prisma schema + migration ✓
- NestJS module: controller, service, repository ✓ (+ glue: main, app.module, prisma module/service, mail port/module, filter)
- Tests ✓ (timing + byte comparison)
- SECURITY.md ✓ (25 lines — within 15-25).

**"Do not create files it doesn't ask for"** — the glue files are justified by the layout convention (main.ts, app.module.ts are literally in the convention layout). The mail port/module is justified by the assumption + DI. The filter is justified by the error envelope convention. package.json/tsconfig/vitest.config are needed for the solution to be runnable. I think this is the right scope.

**Re-check the wiring convention**: "a service, repository, or processor is listed in the module's providers" ✓ AuthModule lists AuthService, AuthRepository. "A provider used by another module is exportsed by its own module and that module is importsed by the other" ✓ PrismaService exported by PrismaModule, imported by AuthModule; MAIL_PORT exported by MailModule, imported by AuthModule. "A controller is declared by a module" ✓.

**Naming**: endpoints kebab ✓ (`/auth/sign-up`, `/auth/sign-in` — task-mandated). TS files `kebab-case.role.ts` ✓. Class PascalCase ✓. Tables/columns snake via @map ✓.

**Environment**: DATABASE_URL in the schema ✓; PORT in main ✓; no secrets ✓.

Now, one more thought about the **`test` script running `prisma generate`**: with pnpm, `pnpm test` runs `prisma generate && vitest run`. The prisma binary is in devDependencies ✓. OK.

**`"postinstall": "prisma generate"`** — add? It helps on fresh clone. Let me add it.

Now, **the `@prisma/client` version and prisma 5.x** ✓ consistent.

**`@types/express`** — needed for the `Response` type import in the filter ✓. Express types come via @nestjs/platform-express anyway; explicit devDep is fine.

**Check the filter's import**: `import type { Response } from 'express';` — only used as a type ✓ (type-only import, erased).

**Now, let me reconsider `createNestApplication({ logger: false })`** — the signature `createNestApplication(httpAdapterOrOptions?, options?)` — passing an object as the first argument is treated as options ✓.

**`app.close()`** — closes the server and module ✓.

**Potential issue: multiple `Test.createTestingModule` with the same AppModule in the same process** — fine, Nest supports multiple instances.

**`process.hrtime.bigint()`** ✓.

**The timing test's tolerance formula**: `Math.max(25, 0.3 * min(mean))` — if the mean is ~80ms → max(25, 24) = 25ms. If the machine is slow, mean ~250 → max(25, 75) = 75ms. Reasonable.

**Could the real diff exceed 25ms on a noisy CI?** The branch diff is ~0 (both one argon2 op; the fake DB is equal). The noise between the two means (each mean of 10 samples): the std of the mean ≈ σ/√10; σ of a single sample is maybe 5-15ms (GC) → σ of the mean ≈ 2-5ms → the diff of two means ≈ 3-7ms typical. 25ms is ~4-8 σ. Safe. ✓

**One more: the warm-up for the sign-in timing test includes a dummy-hash readiness await** — the unknown warm-up `await signIn(ghost)` — if the dummy isn't ready, that warm-up is slow (absorbs the cost) ✓.

**And the first sample of the sign-up timing test (existing)**: the existing user was created in warm-up ✓.

**Edge: `expect(Math.min(...existingTimes))`** — spreading 10 numbers ✓.

Now, let me also consider **whether the `signUp` response should be 200 instead of 202**: 202 "Accepted" conveys async processing (email is on its way) — defensible, and since it's the same on both branches, no leak. Keep 202.

**Also confirm the sign-in success body is 200 with `{ message: 'Signed in.' }`** — via `@HttpCode(200)` ✓.

**Potential Nest pitfall**: `@HttpCode(200)` on `@Post` ✓ supported.

Now, **the filter's file location**: `src/common/error-envelope.filter.ts` ✓.

**Also double-check `ErrorEnvelopeFilter`'s use of `host.switchToHttp().getResponse<Response>()`** — in tests (supertest), the response is an Express res ✓.

**Unhandled: JSON parse errors** — Express's body parser (Nest's default) throws a 400 with an array message `['Expected property name or "}" in JSON at position 1...']`? Nest's default json parser with `body: {}`... For an invalid JSON body, Nest throws `HttpException` 400 with a string? The body-parser throws a SyntaxError with `status: 400` — Nest's default pipeline converts it to a 400 Bad Request via an exceptions filter... Actually in Nest 10, an invalid JSON body → Nest throws a 400 `BadRequestException`-like with a message. My filter: `exception instanceof HttpException` ✓ → body is a string or an object with a message → envelope 'bad_request' ✓. Good enough.

**Now — the `details` for validation is `{ fields: [...] }`** — an object ✓ never null ✓.

**Let me finalize and write out all the files.** Also, confirm there's no accidental use of `Math.random` anywhere ✓.

One more consideration for the **timing test and the mail recorder**: in the timing test, each sign-up fires a fire-and-forget `sendEmail` → an async function that pushes to an array — an un-awaited promise. Under `--unhandled-rejections`... it's handled internally by `.catch`. ✓ No warnings.

**And the dummy hash promise created in the constructor** — if argon2 rejects (shouldn't), unhandled. Acceptable.

**Let me write out the final test file** — one fix: in `createFakePrisma`, return `{ service }` only:

```ts
function createFakePrisma(): { service: unknown } {
  ...
  return { service };
}
```
And in tests: `const { service } = createFakePrisma();` ✓.

**Also `buildApp(prisma: unknown, ...)`** — cast to `prisma as PrismaService` — from unknown to a class type: is `as PrismaService` from `unknown` allowed? A cast from `unknown` is allowed ✓.

**Confirm the imports in the test**: `AppModule` (value), `PrismaService` (value, for the overrideProvider token), `MAIL_PORT` (value), `type MailPort`, `Test`, types. ✓

**`request(server)` where server: Server** ✓ supertest accepts an http.Server.

I think everything's solid. Let me also add a small header comment in the service about the equalization contract? The comments already cover it.

**Let me write out SECURITY.md** — final content (25 lines). Also confirm "15–25 lines" — 25 is within range. Let me trim to 24 for safety? The count is 25 including the trailing... Let me count the final version exactly:

Line 1: `# Enumeration protection for /auth/sign-up and /auth/sign-in`
Line 2: ``
Line 3: `## Mechanism`
Line 4: `Every sign-up performs exactly one argon2id hash (32 MiB, 2 passes,`
Line 5: `parallelism 1) before any database access: a new address stores it, an`
Line 6: `existing address discards it. Every sign-in performs exactly one argon2id`
Line 7: `verify: against the stored hash for a known address, or against a`
Line 8: `precomputed dummy hash with identical parameters for an unknown one. Both`
Line 9: `branches of both endpoints return the same status, body, and headers; the`
Line 10: `only per-branch side effect (verification vs "attempted" email) is fired`
Line 11: `without being awaited, so it changes neither the response nor its timing.`
Line 12: ``
Line 13: `## Why this, and not the alternatives`
Line 14: `- Early-return on a found address is the naive fix and is the leak itself.`
Line 15: `- Random delay padding adds variance, not equivalence: the branch means`
Line 16: `  still differ, and enough samples recover the signal.`
Line 17: `- A constant sleep floor sits on top of the unremoved work difference and`
Line 18: `  taxes every request; equalising the work removes it at the source.`
Line 19: ``
Line 20: `## What this does not protect against`
Line 21: `- Enumeration through other surfaces (password reset, account deletion,`
Line 22: `  other endpoints that answer differently for known vs unknown addresses).`
Line 23: `- A database-side observer: the new-account branch writes a row.`
Line 24: `- Password brute force; this is not rate limiting.`
Line 25: `- The dummy hash is public by design: it equalises timing, it is no secret.`

25 lines ✓.

**Final check on the "ASSUMPTION" marker**: one in mail.module.ts. Anything else unresolved? The task says the mail port "exists" — covered by my assumption comment. Anything else I'm guessing at? Prisma client generation is standard. `PORT` default — trivial. I think one ASSUMPTION comment suffices.

Also, per the format: "start with the first heading." No prose outside the pattern (prose is ignored but keep it to nothing). I'll output only the heading + fenced blocks.

Order of files: I'll put package.json, tsconfig, vitest.config, prisma schema + migration, src files, test, SECURITY.md.

Let me also double-check the **`prisma/migrations/20250101000000_init/migration.sql`** matches the schema's output:
- id TEXT PK default uuid? Prisma's `@default(uuid())` → in the migration, no DEFAULT in the SQL for uuid (client-side default in Prisma 5? Actually Prisma's `uuid()` is a DB-side default? In PostgreSQL, Prisma maps `uuid()` to a client-side default (generated in the client), and the migration shows no default. Let me recall: Prisma's `@default(uuid())` → the migration creates the column without a DEFAULT (the value is generated by the client). Yes — Prisma generates uuids client-side for `uuid()`; the migration has no default. `@default(cuid())` is also client-side. For DB-side you'd use `@default(dbgenerated("gen_random_uuid()"))`. So the migration: `"id" TEXT NOT NULL` with no default ✓ as I wrote.
- `created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP` ✓ (Prisma's `@default(now())` → DEFAULT CURRENT_TIMESTAMP).
- `updated_at TIMESTAMPTZ(6) NOT NULL` ✓ (Prisma maintains it in the client; no DB default).
- PK constraint `users_pkey` ✓.
- Unique index `users_email_key` ✓.

Good — matches the actual Prisma migration output for this schema.

**One more: `@map("id")` for the id column** — Prisma's default column name for `id` is `id` anyway; the @map is redundant but explicit and consistent with the convention ("snake_case via @map"). Keep it.

**Now, `vitest` version 2.x** ✓ with Node 20 ✓.

**`supertest` 7.x** and `@types/supertest` 6.x ✓.

**Also `import request from 'supertest'`** — supertest's ESM default: `import request from 'supertest'` works in vitest (CJS interop) ✓.

**Final review of the service's signUp race comment** — good.

**Controller: `Promise<typeof SIGN_UP_ACKNOWLEDGEMENT>`** — returns the const object; Nest serializes it ✓. `as const` makes message a literal type; the return type is fine.

Hmm — `SIGN_UP_ACKNOWLEDGEMENT` is `as const` → type `{ readonly message: "If this..." }`. The return annotation matches ✓.

**Also confirm that both branches return the same constant** — yes, a single return after the await ✓.

**Confirm the `signUp` handler is `async`** ✓.

**Now — the `@HttpCode(202)` import** ✓.

I'm confident in the solution. Let me write it all out.

One more: the **test's "rejects malformed input ... before any work is done"** — the title claims no work is done; the assertion is only about the 400. Maybe I should also assert no mail was sent? Add `expect(sent.length).toBe(0)` — but the send is fire-and-forget; if (mistakenly) triggered, it'd appear asynchronously. After the 400 response, a send (if triggered) would likely have landed (microtask) — but to be safe, keep the title modest: "rejects malformed input with the error envelope." Drop the "before any work is done" claim, or assert sent remains empty with a small wait. Let me just keep it simple: status + envelope. Title: 'rejects malformed input with the error envelope'.

Also — **should the validation test check that no account was created?** Behavioral: after the invalid sign-up, a valid sign-up with the same email should succeed (202) — trivially true. Skip; keep the test focused.

Final file list (18 files):
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/20250101000000_init/migration.sql
6. src/main.ts
7. src/app.module.ts
8. src/common/error-envelope.filter.ts
9. src/prisma/prisma.service.ts
10. src/prisma/prisma.module.ts
11. src/mail/mail.port.ts
12. src/mail/mail.module.ts
13. src/auth/auth.module.ts
14. src/auth/auth.controller.ts
15. src/auth/auth.service.ts
16. src/auth/auth.repository.ts
17. test/auth.spec.ts
18. SECURITY.md

Let me write the final answer now. Fenced blocks only after each heading, nothing else.

Wait — one more sanity check on the **`Test.createTestingModule` + `overrideProvider` with a Symbol token**: `.overrideProvider(MAIL_PORT).useValue(mailPort)` ✓ Symbol tokens work.

And **`AppModule`'s APP_FILTER** — `@Catch()` class + APP_FILTER ✓.

Also, in the test, the 404 envelope for unknown routes isn't tested — fine.

**Confirm the filter handles `HttpException` with an object body that has an `error` key that's an object with a string `code`** — the controller's throw: body = `{ error: { code, message, details } }` → the filter returns it as-is ✓.

**`response.body` for the 401 in the byte test** — parsed JSON ✓ equals the envelope ✓.

Also — **express's etag header is present in supertest?** `res.json` sets the etag ✓ both.

**`content-length` in `existing.headers`** — string ✓ toBe comparison ✓.

OK, one last thought about **`MIN_REAL_WORK_MS = 20` and the fake DB**: without hashing, the request ≈ HTTP overhead + 2 microtask DB calls ≈ typically 2-8ms; min of 10 samples < 20 ✓ fails as intended. With hashing ≥ ~40ms ✓ passes.

And **the timing test's "remove equalization" check**: sign-in unknown branch without the dummy: ~5ms vs wrong-pass ~80ms → mean diff ~75 > tolerance 25 ✓ fails. Sign-up existing branch without the pre-hash: the existing branch = lookup only ~3ms vs new ~85ms → diff ~82 > tol ✓ fails.

Great. Let me write it.

Actually, let me reconsider once more whether to include `"postinstall": "prisma generate"` in `package.json` — with pnpm it runs on install; if the schema is present, fine. Include it.

Also add `"prisma:migrate:dev": "prisma migrate dev"`? Not needed. Keep `prisma:migrate` (deploy) — hmm, `migrate dev` is for dev. Provide both? Minimal: `prisma:generate` and `prisma:migrate` (deploy). Fine.

The final answer follows.
```

## reply

### package.json
```json
{
  "name": "identity-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "prisma generate && vitest run",
    "postinstall": "prisma generate",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^5.22.0",
    "argon2": "^0.43.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.15",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.10",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
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
    "rootDir": "src",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

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
  id           String   @id @default(uuid()) @map("id")
  email        String   @unique @map("email")
  passwordHash String   @map("password_hash")
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

### src/main.ts
```ts
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
```

### src/common/error-envelope.filter.ts
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Single error envelope for the whole API:
 * { "error": { "code": ..., "message": ..., "details": ... } }.
 * `code` is the stable contract; `message` is developer-facing English.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { status, code: this.codeForStatus(status), message: body, details: {} };
      }
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const inner = record.error;
        if (this.isPlainObject(inner)) {
          return {
            status,
            code: typeof inner.code === 'string' ? inner.code : this.codeForStatus(status),
            message:
              typeof inner.message === 'string' ? inner.message : this.codeForStatus(status),
            details: this.isPlainObject(inner.details) ? inner.details : {},
          };
        }
        return {
          status,
          code: this.codeForStatus(status),
          message: typeof record.message === 'string' ? record.message : 'Request failed.',
          details: {},
        };
      }
      return { status, code: this.codeForStatus(status), message: 'Request failed.', details: {} };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Unexpected server error.',
      details: {},
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'resource_not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'validation_failed';
      default:
        return 'error';
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
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

### src/mail/mail.port.ts
```ts
/**
 * Outbound mail contract. The concrete transport is supplied by the host
 * application; the auth feature depends only on this port.
 */
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
```

### src/mail/mail.module.ts
```ts
import { Module } from '@nestjs/common';
import { MAIL_PORT, type MailPort } from './mail.port.js';

// ASSUMPTION: a real sendEmail implementation is assumed to exist in the host
// application; this stand-in keeps the container resolvable until one is bound.
const consoleMailPort: MailPort = {
  async sendEmail(to, template, vars) {
    console.info(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  },
};

@Module({
  providers: [{ provide: MAIL_PORT, useValue: consoleMailPort }],
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
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}
```

### src/auth/auth.controller.ts
```ts
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

// The one and only sign-up acknowledgement. Both branches return it verbatim,
// so status, body bytes, and derived headers (content-length, etag) are
// identical by construction.
const SIGN_UP_ACKNOWLEDGEMENT = {
  message: 'If this address is new, a verification email is on its way.',
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<typeof SIGN_UP_ACKNOWLEDGEMENT> {
    const { email, password } = this.readCredentials(body);
    await this.authService.signUp(email, password);
    return SIGN_UP_ACKNOWLEDGEMENT;
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = this.readCredentials(body);
    const outcome = await this.authService.signIn(email, password);
    if (outcome.result === 'rejected') {
      // Deliberately the same error for an unknown address and a wrong
      // password; the service already spent equal time in both cases.
      throw new HttpException(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Email or password is incorrect.',
            details: {},
          },
        },
        401,
      );
    }
    return { message: 'Signed in.' };
  }

  private readCredentials(body: unknown): { email: string; password: string } {
    const raw = (
      typeof body === 'object' && body !== null ? body : {}
    ) as { email?: unknown; password?: unknown };

    // Normalisation (trim + lowercase) is input validation, not business
    // logic: the store treats case variants as the same address.
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';

    const invalidFields: string[] = [];
    if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
      invalidFields.push('email');
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      invalidFields.push('password');
    }
    if (invalidFields.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_failed',
            message: `Invalid or missing fields: ${invalidFields.join(', ')}.`,
            details: { fields: invalidFields },
          },
        },
        400,
      );
    }
    return { email, password };
  }
}
```

### src/auth/auth.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, type MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

/**
 * argon2id at a real cost factor (32 MiB, 2 passes, parallelism 1; OWASP's
 * current floor is 19 MiB / 2 passes). The cost is deliberate: it is the
 * work both branches must perform, so no branch can be cheaper than the other.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
};

// Public by design. Its only purpose is to burn one full hash's worth of time
// on the sign-in branch that has no stored hash to verify.
const DUMMY_PLAINTEXT = 'timing-equalisation-dummy';

export type SignUpOutcome = { result: 'accepted' };
export type SignInOutcome = { result: 'signed-in' } | { result: 'rejected' };

@Injectable()
export class AuthService {
  // Precomputed once per process with the same parameters as real hashes, so
  // verifying against it takes the same time as verifying a real one.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    this.dummyHash = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    // Both branches pay one argon2 hash before the branch even exists: a new
    // address stores it, an existing address discards it. No branch can skip
    // the work, so no branch is faster.
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const existing = await this.repository.findByEmail(email);
    if (existing) {
      this.deliver(email, 'signup-attempted');
      return { result: 'accepted' };
    }

    const created = await this.repository.createIfAbsent(email, passwordHash);
    // The race loser (a concurrent sign-up between the lookup and the insert)
    // must observe and report the same outcome as a plain lookup miss.
    this.deliver(email, created ? 'verify-account' : 'signup-attempted');
    return { result: 'accepted' };
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const user = await this.repository.findByEmail(email);
    // Unknown address: verify against the dummy hash — identical parameters,
    // identical cost, and the same (false) result as a wrong password.
    const storedHash = user ? user.passwordHash : await this.dummyHash;
    const verified = await argon2.verify(storedHash, password).catch(() => false);
    return user && verified ? { result: 'signed-in' } : { result: 'rejected' };
  }

  private deliver(to: string, template: string): void {
    // Out of band: the send is never awaited by the response path, so a slow
    // or failing mail transport changes nothing the caller observes.
    void this.mail.sendEmail(to, template, { email: to }).catch(() => undefined);
  }
}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Creates the account unless a concurrent request already did. The unique
   * constraint is the source of truth, so the loser of a race reports
   * created=false instead of surfacing a 500 — which would both fail the
   * request and reveal that the address existed.
   */
  async createIfAbsent(email: string, passwordHash: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
```

### test/auth.spec.ts
```ts
import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.port.js';

// ---------------------------------------------------------------------------
// In-memory stand-ins for the two ports the app depends on. The HTTP stack,
// the controller, the service, the repository logic, and the argon2 work are
// all real; only the database and the mail transport are faked, so no test
// needs an external Postgres or mail server.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

function createFakePrisma(): { service: unknown } {
  const rows = new Map<string, FakeRow>();
  let nextId = 0;

  const service = {
    user: {
      async findUnique(args: { where: { email: string } }): Promise<FakeRow | null> {
        return rows.get(args.where.email) ?? null;
      },
      async create(args: { data: { email: string; passwordHash: string } }): Promise<FakeRow> {
        const { email, passwordHash } = args.data;
        if (rows.has(email)) {
          throw Object.assign(new Error('Unique constraint failed on users_email_key'), {
            code: 'P2002',
          });
        }
        const row: FakeRow = {
          id: `row-${++nextId}`,
          email,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(email, row);
        return row;
      },
    },
  };

  return { service };
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

function createMailPort(fail: boolean): { port: MailPort; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const port: MailPort = {
    async sendEmail(to, template, vars) {
      if (fail) {
        throw new Error('mail transport unavailable');
      }
      sent.push({ to, template, vars });
    },
  };
  return { port, sent };
}

async function buildApp(
  prisma: unknown,
  mailPort: MailPort,
): Promise<{ app: INestApplication; server: Server }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma as PrismaService)
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, server: app.getHttpServer() };
}

async function signUp(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-up').send({ email, password });
}

async function signIn(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-in').send({ email, password });
}

/**
 * Every header except `date` must match between two responses; `date` is a
 * wall-clock timestamp and may legitimately differ between requests.
 */
function stripVolatileHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'date' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Mail is fire-and-forget by design, so assertions about it must poll until
 * the (unawaited) send lands.
 */
async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function timedPost(
  server: Server,
  path: string,
  email: string,
  password: string,
  expectedStatus: number,
): Promise<number> {
  const startedAt = process.hrtime.bigint();
  const response = await request(server).post(path).send({ email, password });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  // Guard: if a branch started failing, the test must not silently time a
  // different (fast error) path and pass on the wrong data.
  expect(response.status).toBe(expectedStatus);
  return elapsedMs;
}

const SAMPLES = 10;
// One argon2id pass at the configured cost (32 MiB, 2 passes) takes far
// longer than this on any machine; a request that skips the hashing sits well
// below it. This is what makes "both branches are fast" fail the test.
const MIN_REAL_WORK_MS = 20;
// How far the two branch means may drift apart and still be treated as
// indistinguishable.
const MEAN_TOLERANCE_MS = 25;

describe('POST /auth/sign-up', () => {
  it('returns byte-identical responses for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const seed = await signUp(server, 'seeded@example.test', 'seeded-password-1');
      expect(seed.status).toBe(202);

      const existing = await signUp(server, 'seeded@example.test', 'rival-password-9');
      const fresh = await signUp(server, 'brand-new@example.test', 'brand-new-pass-1');

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      // Body, byte for byte.
      expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text));
      // Headers, including content-length and etag, which would both change
      // if the bodies differed in length or content.
      expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
    } finally {
      await app.close();
    }
  });

  it('creates the account once and a second sign-up never overwrites it', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const first = await signUp(server, 'owner@example.test', 'original-password-1');
      expect(first.status).toBe(202);
      const again = await signUp(server, 'owner@example.test', 'rival-password-99');
      expect(again.status).toBe(202);

      // The original password still works...
      expect((await signIn(server, 'owner@example.test', 'original-password-1')).status).toBe(200);
      // ...and the rival password from the second sign-up does not, i.e. the
      // stored hash was not replaced.
      expect((await signIn(server, 'owner@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('treats case variants of the same address as the same address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'Mixed.Case@Example.test', 'original-password-1')).status).toBe(202);
      expect((await signUp(server, 'mixed.case@example.test', 'rival-password-99')).status).toBe(202);

      expect((await signIn(server, 'MIXED.CASE@example.test', 'original-password-1')).status).toBe(200);
      expect((await signIn(server, 'MIXED.CASE@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('sends exactly one verification email for a new address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'newbie@example.test', 'newbie-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the verification email');
      expect(sent).toEqual([
        { to: 'newbie@example.test', template: 'verify-account', vars: { email: 'newbie@example.test' } },
      ]);
    } finally {
      await app.close();
    }
  });

  it('sends a "someone tried to sign up" email for an existing address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'seeded@example.test', 'seeded-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the first email');

      expect((await signUp(server, 'seeded@example.test', 'rival-password-9')).status).toBe(202);
      await waitUntil(
        () => sent.filter((mail) => mail.template === 'signup-attempted').length === 1,
        'the attempted email',
      );

      expect(sent.find((mail) => mail.template === 'signup-attempted')).toEqual({
        to: 'seeded@example.test',
        template: 'signup-attempted',
        vars: { email: 'seeded@example.test' },
      });
      expect(sent.some((mail) => mail.template === 'verify-account')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('changes nothing the caller observes when mail delivery fails', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(true);
    const { app, server } = await buildApp(service, port);
    try {
      const fresh = await signUp(server, 'no-mail@example.test', 'no-mail-password-1');
      const existing = await signUp(server, 'no-mail@example.test', 'no-mail-password-2');

      expect(fresh.status).toBe(202);
      expect(existing.status).toBe(202);
      expect(Buffer.from(fresh.text)).toEqual(Buffer.from(existing.text));
      expect(stripVolatileHeaders(fresh.headers)).toEqual(stripVolatileHeaders(existing.headers));
    } finally {
      await app.close();
    }
  });

  it('rejects malformed input with the error envelope', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const response = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'not-an-email', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: 'validation_failed', details: { fields: ['email', 'password'] } },
      });
      expect(typeof response.body.error.message).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const existingEmail = 'timing-existing@example.test';
      // Warm-up: sockets, argon2 native init, JIT — outside the measurement.
      await signUp(server, existingEmail, 'warm-up-password-1');
      await signUp(server, 'warm-up-new@example.test', 'warm-up-password-1');

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        existingTimes.push(
          await timedPost(server, '/auth/sign-up', existingEmail, `existing-sample-${i}-pass`, 202),
        );
        freshTimes.push(
          await timedPost(
            server,
            '/auth/sign-up',
            `timing-fresh-${i}@example.test`,
            `fresh-sample-${i}-pass`,
            202,
          ),
        );
      }

      const existingMean = average(existingTimes);
      const freshMean = average(freshTimes);
      const toleranceMs = Math.max(MEAN_TOLERANCE_MS, 0.3 * Math.min(existingMean, freshMean));

      // (1) The two distributions must not be separable. Fails if the
      // existing-address branch skips the hashing.
      expect(Math.abs(existingMean - freshMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...existingTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...freshTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe('POST /auth/sign-in', () => {
  it('returns byte-identical responses for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);

      const wrongPassword = await signIn(server, 'known@example.test', 'wrong-password-123');
      const unknownAddress = await signIn(server, 'ghost@example.test', 'ghost-password-123');

      expect(wrongPassword.status).toBe(401);
      expect(unknownAddress.status).toBe(401);
      expect(Buffer.from(wrongPassword.text)).toEqual(Buffer.from(unknownAddress.text));
      expect(stripVolatileHeaders(wrongPassword.headers)).toEqual(
        stripVolatileHeaders(unknownAddress.headers),
      );
      expect(wrongPassword.body).toEqual({
        error: {
          code: 'invalid_credentials',
          message: 'Email or password is incorrect.',
          details: {},
        },
      });
    } finally {
      await app.close();
    }
  });

  it('accepts the correct credentials', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);
      const response = await signIn(server, 'known@example.test', 'known-password-123');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Signed in.' });
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const knownEmail = 'timing-known@example.test';
      expect((await signUp(server, knownEmail, 'timing-known-pass-1')).status).toBe(202);
      // Warm-up: sockets, dummy-hash generation, argon2 native init.
      await signIn(server, knownEmail, 'warm-up-wrong-1');
      await signIn(server, 'warm-up-ghost@example.test', 'warm-up-pass-1');

      const wrongPasswordTimes: number[] = [];
      const unknownAddressTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        wrongPasswordTimes.push(
          await timedPost(server, '/auth/sign-in', knownEmail, `wrong-sample-${i}-pass`, 401),
        );
        unknownAddressTimes.push(
          await timedPost(
            server,
            '/auth/sign-in',
            `timing-ghost-${i}@example.test`,
            `ghost-sample-${i}-pass`,
            401,
          ),
        );
      }

      const wrongPasswordMean = average(wrongPasswordTimes);
      const unknownAddressMean = average(unknownAddressTimes);
      const toleranceMs = Math.max(
        MEAN_TOLERANCE_MS,
        0.3 * Math.min(wrongPasswordMean, unknownAddressMean),
      );

      // (1) The two distributions must not be separable. Fails if the
      // unknown-address branch skips the dummy verification.
      expect(Math.abs(wrongPasswordMean - unknownAddressMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...wrongPasswordTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...unknownAddressTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});
```

### SECURITY.md
```md
# Enumeration protection for /auth/sign-up and /auth/sign-in

## Mechanism
Every sign-up performs exactly one argon2id hash (32 MiB, 2 passes,
parallelism 1) before any database access: a new address stores it, an
existing address discards it. Every sign-in performs exactly one argon2id
verify: against the stored hash for a known address, or against a
precomputed dummy hash with identical parameters for an unknown one. Both
branches of both endpoints return the same status, body, and headers; the
only per-branch side effect (verification vs "attempted" email) is fired
without being awaited, so it changes neither the response nor its timing.

## Why this, and not the alternatives
- Early-return on a found address is the naive fix and is the leak itself.
- Random delay padding adds variance, not equivalence: the branch means
  still differ, and enough samples recover the signal.
- A constant sleep floor sits on top of the unremoved work difference and
  taxes every request; equalising the work removes it at the source.

## What this does not protect against
- Enumeration through other surfaces (password reset, account deletion,
  other endpoints that answer differently for known vs unknown addresses).
- A database-side observer: the new-account branch writes a row.
- Password brute force; this is not rate limiting.
- The dummy hash is public by design: it equalises timing, it is no secret.
```
