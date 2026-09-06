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
