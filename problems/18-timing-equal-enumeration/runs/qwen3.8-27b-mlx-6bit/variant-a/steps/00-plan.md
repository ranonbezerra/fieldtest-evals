# plan

## reasoning

```
Let me analyze the task carefully to write a PLAN.md for a timing-equal enumeration attack prevention system.

The task requires:
1. POST /auth/sign-up — returns same response regardless of whether email exists
2. POST /auth/sign-in — returns same response for wrong password vs unknown email
3. Passwords hashed with argon2id/bcrypt at real cost
4. Timing equality between branches (the key requirement)
5. Email notifications reach the account owner but don't change what caller observes

Let me think through the design:

**Timing attack prevention mechanism:**
The key insight is that both branches must take the same amount of time. The standard approach:
- For sign-up: always perform a hash+verify cycle (even for new emails, hash the provided password and "verify" against a dummy hash). For existing emails, verify against the real hash. The verification step takes the same time in both cases.
- For sign-in: for unknown emails, verify against a dummy hash. For known emails with wrong password, verify against the real hash. Both take the same time.

This means:
- We need a "dummy" password hash stored as a constant that takes the same verification time as real hashes.
- The dummy hash must be generated at the same cost factor.

**Data model:**
- User table: id, email (unique), password_hash, created_at
- That's it for this task.

**Response format:**
- Both branches return the same status (200) and same body. What body? Something like `{ "message": "Check your email for instructions." }` — same for both.
- Same headers means we shouldn't add different headers per branch.

**Email:**
- New email → verification email
- Existing email → "someone tried to sign up" email
- These happen server-side, don't affect response

**Error handling:**
- Invalid input (missing email/password) → 400 with error envelope
- All "success" paths return 200 with identical body

**Sign-in:**
- Unknown email + any password → same as known email + wrong password
- Both return 401? Or both return 200? The requirement says "produce the same response" for wrong password and unknown address. So they must be identical. Let's make both return 401 with the same body. Wait, but that means even a successful sign-in must return something... Actually re-reading: "A wrong password and an unknown address produce the same response." It doesn't say what a successful sign-in returns. So successful sign-in can be different (200 with token), but wrong password and unknown email must be the same (401 with same body).

Wait, but for timing: if sign-in succeeds quickly (hash verify matches) vs fails (hash verify doesn't match), the timing of argon2 verify is the same regardless of match/no-match. So that's fine. The timing issue is unknown email (no hash to verify) vs known email (hash to verify). Solution: always verify against a hash (real or dummy).

**Sign-up timing:**
- New email: insert into DB, send verification email
- Existing email: no insert, send "someone tried to sign up" email
- The timing difference: DB insert takes time. To equalize, for new emails we still do a dummy verify. For existing emails we do a real verify. Both branches do one verify + one DB operation (insert vs no-insert). 

Actually wait — the timing concern is about the *observable* time. If we do:
- Branch A (new): hash password, verify against dummy, INSERT into DB, send email
- Branch B (existing): hash password, verify against real hash, no INSERT, send email

The DB insert adds time to branch A. To equalize:
- Branch A (new): hash password, verify against dummy, INSERT into DB, send email
- Branch B (existing): hash password, verify against real hash, do a no-op DB operation of similar time, send email

Or better: 
- Both branches: verify password against a hash (dummy or real)
- Both branches: perform a DB write of similar cost (INSERT for new, no-op SELECT or UPDATE with same value for existing)

Actually the simplest approach: 
- Always verify against a hash (real if exists, dummy if not)
- Always attempt the DB operation but handle it gracefully:
  - New: INSERT succeeds
  - Existing: INSERT fails (unique constraint), we catch it

The INSERT attempt + catch takes about the same as a successful INSERT in terms of time (both hit the DB). The verify is always done. This makes timing roughly equal.

Actually even simpler: do the verify first (same cost both branches), then do the DB operation. The DB operation for insert-new vs insert-existing (caught by constraint) should be close in timing. The main cost is the hash verify which is constant.

Let me reconsider. The argon2/bcrypt verify is the dominant cost (tens of ms). The DB insert is much faster (sub-ms to few ms). So as long as both branches do exactly one verify, the timing difference is just the DB operation delta which is small. But the requirement says "must not be able to tell the branches apart" — so we need to be careful.

Best approach: 
1. Check if email exists (SELECT)
2. Always verify password against a hash (real hash if exists, dummy hash if not) — this is the dominant cost and is constant
3. If email was new: INSERT, send verification email
4. If email existed: send "someone tried to sign up" email
5. Return identical response

The SELECT is fast and constant. The verify is the expensive part and is always done. The INSERT vs no-INSERT is a small delta. To eliminate even that:
- If new: INSERT + send verification email
- If existing: do a no-op (e.g., SELECT 1 or UPDATE user SET updated_at = updated_at WHERE id = ?) + send "tried to sign up" email

Or: always do the INSERT, catch the unique violation. This way both branches hit the DB write path.

I'll go with: always verify (real or dummy), then attempt INSERT, catch duplicate. This way both branches do one SELECT + one verify + one INSERT attempt.

Wait, if we catch the duplicate on INSERT, we still know whether it was new or existing (for the email). But the response is the same. Good.

Actually, let me reconsider the flow:

Sign-up:
1. Validate input
2. Hash the password with argon2id (cost factor)
3. Look up email in DB
4. If exists: verify password against real hash (to consume time), send "tried to sign up" email
5. If not exists: verify password against dummy hash (to consume time), INSERT, send verification email
6. Return 200 { message: "Check your email." }

Hmm but in step 4, why verify the password at all? The user isn't signing in, they're signing up. The purpose of the verify is purely to equalize timing. We verify the *provided* password against a hash. For existing: we could verify against their actual stored hash (or dummy, doesn't matter for timing). For new: we verify against a dummy.

Actually the simplest: always verify against the same dummy hash. That way:
- Both branches: hash input → verify against dummy (constant time)
- New: INSERT + send verification
- Existing: no INSERT + send "trried to sign up"

But then the INSERT delta is still there. To fix: always do a DB write of similar cost.

Let me just go with the approach where:
- We do a SELECT to check existence
- We always verify against a hash (dummy for new, could be real for existing — but let's just always use dummy for simplicity and consistency)
- For new: INSERT
- For existing: no-op (or we could skip and just send email)

The timing test will compare over multiple samples. If the verify dominates (say 100ms) and the INSERT is 1-2ms, the difference might be detectable with enough samples. So we should equalize the DB operations too.

Final approach for sign-up:
1. Validate input → 400 if invalid
2. Find user by email (SELECT)
3. Always: argon2.verify(provided_password, hash_to_verify_against) where hash_to_verify_against is the real hash if user exists, DUMMY_HASH otherwise
4. If user was not found: INSERT new user with argon2.hash(provided_password), send verification email
5. If user was found: send "someone tried to sign up" email
6. Return 200, identical body

For the timing equalization: step 3 is always done and dominates. Step 4 has INSERT (new) vs nothing (existing). To equalize: in the existing branch, do a no-op DB write (e.g., UPDATE users SET updated_at = now() WHERE id = ?) — but this adds a write lock. Or just accept the small delta since verify dominates.

Actually, I think the cleanest design that's defensible:
- The verify is the timing-equalization mechanism
- The DB operations are secondary (sub-ms vs 50-100ms for argon2)
- The test should show that over N samples, the distributions overlap significantly

For sign-in:
1. Validate input → 400 if invalid
2. Find user by email
3. Always: argon2.verify(provided_password, hash_to_verify_against) where hash_to_verify_against is real hash if user exists, DUMMY_HASH otherwise
4. If user exists AND verify succeeded: return 200 with token/session
5. Otherwise (user not found OR verify failed): return 401 { message: "Invalid credentials." }

The 401 body is identical for wrong-password and unknown-email. Good.

Now let me think about the dummy hash. It must be:
- Generated at the same argon2 parameters (time cost, memory, parallelism)
- A valid hash that argon2.verify can check against
- Stored as a constant in the code

I'll pre-generate one at startup or hardcode it. Actually, generating it at module init is fine — it's a one-time cost.

Let me now structure the PLAN.md:

**Files to create:**
- prisma/schema.prisma
- prisma/migrations/... (migration)
- src/main.ts
- src/app.module.ts
- src/auth/auth.module.ts
- src/auth/auth.controller.ts
- src/auth/auth.service.ts
- src/auth/auth.repository.ts
- src/auth/dto/sign-up.dto.ts (or inline in controller)
- src/auth/dto/sign-in.dto.ts
- test/auth.spec.ts
- SECURITY.md

Wait, the conventions say:
- `src/<feature>/<feature>.module.ts` → `src/auth/auth.module.ts`
- `src/<feature>/<feature>.controller.ts` → `src/auth/auth.controller.ts`
- `src/<feature>/<feature>.service.ts` → `src/auth/auth.service.ts`
- `src/<feature>/<feature>.repository.ts` → `src/auth/auth.repository.ts`
- `test/<feature>.spec.ts` → `test/auth.spec.ts`

For DTOs, I'll put them inline in the controller or in a separate file. Let me put them in the controller file to keep it simple, or in a `dto.ts` within the feature. Actually the convention doesn't specify DTOs. I'll put them as exported interfaces in the controller file or a separate `auth.dto.ts`. Let me use `src/auth/auth.dto.ts`.

Actually, looking at the manifest requirement: "List only files you will write." So I need to list every file.

Let me think about what the mail port looks like. The task says "Assume a mail port sendEmail(to, template, vars): Promise<void> exists." So I don't need to implement it, just use it. I'll inject it as an interface.

Now for the error envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

For sign-up/sign-in validation errors: code could be "validation_failed" or similar. For the 401 on sign-in, it's not really an "error" in the envelope sense — it's a normal auth failure. But we should use the envelope for consistency. Actually, the requirement says the 401 body must be identical for both cases. Let me use:
- 400: `{ "error": { "code": "validation_failed", "message": "...", "details": { ... } } }`
- 401 (sign-in failure): `{ "error": { "code": "invalid_credentials", "message": "Invalid credentials.", "details": {} } }`
- 200 (sign-up, both branches): `{ "message": "Check your email for next steps." }`
- 200 (sign-in success): `{ "message": "Signed in.", "token": "..." }` or similar

Wait, the requirement says for sign-up: "same status, same body, same headers." So both new and existing get 200 with identical body. Good.

For sign-in: "A wrong password and an unknown address produce the same response." So both get 401 with identical body. Successful sign-in gets something different (200).

Let me now write the plan concisely.

**Argon2 parameters:** time cost 3, memory 65536 KB (64MB), parallelism 1. This is a reasonable default. The dummy hash must be generated with the same parameters.

**Prisma schema:**
```
model User {
  id          String   @id @default(uuid())
  email       String   @unique
  passwordHash String  @map("password_hash")
  createdAt   DateTime @default(now()) @map("created_at")
  
  @@map("users")
}
```

**Migration:** Initial migration creating the users table.

Let me now write the PLAN.md sections concisely.
```

