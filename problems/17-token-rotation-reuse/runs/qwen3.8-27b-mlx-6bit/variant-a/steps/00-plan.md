# plan

## reasoning

```
Let me analyze the task carefully and write a PLAN.md for implementing refresh-token rotation with reuse detection.

Key requirements:
1. POST /auth/refresh - accepts refresh token, returns new access + new refresh token, retires presented token
2. Token in JSON body `refreshToken` OR `refresh_token` cookie - need to define which wins
3. Concurrent requests: exactly one may rotate (atomic)
4. Reuse of retired token = compromise: invalidate entire family, record audit
5. Absolute lifetime fixed at sign-in, rotation never extends deadline
6. All rejections indistinguishable to caller, but audit distinguishes

Let me think through the design:

**Data model:**
- `refresh_tokens` table: id, token (hashed), family_id (chain of rotations from same sign-in), user_id, expires_at, created_at, retired_at (nullable)
- `audit_events` table: id, token_id, family_id, event_type (enum), created_at

Actually, let me think about the "family" concept. When a user signs in, we create a refresh token with a family_id. Each rotation creates a new token in the same family. If a retired token is presented, we invalidate all tokens in that family.

**Concurrency:** The "exactly one rotates" requirement means we need an atomic check-and-set. In PostgreSQL, we can use `SELECT ... FOR UPDATE` or a conditional UPDATE. The cleanest approach: do a conditional UPDATE that sets `retired_at` only if it's NULL, and check the affected rows count. If 0 rows affected, the token was already retired or doesn't exist.

**Ordering of checks:**
1. Parse/validate token format (malformed) → reject
2. Look up token by hash → not found means unknown or retired
3. If retired → reuse detection → invalidate family
4. If expired → reject
5. Rotate

Wait, but requirement 6 says all rejections are indistinguishable. So expired, retired (non-reuse... wait, retired IS reuse), unknown, malformed all return the same response.

Actually re-reading: "Presenting an already-retired token is treated as compromise" — so retired = reuse. The distinction is:
- Malformed (bad format) → reject, audit as malformed
- Unknown (not in DB) → reject, audit as unknown  
- Expired → reject, audit as expired
- Retired (reuse) → invalidate family, reject, audit as reuse

All return the same HTTP response to the caller.

**Ordering between checks:**
The critical ordering: check if retired BEFORE checking expired. Why? Because a retired token that's also expired is still a reuse event (compromise). The attacker replayed a token they shouldn't have.

Actually wait — if a token is retired AND expired, is it still a compromise? I'd say yes, because the token was retired (rotated) and then presented again. The expiry is irrelevant to the reuse detection.

But actually, let me reconsider. If a token expired 3 days ago and was retired 2 days ago, presenting it now is... still a reuse. The token was valid, got rotated, and now someone's presenting it again. That's a compromise signal regardless of expiry.

So the order is:
1. Parse (malformed?)
2. Look up by hash
3. Is it in the DB? No → unknown
4. Is it retired? Yes → REUSE (invalidate family)
5. Is it expired? Yes → expired
6. Rotate

This ordering matters because step 4 before step 5: a retired+expired token triggers reuse, not just expiry.

**Token format:** I'll use a random 256-bit hex string. Store the SHA-256 hash in DB (not the raw token) so a DB leak doesn't expose valid tokens.

**Which source wins:** I'll say the JSON body `refreshToken` wins over the cookie when both are present. Document this.

**Absolute deadline:** The `expires_at` is set at sign-in time and carried forward to every new token in the family. The service receives `expiresAt` as a parameter (passed from the sign-in flow) and uses it for all rotations in that family.

Wait, actually re-reading: "A session has an absolute lifetime fixed at sign-in. Rotation issues a new token but never extends that deadline." So the expires_at is the same for all tokens in the family. It's set once at sign-in.

So the `refresh_tokens` table has `expires_at` which is the family's absolute deadline. Every rotation creates a new token with the same `expires_at`.

**File layout:**
- `prisma/schema.prisma` — schema
- `prisma/migrations/20250101000000_init/migration.sql` — migration
- `src/auth/auth.module.ts`
- `src/auth/auth.controller.ts`
- `src/auth/auth.service.ts`
- `src/auth/auth.repository.ts`
- `test/auth.spec.ts`
- `SECURITY.md`

**Types:**

Let me define the Prisma models:

```prisma
model RefreshToken {
  id          String    @id @default(uuid())
  tokenHash   String    @unique @map("token_hash")
  familyId    String    @map("family_id")
  userId      String    @map("user_id")
  expiresAt   DateTime  @map("expires_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  retiredAt   DateTime? @map("retired_at")

  @@map("refresh_tokens")
}

model AuditEvent {
  id        String   @id @default(uuid())
  familyId  String   @map("family_id")
  tokenId   String?  @map("token_id")
  eventType AuditEventType @map("event_type")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("audit_events")
}

enum AuditEventType {
  ROTATED
  REJECTED_MALFORMED
  REJECTED_UNKNOWN
  REJECTED_EXPIRED
  REUSE_COMPROMISE
}
```

**Service method signature:**

```typescript
interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

class AuthService {
  refresh(input: RefreshInput): Promise<RefreshResult>;
}

interface RefreshInput {
  token: string; // the raw refresh token
  userId?: string; // not needed if we look it up from the token
}
```

Wait, actually the userId is in the token record. The service just needs the token string.

**Controller:**
- Reads `refreshToken` from body or `refresh_token` cookie
- Body wins
- Calls service
- Returns `{ accessToken, refreshToken }` with 200
- On rejection: returns 401 with the standard error envelope

**Repository methods:**
- `findByTokenHash(hash: string): Promise<RefreshToken | null>`
- `retireToken(id: string): Promise<boolean>` — atomic, returns true if it was still active
- `createToken(tokenHash: string, familyId: string, userId: string, expiresAt: Date): Promise<RefreshToken>`
- `invalidateFamily(familyId: string): Promise<void>` — set retired_at on all active tokens in family
- `recordAudit(event: ...): Promise<void>`

Wait, for the atomic rotation, I need to be careful. The "exactly one rotates" requirement means:

```
BEGIN TRANSACTION
  token = SELECT * FROM refresh_tokens WHERE token_hash = ? FOR UPDATE
  IF token IS NULL → unknown
  IF token.retired_at IS NOT NULL → reuse
  IF token.expires_at < NOW() → expired
  UPDATE refresh_tokens SET retired_at = NOW() WHERE id = ? AND retired_at IS NULL
  -- check affected rows = 1
  new_token = INSERT ...
  audit = INSERT ...
COMMIT
```

Actually, `FOR UPDATE` on the SELECT is the key. It locks the row, so a second concurrent request will block until the first commits, then see `retired_at` is set.

But wait — what if both requests arrive before either commits? With `FOR UPDATE`, the second one blocks. When the first commits, the second unblocks and sees `retired_at IS NOT NULL`, so it goes to the reuse path.

This is correct. Let me use this approach.

**The transaction boundary:**
- The entire refresh operation is one DB transaction
- Inside: lock token, check state, retire, create new, audit
- The access token issuance is NOT inside the DB transaction (it's a local computation)

Actually, should the audit for rejection also be in a transaction? For reuse, yes — invalidate family + audit must be atomic. For simple rejections (malformed, unknown, expired), the audit is a single insert, no transaction needed.

Let me refine:
- Reuse path: BEGIN → lock token (already locked from the main flow) → invalidate all active tokens in family → audit REUSE → COMMIT
- Actually it's the same transaction as the main flow since we're already in one.

Let me think about this differently. The service method:

1. Hash the token
2. Call repository.doRefresh(hash) which is a single transaction:
   - SELECT FOR UPDATE the token row
   - Branch on state
   - For success: retire, create new, audit ROTATED, return result
   - For reuse: invalidate family, audit REUSE, throw ReuseDetected
   - For expired: audit EXPIRED, throw TokenExpired
   - For unknown: audit UNKNOWN, throw TokenUnknown
3. Service catches specific errors, returns the uniform rejection

Wait, but malformed is before the DB call. If the token doesn't match the expected format (e.g., wrong length, not hex), we reject before hitting the DB.

**Error types:**
All internal errors map to the same external response: 401 with `{ error: { code: "invalid_refresh_token", message: "...", details: {} } }`

The audit record is what distinguishes them.

**SECURITY.md ordering:**
1. Malformed check first (no DB hit, no info leak)
2. Look up by hash (unknown vs known)
3. Retired check before expired (reuse detection takes priority over expiry)
4. Expired check last among rejections
5. Rotate only if all pass

Reason: Reuse of a retired token is a higher-severity event than expiry. Even if the token has also expired, the fact that it was rotated and then replayed indicates compromise. An attacker who steals a token after rotation should be detected even if the token's absolute deadline has passed.

Now let me write the PLAN.md. I need to be concise and complete.

Let me count what files I'll write:
- `prisma/schema.prisma`
- `prisma/migrations/20250101000000_init/migration.sql`
- `src/auth/auth.module.ts`
- `src/auth/auth.controller.ts`
- `src/auth/auth.service.ts`
- `src/auth/auth.repository.ts`
- `test/auth.spec.ts`
- `SECURITY.md`

Now for the manifest, I need to list reads correctly. Each file can only read files listed above it.

Let me structure the manifest:
- `prisma/schema.prisma` | reads: -
- `prisma/migrations/20250101000000_init/migration.sql` | reads: prisma/schema.prisma
- `src/auth/auth.repository.ts` | reads: prisma/schema.prisma
- `src/auth/auth.service.ts` | reads: src/auth/auth.repository.ts
- `src/auth/auth.controller.ts` | reads: src/auth/auth.service.ts
- `src/auth/auth.module.ts` | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts
- `test/auth.spec.ts` | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts
- `SECURITY.md` | reads: -

Wait, the manifest format says "A file may name under `reads:` only files listed above it." So I need to order them so dependencies come first.

Let me also think about whether I need a `prisma/seed.ts` or any other file. No, keep it minimal.

Do I need a `src/main.ts` or `src/app.module.ts`? The task says "NestJS module: controller, service, repository" — I think just the auth module is what's asked. The main.ts and app.module.ts would be boilerplate. Let me include them minimally since they're needed to run the app... Actually, the task says "Do not create a file it does not call for." The deliverables are:
- Prisma schema + migration
- NestJS module: controller, service, repository
- Tests
- SECURITY.md

So I'll include the module file (which wires controller, service, repository) but not main.ts/app.module.ts since those aren't called for. Actually, a NestJS module is needed to wire things. Let me include `src/auth/auth.module.ts`.

Hmm, but without app.module.ts and main.ts, it's not runnable. But the task says implement the module. I'll stick to what's asked.

Let me also think about whether the repository needs a separate file or can be in the service. The conventions say:
- `src/<feature>/<feature>.repository.ts`

So yes, separate file.

For the migration, I'll name it `prisma/migrations/001_init/migration.sql` — actually Prisma uses timestamps. Let me use a generic name. The convention in the repo might vary. I'll use `prisma/migrations/20250711000000_init/migration.sql`.

Actually, for the plan I just need to specify what the migration contains. The exact filename can be determined at implementation time based on when it's created. But the manifest needs a path... Let me just pick one: `prisma/migrations/20250711000000_init/migration.sql`.

Now let me write the plan.
```

## reply

## 1. Assumptions

| Open question | Choice | Why |
|---|---|---|
| Token in body vs cookie when both present | Body `refreshToken` wins; cookie is fallback | Explicit JSON is the primary channel; cookie exists for browser flows that can't set a header. Documented in controller JSDoc. |
| Token format | 256-bit random hex string (64 chars) | Uniform entropy, trivial to validate length/charset before any DB work. |
| Token stored in DB | SHA-256 hex of the raw token | A DB leak does not yield a usable token. |
| Absolute deadline source | Passed in at sign-in as `expiresAt: Date`; stored on every token row in the family | "Fixed at sign-in" means one value for the whole chain. |
| `issueAccessToken(userId)` | Pre-existing; injected into service via a token-issuer interface | Task says it already exists. |
| Uniform rejection HTTP status | 401 with `code: "invalid_refresh_token"` | All four rejection classes share one contract; audit is the only differentiator. |
| Migration filename | `prisma/migrations/20250711000000_init/migration.sql` | Deterministic for the plan; implementer keeps or renames as `prisma migrate dev` dictates. |
| Prisma client import path | `@prisma/client` generated into `node_modules` (default) | Standard. |
| ESM imports | All relative imports use `.js` extension per `"type": "module"` | Node 20 ESM requirement. |

## 2. Data model

### `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | |
| `token_hash` | `varchar(64)` UNIQUE, NOT NULL | SHA-256 hex of raw token |
| `family_id` | `uuid`, NOT NULL, INDEXED | All tokens descended from one sign-in share this |
| `user_id` | `varchar(255)`, NOT NULL | |
| `expires_at` | `timestamptz`, NOT NULL | Absolute deadline, identical for every row in the family |
| `created_at` | `timestamptz`, NOT NULL, default `now()` | |
| `retired_at` | `timestamptz`, NULLABLE | Set the instant this token is rotated or family is invalidated |

### `audit_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | |
| `family_id` | `uuid`, NOT NULL, INDEXED | |
| `token_id` | `uuid`, NULLABLE | The specific token row involved |
| `event_type` | `audit_event_type` enum, NOT NULL | See below |
| `created_at` | `timestamptz`, NOT NULL, default `now()` | |

### Enum `audit_event_type`

Values: `ROTATED`, `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, `REUSE_COMPROMISE`

## 3. Types and signatures

```typescript
// src/auth/auth.repository.ts

export class AuthRepository {
  constructor(prisma: PrismaClient);

  /** Atomically: lock by hash, evaluate state, mutate. One transaction.
   *  Returns the outcome; never throws for "expected" rejection states. */
  executeRefresh(
    tokenHash: string,
  ): Promise<RepositoryRefreshResult>;

  // Internal helpers (not exported from the module boundary)
  private retireAndCreate(…): Promise<RefreshTokenRecord>;
  private invalidateFamily(familyId: string): Promise<void>;
  private recordAudit(…): Promise<void>;
}

export type RepositoryRefreshResult =
  | { outcome: 'rotated'; newToken: TokenRecord; user: UserRef }
  | { outcome: 'rejected'; reason: RejectionReason; tokenRecord?: TokenRecord }
  | { outcome: 'reuse'; familyId: string };

export type RejectionReason = 'unknown' | 'expired';

export interface TokenRecord {
  id: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  retiredAt: Date | null;
}

export interface UserRef { userId: string; }
```

```typescript
// src/auth/auth.service.ts

export interface RefreshInput {
  /** Raw token string as received (body or cookie). */
  rawToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export class InvalidRefreshTokenError extends Error {}
// Raised for every rejection; carries no public detail.

export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly issuer: AccessTokenIssuer,
  );

  refresh(input: RefreshInput): Promise<RefreshResult>;
}
```

```typescript
// src/auth/auth.controller.ts

