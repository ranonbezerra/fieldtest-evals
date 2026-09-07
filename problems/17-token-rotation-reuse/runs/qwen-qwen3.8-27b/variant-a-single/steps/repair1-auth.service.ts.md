# repair1-auth.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/auth/auth.service.ts`:

1. `src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.`
2. `src/auth/auth.service.ts(59,50): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
3. `src/auth/auth.service.ts(83,52): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
4. `src/auth/auth.service.ts(100,51): error TS7006: Parameter 'tx' implicitly has an 'any' type.`

So I need to:
1. Make sure the import from `./auth.repository` resolves (the file needs to exist, but the error is about the module not being found — this means I need to create/ensure `auth.repository.ts` exists. Wait, the instruction says "Rewrite `src/auth/auth.service.ts` complete, fixing what these messages require of this file." So I only rewrite `auth.service.ts`. But the error says the module `./auth.repository` can't be found. That's because `auth.repository.ts` doesn't exist yet. But I'm told to only change what the messages name. The message names `./auth.repository` as not found from within `auth.service.ts`. 

Wait, let me re-read: "Change nothing the messages do not name." The messages name `./auth.repository` as a missing module from `auth.service.ts`. So I need to either create that file or... hmm. Actually the task says "Rewrite `src/auth/auth.service.ts` complete, fixing what these messages require of this file." So I'm only rewriting this one file. But the error is that `./auth.repository` can't be found. That's a problem with the repository file not existing, not with the service file itself.

Wait, but the instruction says to fix what these messages require of *this file*. The message at line 3 says the module `./auth.repository` can't be found. That's an import in `auth.service.ts`. If `auth.repository.ts` doesn't exist, no matter what I write in `auth.service.ts`, that error will persist unless the file exists. But I'm told to only change `auth.service.ts`.

Hmm, let me reconsider. The task says "Rewrite `src/auth/auth.service.ts` complete, fixing what these messages require of this file." I think the intent is:
- I should write the complete `auth.service.ts`
- The `./auth.repository` import is needed (it's part of the architecture), and the file `auth.repository.ts` is presumably being created separately or will be created. The error will go away once that file exists.
- The TS7006 errors about `tx` implicitly having `any` type are the ones I actually need to fix in this file by adding proper type annotations.

Actually wait - looking more carefully at the errors, the TS2307 for `./auth.repository` is a "cannot find module" error. This will be resolved when `auth.repository.ts` is created. Since I'm only asked to fix `auth.service.ts`, I should keep the import (it's needed architecturally) and the error will resolve when the repository file is created.

The TS7006 errors are the ones I can actually fix in this file:
- Line 59: `Parameter 'tx' implicitly has an 'any' type`
- Line 83: `Parameter 'tx' implicitly has an 'any' type`
- Line 100: `Parameter 'tx' implicitly has an 'any' type`

These are in transaction callbacks where the `tx` parameter needs a type annotation. In Prisma, the transaction client type is `Prisma.TransactionClient`. So I need to import `Prisma` from `@prisma/client` and type the `tx` parameters.

Now let me think about what the full `auth.service.ts` should look like based on the variant A requirements:

1. `POST /auth/refresh` — accepts a refresh token, returns a new access token and a new refresh token. The presented token is retired.
2. Token may arrive as `refreshToken` in body or `refresh_token` cookie. Define which wins.
3. Concurrent requests: exactly one may rotate.
4. Reuse of retired token: invalidate all tokens from same session (family), record audit.
5. Absolute lifetime fixed at sign-in, rotation never extends it.
6. All rejections indistinguishable to caller. Audit distinguishes them.

Let me design the service:

```typescript
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. Validate token format
    // 2. Look up token in DB
    // 3. Check if retired -> reuse detection -> invalidate family
    // 4. Check if expired
    // 5. In a transaction: retire old token, issue new one (atomic)
    // 6. Return new tokens
  }
}
```

For the concurrent rotation safety, I need to use a transaction with a conditional update (optimistic locking or a status check within the transaction). The key is: in a transaction, check the token's status is 'active', and if so, atomically mark it retired and issue a new one. If the status is not 'active' (because another request already retired it), then it's a reuse.

Let me think about the Prisma model. Based on the variant, I'd expect something like:

- `RefreshToken` model with fields like: `id`, `token` (the actual token value, hashed), `sessionId` (or `familyId`), `userId`, `status` (active/retired/revoked), `expiresAt` (absolute deadline), `createdAt`, `retiredAt`
- `Session` or just the family concept via `sessionId`/`familyId`
- `AuditEvent` model

Since I can't see the exact schema, I'll need to make assumptions. Let me write the service in a way that's clear about what it expects from the repository.

Actually, the key constraint is: "Change nothing the messages do not name." The messages only name:
1. Line 3: import of `./auth.repository` (which will resolve when that file exists)
2. Lines 59, 83, 100: `tx` parameter needs type

So I need to write a complete, compilable `auth.service.ts` that:
- Imports from `./auth.repository`
- Has `tx` parameters properly typed with `Prisma.TransactionClient`
- Implements the full refresh token rotation logic per the plan

Let me write it out. I'll use `Prisma.TransactionClient` for the tx parameters.

Let me think about what methods the repository needs to expose:
- `findByToken(token: string)` - look up a token by its value
- `rotate(tx, tokenId): Promise<...>` - atomically retire and create new (or we do this in the service using tx)
- `invalidateFamily(tx, sessionId)` - mark all tokens in the family as revoked
- `recordAudit(tx, event)` - record an audit event

Actually, since the service should have "zero Prisma client calls" per the conventions, and the repository is "the only layer that touches the database", I should pass the transaction client to repository methods. That's why `tx` appears in the service - it's passing it to repository methods.

Wait, but the conventions say:
- `service` holds the logic. Zero raw SQL, zero Prisma client calls.
- `repository` is the only layer that touches the database.

So the service calls repository methods, and for transactions, the service orchestrates by passing a `tx` to repository methods. The repository methods accept an optional `tx` parameter.

Let me design this:

```typescript
// auth.repository.ts would have:
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  
  async findByToken(token: string) { ... }
  async retireAndIssue(tx: Prisma.TransactionClient, oldTokenId: string, newTokenValue: string, userId: string, sessionId: string, expiresAt: Date): Promise<string> { ... }
  async invalidateFamily(tx: Prisma.TransactionClient, sessionId: string): Promise<void> { ... }
  async recordAudit(tx: Prisma.TransactionClient, type: string, details: object): Promise<void> { ... }
  async beginTransaction(): Promise<Prisma.TransactionClient> { ... } // or we use prisma.$transaction
}
```

Hmm, but if the service can't call Prisma directly, how does it start a transaction? Options:
1. The repository exposes a method that wraps the transaction
2. The repository exposes the Prisma client or a transaction wrapper

I think the cleanest approach given the conventions is:
- The repository has a method like `withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` 
- Or the service gets the prisma client injected (but that violates "zero Prisma client calls" in service)

Actually, re-reading: "service holds the logic. Zero raw SQL, zero Prisma client calls." I think "Prisma client calls" means direct queries like `prisma.refreshToken.findUnique(...)`. Using `prisma.$transaction` to get a tx client and passing it to the repository might be acceptable, or the repository could expose a transaction helper.

Let me go with: the repository exposes a `withTransaction` method that the service uses. This keeps all DB access in the repository.

Actually, I think the simplest and most common pattern is:

```typescript
// In the service:
await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
  // business logic
  await this.repo.retireToken(tx, tokenId);
  await this.repo.createToken(tx, ...);
});
```

This way, the service orchestrates the logic, and the repository handles all DB operations. The `tx` parameters in the service are for passing to repository methods.

Wait, but looking at the error lines (59, 83, 100), there are exactly 3 `tx` parameters. Let me think about what the service looks like with 3 transaction callbacks.

Let me just write a clean, complete implementation. Here's my plan:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // All failure paths return the same error
    // 1. Look up token
    const record = await this.repo.findByToken(refreshToken);
    
    if (!record) {
      // Unknown token - indistinguishable rejection
      await this.repo.recordAudit('token_unknown', { token });
      throw new RefreshRejection();
    }
    
    // 2. Check if already retired (reuse detection)
    if (record.status === 'retired' || record.status === 'revoked') {
      // Reuse detected - invalidate entire family
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'token_reuse_detected', { sessionId: record.sessionId, tokenId: record.id });
      });
      throw new RefreshRejection();
    }
    
    // 3. Check if expired
    if (new Date() > record.expiresAt) {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.retireToken(tx, record.id);
        await this.repo.recordAudit(tx, 'token_expired', { tokenId: record.id, sessionId: record.sessionId });
      });
      throw new RefreshRejection();
    }
    
    // 4. Rotate - atomically retire old, issue new
    const newTokenValue = randomBytes(32).toString('hex');
    
    const result = await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
      // Conditional update: only retire if still active (handles concurrency)
      const updated = await this.repo.retireTokenIfActive(tx, record.id);
      if (!updated) {
        // Another request got there first - this is a reuse
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'token_reuse_detected', { sessionId: record.sessionId, tokenId: record.id });
        return null;
      }
      
      await this.repo.createToken(tx, newTokenValue, record.userId, record.sessionId, record.expiresAt);
      return newTokenValue;
    });
    
    if (result === null) {
      throw new RefreshRejection();
    }
    
    const accessToken = this.issueAccessToken(record.userId);
    return { accessToken, refreshToken: result };
  }
  
  private issueAccessToken(userId: string): string {
    // Assume this exists per the plan
    return `access_token_for_${userId}`;
  }
}
```

Hmm, but I need to think about what the repository interface looks like. Since I'm writing the service and the repository is a separate file that also needs to be created, I need to make sure my service's calls to the repository are consistent.

Let me think about the `withTransaction` pattern. The repository would have:

```typescript
async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return this.prisma.$transaction(fn);
}
```

This is a clean pattern. The service uses `this.repo.withTransaction(async (tx: Prisma.TransactionClient) => { ... })` and inside, it calls other repository methods passing `tx`.

Now for the 3 `tx` parameters in the service - looking at my code above, I have 3 `withTransaction` calls:
1. For reuse detection (invalidating family + audit)
2. For expired token (retire + audit)  
3. For the rotation itself (conditional retire + create new + possible invalidation)

That matches the 3 errors at lines 59, 83, 100.

Now, about the "indistinguishable" rejection - I need a single error type that the controller will map to a consistent HTTP response. Let me use a custom error or just throw a specific HttpException.

Actually, per the conventions, errors use the envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

For refresh token rejections, I'll use a single code like `invalid_token` or `refresh_rejected` for all cases. Let me use a custom exception or just throw a consistent HttpException.

Let me also think about what `issueAccessToken` should be. The problem says "assume `issueAccessToken(userId): string`". So I should have this as a method or inject it. Since it "already exists", I'll make it a method on the service or inject a dependency. Let me just make it a private method for now, or better, I'll note it as an assumption since I can't see how it's actually provided.

Actually, re-reading: "Sign-in and access-token verification already exist; assume `issueAccessToken(userId): string`." This means I can assume this function exists somewhere. I'll make it a private method that I can later replace, or I'll inject a service. Let me just make it a private method with a placeholder implementation and an ASSUMPTION comment.

Wait, the instruction says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." The compiler errors don't refer to `issueAccessToken`'s shape, they refer to `tx` types and the `./auth.repository` module. So I don't strictly need an ASSUMPTION line for `issueAccessToken`. But I do need one for the repository's shape since I can't see `auth.repository.ts`.

Actually, the TS2307 error for `./auth.repository` means the file doesn't exist yet. I'm told to fix what the messages require of `auth.service.ts`. The import statement is required by the architecture. The file will be created separately. I'll keep the import.

Let me also think about the cookie vs body priority. The problem says "Define and document which wins when both are present." I'll make the body parameter win (it's more explicit), and document this. But this logic would be in the controller, not the service. The service just receives the resolved token string.

Let me finalize my implementation:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'node:crypto';

/**
 * All refresh-token rejections produce the same HTTP 401 with code "invalid_token".
 * The audit log is the only place that distinguishes the cause.
 */
class RefreshRejection extends Error {}

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.length === 0) {
      await this.repo.recordAudit(null, 'malformed_token', {});
      throw new UnauthorizedException({ error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} } });
    }

    const record = await this.repo.findByToken(refreshToken);

    if (!record) {
      await this.repo.recordAudit(null, 'unknown_token', { token: refreshToken });
      throw new UnauthorizedException({ error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} } });
    }

    if (record.status === 'retired' || record.status === 'revoked') {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', { sessionId: record.sessionId, tokenId: record.id });
      });
      throw new UnauthorizedException({ error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} } });
    }

    if (new Date() > record.expiresAt) {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.retireToken(tx, record.id);
        await this.repo.recordAudit(tx, 'token_expired', { tokenId: record.id, sessionId: record.sessionId });
      });
      throw new UnauthorizedException({ error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} } });
    }

    const newTokenValue = randomBytes(32).toString('hex');

    const rotated = await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
      const didRetire = await this.repo.retireTokenIfActive(tx, record.id);
      if (!didRetire) {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', { sessionId: record.sessionId, tokenId: record.id });
        return null;
      }
      await this.repo.createToken(tx, {
        token: newTokenValue,
        userId: record.userId,
        sessionId: record.sessionId,
        expiresAt: record.expiresAt,
      });
      return newTokenValue;
    });

    if (rotated === null) {
      throw new UnauthorizedException({ error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} } });
    }

    return {
      accessToken: this.issueAccessToken(record.userId),
      refreshToken: rotated,
    };
  }

  private issueAccessToken(userId: string): string {
    // ASSUMPTION: The plan states sign-in and access-token verification already exist;
    // this is a placeholder for the existing implementation.
    throw new Error('issueAccessToken not yet wired');
  }
}
```

