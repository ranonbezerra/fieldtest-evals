# repair1-set

## reasoning

```
Let me analyze the errors carefully.

All errors are in `src/auth/auth.service.ts`, all in the `classifyLostClaim` method. The issue is that `record` is returned from `this.repository.findByToken(token)` and the code does `const { token: row, family } = record;` — but then it accesses `row.retired`, `row.revoked`, `row.id`, `row.expiresAt` as if `row` is the token object, not a string.

Looking at the destructuring: `const { token: row, family } = record;`

This means `record` has a property `token` (which is a string — the token value) and a property `family`. But the code then treats `row` (which is the string `token`) as if it were the token row object with properties like `retired`, `revoked`, `id`, `expiresAt`.

The problem is the variable naming. The `record` returned by `findByToken` likely has a shape where the token row data is accessible. Let me think about what `findByToken` should return.

Looking at the service code:
- `record` is from `this.repository.findByToken(token)`
- The code does `const { token: row, family } = record;`
- Then accesses `row.retired`, `row.revoked`, `row.id`, `row.expiresAt`
- And `family.revokedAt`

So `record` should have a shape like:
```
{
  token: { id, token, retired, revoked, expiresAt, ... },  // the RefreshToken row
  family: { id, revokedAt, userId, ... }                    // the RefreshFamily
}
```

But the destructuring `const { token: row, family } = record` means `row` IS the `token` property of `record`. If `record.token` is a string (the token value), then `row` is a string, hence the errors.

Wait, let me re-read. The Prisma model has:
```
model RefreshToken {
  id         String        @id @default(uuid())
  token      String        @unique
  ...
}
```

So `record` from `findByToken` likely returns the full RefreshToken object (which has a `token` field that is the string token value, plus `id`, `retired`, `revoked`, `expiresAt`, etc.) along with the related `family`.

If `findByToken` returns something like:
```ts
{ token: string; family: RefreshFamily }
```

That doesn't make sense because then you'd lose the token row data.

More likely, `findByToken` returns the RefreshToken row (which includes the related family via `include`), so it would be:
```ts
{
  id: string;
  token: string;
  familyId: string;
  expiresAt: Date;
  retired: boolean;
  retiredAt: Date | null;
  revoked: boolean;
  revokedAt: Date | null;
  createdAt: Date;
  family: { id: string; userId: string; absoluteExpiryAt: Date; createdAt: Date; revokedAt: Date | null; }
}
```

In that case, the destructuring `const { token: row, family } = record;` would make `row` the string `token` field (the actual token value), NOT the token row object. That's the bug!

The fix: The code should destructure the token row differently. It should be something like:
```ts
const { family } = record;
```
And then access `record.retired`, `record.revoked`, `record.id`, `record.expiresAt` directly on `record`.

OR, the destructuring should be:
```ts
const { family, ...row } = record;
```
But that's awkward.

Actually, the simplest fix that matches the intent: the code wants `row` to be the token row data and `family` to be the family. The issue is that `record.token` is the string token value, not the row.

So the fix should be to change the destructuring. Instead of:
```ts
const { token: row, family } = record;
```

It should be:
```ts
const { family } = record;
```

And then replace `row.retired` → `record.retired`, `row.revoked` → `record.revoked`, `row.id` → `record.id`, `row.expiresAt` → `record.expiresAt`.

Wait, but I need to be careful. Let me look at what the repository's `findByToken` returns. I don't have the repository file, but based on the service code usage, it must return an object that has both the token row properties AND the family. The most natural Prisma `include` result would be the flat token row with `family` included.

So the fix is:
- Change `const { token: row, family } = record;` to `const { family } = record;`
- Change `row.retired` → `record.retired`
- Change `row.revoked` → `record.revoked`  
- Change `row.id` → `record.id`
- Change `row.expiresAt` → `record.expiresAt`

Let me verify against the error lines:
- Line 118: `if (row.retired || row.revoked || family.revokedAt !== null)` → `if (record.retired || record.revoked || family.revokedAt !== null)`
- Line 127: `detail: { tokenId: row.id, ...}` → `detail: { tokenId: record.id, ...}`
- Line 128: `state: row.revoked ? 'revoked' : row.retired ? 'retired' : 'family_revoked',` → `state: record.revoked ? 'revoked' : record.retired ? 'retired' : 'family_revoked',`
- Line 140: `detail: { tokenId: row.id, deadline: row.expiresAt <= now ? 'token' : 'family' }` → `detail: { tokenId: record.id, deadline: record.expiresAt <= now ? 'token' : 'family' }`

This is one distinct mistake: the destructuring `const { token: row, family } = record` incorrectly treats the `token` field (a string) as the row object. The fix is to not destructure `token` out and instead use `record` directly for the row properties.

Let me write the complete fixed file.
```