export class AuthController {
  constructor(private readonly service: AuthService);

  /** POST /auth/refresh */
  @Post('refresh')
  refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult>;
}
```

```typescript
// src/auth/auth.module.ts

export class AuthModule implements NestModule {
  // providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
  // exports: AuthService
}
```

### Ordering rules between operations

| Pair | Required order | Rationale |
|---|---|---|
| Malformed check vs DB lookup | Malformed first | No hash to compute; short-circuits before any I/O. |
| Retired check vs Expired check (inside `executeRefresh`) | Retired first | A retired+expired token is still a reuse event; compromise detection supersedes expiry. |
| `retireToken` vs `createNewToken` (inside `executeRefresh`) | Retire before create | If create fails, the old token is already dead; no window where two tokens are both active. |
| `invalidateFamily` vs `recordAudit(REUSE_COMPROMISE)` | Invalidate first, audit second (same tx) | If the process crashes mid-tx both roll back; no partial invalidation without audit. |

## 4. Control flow

### `POST /auth/refresh` — happy path (single request)

1. **Controller** extracts raw token: body `refreshToken` if present, else parse `refresh_token` from `cookie` header. If neither, treat as empty string (→ malformed).
2. **Controller** calls `service.refresh({ rawToken })`.
3. **Service — malformed guard:** if `rawToken` is not exactly 64 hex chars, record `REJECTED_MALFORMED` audit (family unknown, token unknown), throw `InvalidRefreshTokenError`.
4. **Service** computes `sha256hex(rawToken)`, calls `repo.executeRefresh(hash)`.
5. **Repository** opens a single `$transaction`:
   - `SELECT … FOR UPDATE` on `refresh_tokens` where `token_hash = ?`.
   - **Row missing** → insert audit `REJECTED_UNKNOWN` → return `{ outcome:'rejected', reason:'unknown' }`.
   - **Row `retired_at IS NOT NULL`** → `UPDATE refresh_tokens SET retired_at = now() WHERE family_id = ? AND retired_at IS NULL` (invalidate siblings) → insert audit `REUSE_COMPROMISE` → return `{ outcome:'reuse', familyId }`.
   - **Row `expires_at < now()`** → insert audit `REJECTED_EXPIRED` → return `{ outcome:'rejected', reason:'expired' }`.
   - **Row is active and unexpired** → `UPDATE` set `retired_at = now()` on this row → `INSERT` new row (same `family_id`, same `user_id`, same `expires_at`, new `token_hash`) → insert audit `ROTATED` → return `{ outcome:'rotated', newToken, user }`.
   - Commit.
6. **Service** on `rotated`: call `issuer.issueAccessToken(userId)`, generate new raw token (256-bit random), return `{ accessToken, refreshToken }`.
7. **Service** on `rejected` or `reuse`: throw `InvalidRefreshTokenError`.
8. **Controller** catches `InvalidRefreshTokenError`, returns **401** body:
   ```json
   { "error": { "code": "invalid_refresh_token", "message": "Refresh token is invalid.", "details": {} } }
   ```

### Concurrency guarantee

`SELECT … FOR UPDATE` serialises concurrent callers on the same token row. The second caller blocks until the first commits, then re-reads and sees `retired_at` set → falls into the reuse branch. Exactly one caller reaches the rotate path.

### What must NOT be inside the transaction

- `issueAccessToken` (pure computation, no DB).
- Raw-token generation (`crypto.randomBytes`).
- HTTP response serialization.

### Rejection indistinguishability

Every rejection path returns the identical 401 envelope. The only place the distinction exists is the `audit_events` row written inside the transaction (or as a standalone insert for malformed, which has no token to reference).

## 5. Tests

| # | Test name | Proves |
|---|---|---|
| 1 | Concurrent rotation: two `refresh` calls with the same token — exactly one returns 200, the other 401 | The `FOR UPDATE` lock guarantees single-writer; no double-rotation. |
| 2 | Replay after rotation: rotate token A→B, then present A again — B is also invalidated (next refresh with B returns 401) | Reuse of a retired token invalidates the entire family, not just the presented token. |
| 3 | Absolute deadline: sign-in with `expiresAt = now+1h`; after 70 min, a *freshly rotated* token (same family) is rejected | Rotation carries the original deadline; it never extends. |
| 4 | Rejection indistinguishability: malformed, unknown, expired, and reuse all return identical status + body | The caller cannot fingerprint the rejection reason from the HTTP response. |
| 5 | Audit completeness: each of the four rejection classes writes a distinct `event_type` to `audit_events` | The audit trail differentiates what the API response hides. |
| 6 | Source precedence: body `refreshToken` and cookie `refresh_token` both present — body token is used | Documents and locks the "body wins" contract. |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma models RefreshToken, AuditEvent, enum AuditEventType
prisma/migrations/20250711000000_init/migration.sql | reads: prisma/schema.prisma | DDL for both tables and the enum
src/auth/auth.repository.ts | reads: prisma/schema.prisma | AuthRepository class, RepositoryRefreshResult, RejectionReason, TokenRecord types
src/auth/auth.service.ts | reads: src/auth/auth.repository.ts | AuthService, RefreshInput, RefreshResult, InvalidRefreshTokenError, AccessTokenIssuer
src/auth/auth.controller.ts | reads: src/auth/auth.service.ts | AuthController with POST /auth/refresh handler
src/auth/auth.module.ts | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts | NestJS wiring (providers, exports)
test/auth.spec.ts | reads: src/auth/auth.repository.ts, src/auth/auth.service.ts, src/auth/auth.controller.ts | All six test cases from section 5
SECURITY.md | reads: - | Check-ordering rationale (15-25 lines)
-->