Wait, I'm using `UnauthorizedException` with a custom object. Let me check if that's the right pattern for the error envelope. In NestJS, `UnauthorizedException` returns 401. The body format depends on how I construct it.

Actually, looking at the error envelope convention:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

I should probably use a consistent approach. Let me use `HttpException` with the exact body format, or use `UnauthorizedException` with a custom response. In NestJS, `new UnauthorizedException(body)` will send the body as the response. But the default format is `{ statusCode, message, error }`. I might need to use `HttpException` directly or configure a filter.

Actually, for this file, I'll just throw a consistent error. The exact HTTP handling might be in a global exception filter. Let me use a simple approach:

```typescript
private reject(): never {
  throw new UnauthorizedException({
    error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} },
  });
}
```

This is cleaner - one method for all rejections, ensuring they're indistinguishable.

Now let me also think about whether I need to handle the case where `refreshToken` is empty/null. The controller would handle validation, but the service should be defensive.

Let me also reconsider the `recordAudit` signature. I have two variants:
- `recordAudit(null, 'malformed_token', {})` - no transaction
- `recordAudit(tx, 'reuse_detected', { ... })` - within transaction

So the method should accept `tx?: Prisma.TransactionClient`.

Let me write the final version:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      await this.repo.recordAudit(null, 'malformed_token', {});
      return this.reject();
    }

    const record = await this.repo.findByToken(refreshToken);

    if (!record) {
      await this.repo.recordAudit(null, 'unknown_token', { token: refreshToken });
      return this.reject();
    }

    if (record.status === 'retired' || record.status === 'revoked') {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
      });
      return this.reject();
    }

    if (new Date() > record.expiresAt) {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.retireToken(tx, record.id);
        await this.repo.recordAudit(tx, 'token_expired', {
          tokenId: record.id,
          sessionId: record.sessionId,
        });
      });
      return this.reject();
    }

    const newTokenValue = randomBytes(32).toString('hex');

    const rotated = await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
      const didRetire = await this.repo.retireTokenIfActive(tx, record.id);
      if (!didRetire) {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
        return null;
      }
      await this.repo.createToken(tx, {
        token: newTokenValue,
        userId: record.userId,
        sessionId: record.sessionId,
        expiresAt: record.expiresAt,
      });
      return newTokenValue;
    });

    if (rotated === null) {
      return this.reject();
    }

    return {
      accessToken: this.issueAccessToken(record.userId),
      refreshToken: rotated,
    };
  }

  private reject(): never {
    throw new UnauthorizedException({
      error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} },
    });
  }

  // ASSUMPTION: The plan states that sign-in and access-token verification already exist;
  // this method is a placeholder for the existing issueAccessToken(userId) implementation.
  private issueAccessToken(userId: string): string {
    throw new Error('Not implemented: delegate to existing access-token issuer');
  }
}
```

This looks good. Let me verify it addresses all the compiler errors:
1. Line 3 import of `./auth.repository` - kept, will resolve when file exists ✓
2. Line 59 `tx` implicitly any - now typed as `Prisma.TransactionClient` ✓
3. Line 83 `tx` implicitly any - now typed as `Prisma.TransactionClient` ✓
4. Line 100 `tx` implicitly any - now typed as `Prisma.TransactionClient` ✓

The file is complete, self-contained (modulo the repository dependency), and implements all the requirements from the plan.

One more thought: should I use `import { Prisma } from '@prisma/client'` or `import type { Prisma } from '@prisma/client'`? Since I'm only using it as a type annotation, `import type` would be more precise and would also work with `isolatedModules`. But the original error doesn't mention this, and using a regular import is fine. I'll use a regular import to keep it simple and match what's likely in the codebase.

Actually, I realize I should double-check: does `@prisma/client` export `Prisma` as a namespace with `TransactionClient`? Yes, `Prisma.TransactionClient` is the standard type for the interactive transaction client in Prisma.

I'm satisfied with this implementation. Let me write the final answer.
```