## reply

## 1. Assumptions

| Decision | Choice | Why |
|---|---|---|
| Hash algorithm & cost | argon2id, t=3, m=65536 KiB, p=1 | Satisfies "real cost factor"; widely available via `argon2` npm package |
| Dummy hash generation | Generated once at module init with same argon2 params, stored in a `const` | Guarantees identical verification cost to real hashes; no file I/O |
| Response body for sign-up (both branches) | `200 { "message": "Check your email for next steps." }` | Identical, no leak |
| Response body for sign-in failure (both branches) | `401 { "error": { "code": "invalid_credentials", "message": "Invalid credentials.", "details": {} } }` | Same envelope, same code, no distinction |
| Response body for sign-in success | `200 { "token": "<opaque-string>" }` | Distinguishes success from failure without leaking which branch caused the 401 |
| Token mechanism | Opaque random string (not JWT) stored in memory `Map` keyed by user id, 15 min TTL | Minimal; task doesn't require persistence of sessions |
| Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module | Task says it "exists"; we depend on the interface only |
| DTO validation | Class-validator decorators on DTO classes, global `ValidationPipe` in `main.ts` | Standard NestJS; controller stays logic-free |
| Input validation error code | `validation_failed` (400) | Fits the single-envelope convention |
| DB equalisation for sign-up | In the "existing" branch, issue a no-op `UPDATE users SET created_at = created_at WHERE id = ?` | Makes both branches perform one SELECT + one write, closing the sub-millisecond gap under repeated sampling |
| Test file | `test/auth.spec.ts` | Follows layout convention |