## reply

### src/auth/auth.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from './access-token.provider.js';
import { AuthRepository } from './auth.repository.js';
import { RefreshRejectedError } from './refresh-rejected.error.js';

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Sliding lifetime of one refresh token (seconds, env, default 1 h). */
const REFRESH_TOKEN_TTL_MS = (Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 3600) * 1000;
/**
 * Absolute lifetime of a session (seconds, env, default 30 d). Fixed once, at
 * sign-in, on the family; rotation can never extend it.
 */
const SESSION_ABSOLUTE_TTL_MS = (Number(process.env.SESSION_ABSOLUTE_TTL_SECONDS) || 2_592_000) * 1000;

const MAX_TOKEN_LENGTH = 512;
/** Our tokens are 48 random bytes in base64url; anything else is malformed. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokens: AccessTokenIssuer,
  ) {}

  /**
   * Sign-in seam (the wider system already has sign-in; this is the hook it
   * calls): creates the family with its absolute deadline fixed here and mints
   * the first refresh token.
   */
  async beginSession(userId: string): Promise<RefreshResult> {
    const now = new Date();
    const refreshToken = this.mintToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    await this.repository.createSession({
      userId,
      token: refreshToken,
      expiresAt,
      absoluteExpiryAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
    });
    return {
      accessToken: this.accessTokens.issueAccessToken(userId),
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /**
   * Rotates one presented refresh token. Every failure cause — malformed,
   * unknown, expired, reuse — funnels through the single `reject()` below, so
   * the response is identical to the caller; only the audit record differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = new Date();
    const token = typeof presented === 'string' ? presented : '';

    // 1. Malformed: rejected before any database access.
    if (!this.isWellFormed(token)) {
      await this.repository.recordAuditEvent({
        at: now,
        cause: 'malformed',
        detail: { length: token.length },
      });
      return this.reject();
    }

    // 2. Reuse, checked as the write: one conditional UPDATE retires the token
    //    only if it is live, unexpired, and in an unrevoked family. The
    //    database serialises concurrent claims on the row, so exactly one of N
    //    concurrent presentations wins.
    const claimed = await this.repository.claim(token, now);
    if (!claimed) {
      return this.classifyLostClaim(token, now);
    }

    // 3. Winner: mint the successor into the same family, so the absolute
    //    deadline is inherited, never extended.
    const refreshToken = this.mintToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    const successorId = await this.repository.issueSuccessor(claimed.family.id, refreshToken, expiresAt);

    await this.repository.recordAuditEvent({
      at: now,
      cause: 'rotated',
      familyId: claimed.family.id,
      userId: claimed.family.userId,
      detail: { tokenId: claimed.id, successorId },
    });

    return {
      accessToken: this.accessTokens.issueAccessToken(claimed.family.userId),
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /**
   * A lost claim means this token did not rotate. Reading it back tells us why:
   * no row is `unknown`; retired, revoked, or family-revoked is `reuse` (checked
   * before expiry, on purpose — a token both retired and expired is an attack
   * signal, not a routine expiry); still live means a deadline passed, `expired`.
   */
  private async classifyLostClaim(token: string, now: Date): Promise<never> {
    const record = await this.repository.findByToken(token);
    if (!record) {
      await this.repository.recordAuditEvent({ at: now, cause: 'unknown', detail: {} });
      return this.reject();
    }

    const { family } = record;
    if (record.retired || record.revoked || family.revokedAt !== null) {
      // Reuse: retire the whole family in one operation, then audit it.
      await this.repository.revokeFamily(family.id, now);
      await this.repository.recordAuditEvent({
        at: now,
        cause: 'reuse',
        familyId: family.id,
        userId: family.userId,
        detail: {
          tokenId: record.id,
          state: record.revoked ? 'revoked' : record.retired ? 'retired' : 'family_revoked',
        },
      });
      return this.reject();
    }

    // Live and unrevoked, so the claim failed on a deadline.
    await this.repository.recordAuditEvent({
      at: now,
      cause: 'expired',
      familyId: family.id,
      userId: family.userId,
      detail: { tokenId: record.id, deadline: record.expiresAt <= now ? 'token' : 'family' },
    });
    return this.reject();
  }

  private isWellFormed(token: string): boolean {
    return token.length > 0 && token.length <= MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(token);
  }

  private mintToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private reject(): never {
    throw new RefreshRejectedError();
  }
}
```