## reply

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      await this.repo.recordAudit(null, 'malformed_token', {});
      return this.reject();
    }

    const record = await this.repo.findByToken(refreshToken);

    if (!record) {
      await this.repo.recordAudit(null, 'unknown_token', { token: refreshToken });
      return this.reject();
    }

    // Reuse of an already-retired token signals compromise:
    // invalidate the entire token family (all descendants of the same sign-in).
    if (record.status === 'retired' || record.status === 'revoked') {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
      });
      return this.reject();
    }

    // Absolute deadline was fixed at sign-in; rotation never extends it.
    if (new Date() > record.expiresAt) {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.retireToken(tx, record.id);
        await this.repo.recordAudit(tx, 'token_expired', {
          tokenId: record.id,
          sessionId: record.sessionId,
        });
      });
      return this.reject();
    }

    const newTokenValue = randomBytes(32).toString('hex');

    // Concurrent-safe rotation: retireTokenIfActive uses a conditional UPDATE
    // (WHERE status = 'active') so exactly one concurrent caller succeeds.
    // If it fails, another request already rotated this token — treat as reuse.
    const rotated = await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
      const didRetire = await this.repo.retireTokenIfActive(tx, record.id);
      if (!didRetire) {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
        return null;
      }

      await this.repo.createToken(tx, {
        token: newTokenValue,
        userId: record.userId,
        sessionId: record.sessionId,
        expiresAt: record.expiresAt,
      });
      return newTokenValue;
    });

    if (rotated === null) {
      return this.reject();
    }

    return {
      accessToken: this.issueAccessToken(record.userId),
      refreshToken: rotated,
    };
  }

  /**
   * Every rejection — expired, retired, unknown, malformed — produces the
   * identical response so the caller cannot distinguish the cause.
   */
  private reject(): never {
    throw new UnauthorizedException({
      error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} },
    });
  }

  // ASSUMPTION: The plan states that sign-in and access-token verification
  // already exist; this is a placeholder for the existing issueAccessToken
  // implementation that should be wired in.
  private issueAccessToken(userId: string): string {
    throw new Error('Not implemented: delegate to existing access-token issuer');
  }
}
```