## 2. Data model

**Table `users`** (Prisma model `User`, `@@map("users")`)

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` (String in Prisma) | PK, default `uuid()` |
| `email` | `citext`-equivalent via Prisma `String @unique` | Unique, NOT NULL |
| `password_hash` | `String` (Prisma `passwordHash`, `@map("password_hash")`) | NOT NULL |
| `created_at` | `timestamptz` (Prisma `DateTime @default(now())`, `@map("created_at")`) | NOT NULL |

One migration: `init` — creates the table.

## 3. Types and signatures

### `src/auth/auth.dto.ts`

```ts
export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

### `src/auth/auth.repository.ts`

```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>;
  createUser(email: string, passwordHash: string): Promise<{ id: string }>;
  touchUser(id: string): Promise<void>;   // UPDATE … SET created_at = created_at WHERE id
}
```

### `src/auth/auth.service.ts`

```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly mail: MailPort,
  ) {}

  signUp(email: string, password: string): Promise<{ message: string }>;
  signIn(email: string, password: string): Promise<{ token: string }>
    // throws AuthFailureError on wrong-password OR unknown-email (indistinguishable)
}

export class AuthFailureError extends Error {
  readonly code = "invalid_credentials";
  constructor();
}
```

### `src/auth/auth.controller.ts`

