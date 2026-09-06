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