```ts
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  signUp(@Body() dto: SignUpDto): Promise<{ message: string }>;

  @Post("sign-in")
  signIn(@Body() dto: SignInDto): Promise<{ token: string }>;
}
```

### `src/auth/auth.module.ts`

```ts
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

### `src/app.module.ts`

```ts
@Module({
  imports: [AuthModule],
})
export class AppModule {}
```

### `src/main.ts`

Bootstraps Nest, applies global `ValidationPipe({ whitelist: true })`, global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope.

### Errors raised

| Condition | HTTP | `code` | Raised by |
|---|---|---|---|
| Missing / malformed `email` or `password` | 400 | `validation_failed` | Global filter (from `ValidationPipe`) |
| Sign-in: wrong password **or** unknown email | 401 | `invalid_credentials` | `AuthService.signIn` → `AuthFailureError` |

No other error codes are produced by these endpoints.

### Ordering rule

Within `signUp`, the email existence check (`findByEmail`) **must** precede the argon2 verify. The verify **must** precede any DB write (INSERT or touch). This ordering ensures the expensive hash step is always executed before any branch-divergent I/O, so the dominant cost is identical regardless of branch.

## 4. Control flow

### `POST /auth/sign-up`

1. **Validate** (controller layer via pipe). Reject → 400 envelope.
2. **SELECT** `findByEmail(email)` (repository). Let result be `existing`.
3. **Verify** — always execute `argon2.verify(dto.password, hashToCheck)`:
   - If `existing` is non-null: `hashToCheck = existing.passwordHash`.
   - Otherwise: `hashToCheck = DUMMY_HASH` (module-level constant).
   The verify result is **discarded** in both branches. Its sole purpose is to consume a constant amount of time.
4. **Branch (DB + mail):**
   - If `existing` is null:
     a. Hash: `realHash = await argon2.hash(dto.password)` (same params).
     b. `repo.createUser(email, realHash)`.
     c. `mail.sendEmail(email, "verification", { email })`.
   - If `existing` is non-null:
     a. `repo.touchUser(existing.id)` (no-op write to equalise DB round-trip).
     b. `mail.sendEmail(email, "sign-up-attempt", { email })`.
5. **Return** `200 { "message": "Check your email for next steps." }` — identical in both branches.

No transaction wraps the write + mail; if mail fails the user is still created (at-least-once delivery).

### `POST /auth/sign-in`

1. **Validate** (controller layer via pipe). Reject → 400 envelope.
2. **SELECT** `findByEmail(email)`. Let result be `existing`.
3. **Verify** — always execute `argon2.verify(dto.password, hashToCheck)`:
   - If `existing` is non-null: `hashToCheck = existing.passwordHash`.
   - Otherwise: `hashToCheck = DUMMY_HASH`.
4. **Branch:**
   - If `existing` is non-null **and** verify returned `true`: create opaque token, store in in-memory map, return `200 { token }`.
   - Otherwise (unknown email **or** wrong password): throw `AuthFailureError` → 401 envelope.
5. No email is sent on sign-in.

The 401 body is byte-identical whether the cause was an unknown email or a wrong password.

### DUMMY_HASH

Generated at module initialisation: `const DUMMY_HASH = await argon2.hash("timing-equalization-dummy", ARGON2_PARAMS)`. Stored in a closure-scoped `let` assigned in a provider's `onModuleInit`. Not exposed publicly.

## 5. Tests

| # | Test name (concept) | What it proves |
|---|---|---|
| 1 | sign-up new email → 200, correct body | Happy path creates the account and returns the expected shape |
| 2 | sign-up existing email → 200, correct body | Existing email does not leak a different status or body |
| 3 | sign-up byte-equality of response (new vs existing) | Serialised body, status, and `Content-Type` header are identical between the two branches |
| 4 | sign-up timing (N=30 samples each branch) | Median and p95 of the two distributions overlap within a threshold (e.g. < 10 ms difference), proving no exploitable timing gap |
| 5 | sign-up sends verification email for new address | `MailPort.sendEmail` called with `"verification"` template and the user's email |
| 6 | sign-up sends "sign-up-attempt" email for existing address | `MailPort.sendEmail` called with `"sign-up-attempt"` template |
| 7 | sign-up does NOT send email for existing address with wrong… *(n/a — no password check on sign-up)* | *(removed — not applicable)* |
| 8 | sign-in correct credentials → 200 + token | Successful auth returns a usable token |
| 9 | sign-in wrong password (known email) → 401 envelope | Standard failure path |
| 10 | sign-in unknown email → 401 envelope | Unknown address path |
| 11 | sign-in byte-equality (wrong-password vs unknown-email) | Status, body bytes, and headers are identical between the two failure branches |
| 12 | sign-in timing (N=30 samples each branch) | Median and p95 of the two failure distributions overlap within threshold, proving no timing gap |
| 13 | sign-up / sign-in missing fields → 400 `validation_failed` | Input validation uses the error envelope |
| 14 | password stored as argon2id hash (inspect DB after sign-up) | Cost factor ≥ 3, algorithm is argon2id (parses hash string prefix `$argon2id$`) |
| 15 | sign-up email is stored lowercased / normalised (if applicable) | Consistent lookup key *(skip if not implemented)* |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | User model, datasource, generator config
prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | CREATE TABLE users
src/main.ts | reads: src/app.module.ts | Bootstrap, ValidationPipe, global exception filter
src/app.module.ts | reads: src/auth/auth.module.ts | Root module importing AuthModule
src/auth/auth.module.ts | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts, src/auth/auth.dto.ts | Feature module wiring
src/auth/auth.dto.ts | reads: - | SignUpDto, SignInDto with class-validator decorators
src/auth/auth.controller.ts | reads: src/auth/auth.service.ts, src/auth/auth.dto.ts | POST /auth/sign-up, POST /auth/sign-in
src/auth/auth.service.ts | reads: src/auth/auth.repository.ts | SignUp/SignIn logic, DUMMY_HASH, MailPort interface, AuthFailureError
src/auth/auth.repository.ts | reads: - | findByEmail, createUser, touchUser (Prisma)
test/auth.spec.ts | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts, src/auth/auth.dto.ts | All tests in section 5
SECURITY.md | reads: - | Mechanism description, rationale, limitations (15-25 lines)
-->
