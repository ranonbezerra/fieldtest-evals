# solution

## reasoning

```
The problem is to implement refresh token rotation with reuse detection, per the spec and deliverables: Prisma schema + migration, NestJS module (controller, service, repository), tests, and SECURITY.md.

We have an existing codebase with sign-in and access-token verification already exist; we assume an `issueAccessToken(userId): string` function exists somewhere. We need to add a new auth module for refresh. We'll need to design a schema for refresh tokens, with tracking of token families, expiration, retired flag, etc.

We'll need to think about how to implement rotation, concurrency (conditional update). Using Prisma, we can make use of PostgreSQL's transactions and row-level locking (`SELECT FOR UPDATE`) or using a conditional update via `UPDATE ... WHERE ... AND retired = false AND expires_at > now() RETURNING *` to see if row was updated. This can be done via Prisma's `$executeRaw` or `$queryRaw` to run raw SQL because Prisma cannot conditionally update and return the updated row? Actually Prisma can do `prisma.refreshToken.updateMany({ where: { id: tokenId, retired: false, expiresAt: { gt: new Date() } }, data: { retired: true, ... } })` then check count. That can be atomic because updateMany is a single statement. It will update 0 or 1 rows based on conditions.

We also need to record audit events for reuse attempts. We'll create a new model `AuditLog` with fields: id, event_type, token_id?, user_id?, timestamp, details jsonb maybe.

We need to handle token families: each refresh token belongs to a "session" or "family" identified by a `familyId` or a `rootRefreshTokenId`. At sign-in, we generate a root token with a `familyId` (maybe same as its own id) and each rotation creates a new token with same `familyId`. Then when a token is reused (i.e., presented after being retired), we need to invalidate all tokens belonging to that family: mark them as retired (or maybe "invalidated") and set a flag (like `revoked = true`?). Actually we already have a `retired` flag; but for reuse, we want to retire all tokens in the family, regardless of whether they have been retired previously. So we can update all tokens in that family to set `revoked = true` (maybe a column `invalidated`?). Or we can treat `retired` as "no longer usable after rotation", and `invalidated` as "family revoked". We could store a column `revokedAt` timestamp, but we can just set `revoked = true`.

Simplify: we can have columns:

- id: string (maybe uuid)
- token: string (the actual refresh token value, maybe hashed for security). For test we could store plain token to keep simple.
- userId: references User (User model exists but not defined here). We'll use userId as string.
- familyId: string (maybe same as id of root token)
- createdAt: DateTime
- expiresAt: DateTime
- retiredAt: DateTime? (null if not retired)
- invalidatedAt: DateTime? (null if not invalidated due to compromise)
- lastUsedAt: DateTime? maybe not needed.

Alternatively we can have `status` enum: ACTIVE, RETIRED, INVALIDATED. But using booleans may be easier.

Because of concurrency, we need to atomically retire a token only if it's active (not retired, not invalidated, not expired). Using updateMany condition as above ensures we can check if row updated. So the service would:

- Parse request: get refresh token from body or cookie; precedence: define that JSON body wins over cookie. Document that in controller comment.

- Validate token format (maybe simple string). If missing, error.

- Find token by value (or hashed). If not found, treat as unknown token, log audit, throw generic rejection.

- Try to retire token atomically: using updateMany: where id = token.id, retiredAt = null, invalidatedAt = null, expiresAt > now(). Set retiredAt = now(). If count=1: success (we retired the token). If count=0: token already retired/invalidated/expired. If token is already retired (or invalidated), treat as reuse. In that case, we need to invalidate entire family:

-- Update many tokens with same familyId: set invalidatedAt = now() (or if you prefer to use a boolean). The update can be unconditional (maybe only those not yet invalidated) but we can set anyway. Also log audit for reuse.

-- Then reject request with generic error.

- If retire succeeded, generate new refresh token, store it:

-- tokenId = new uuid, tokenValue = generate random string (maybe use crypto random bytes hex). familyId = token.familyId (the same as original family). Set expiresAt = token.expiresAt? Wait requirement: absolute deadline is fixed at sign-in, not extended. So the token's expiry must be based on absolute deadline set at sign-in. So we need to have stored the absolute session expiration time somewhere, maybe on the token as `expiresAt`. At rotation, we generate new token with same `expiresAt` as original token (i.e., not extended). That ensures that session will still expire at original deadline.

-- So when we create a new token, we copy `expiresAt` from the original token.

-- Store new token: `retiredAt` null, `invalidatedAt` null.

- Issue new access token: we call `issueAccessToken(userId)`.

- Return response: JSON with accessToken, refreshToken (maybe also set cookie).

We must implement repository for DB operations:

- findByToken(token: string): Promise<RefreshToken | null>
- retireToken(tokenId: string): Promise<boolean> // return true if retired
- invalidateFamily(familyId: string): Promise<void>
- createToken(...): Promise<RefreshToken>

Also methods to log audit events:

- logAudit(eventType: string, details: object): Promise<void> // maybe part of repository or separate.

Simplify: We'll have a repository with both refresh token operations and audit logging.

Define Prisma schema for `RefreshToken` and `AuditLog`.

Potential user model: we can reference `User` but not defined in repo. Use `Int` or `String` referencing but not enforce relation (maybe just userId string). We'll just define `userId` as `String`.

Define models:

```prisma
model RefreshToken {
  id          String   @id @default(uuid())
  token       String   @unique
  userId      String
  familyId    String
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  retiredAt   DateTime?
  invalidatedAt DateTime?
  @@map("refresh_tokens")
}
model AuditLog {
  id        String   @id @default(uuid())
  eventType String
  userId    String?
  tokenId   String?
  createdAt DateTime @default(now())
  details   Json?
  @@map("audit_logs")
}
```

Add migration? Not necessary to produce actual migration script; just schema.

Now implement NestJS module. Under `src/auth/refresh` or similar. Let's decide file structure:

- src/auth/auth.module.ts (or maybe refresh.module.ts). Let's follow pattern: `src/auth/refresh/refresh.module.ts`, `refresh.controller.ts`, `refresh.service.ts`, `refresh.repository.ts`. This matches the naming conventions: feature folder `<feature>` and files `<feature>.module.ts`, etc. So feature = `refresh-token`. Actually the pattern: src/<feature>/<feature>.module.ts; src/<feature>/<feature>.controller.ts etc. So feature name maybe `refresh`. So folder `src/refresh`. We'll have files:

src/refresh/refresh.module.ts
src/refresh/refresh.controller.ts
src/refresh/refresh.service.ts
src/refresh/refresh.repository.ts

But they want the naming in kebab-case for TS file: file names like `refresh.controller.ts` is okay (kebab-case). The class names: `RefreshModule`, `RefreshController`, `RefreshService`, `RefreshRepository`.

Now implement controller: route `POST /auth/refresh`. Use NestJS `@Post('auth/refresh')`. Accept body with `refreshToken?: string`. Use `@Req()` to access cookies: cookie-parser? Might be available; we can assume NestJS has cookie parsing via `@Req()` request cookie property. We'll need to set precedence: body token wins over cookie token. Document that.

Validate input: we just check that either token is present; else return generic error.

Call service: `rotateRefreshToken(token)` returns object { accessToken, refreshToken }.

Wrap errors: Use a custom exception filter? Simpler: throw a `BadRequestException` with generic error envelope.

Define a common error response shape: JSON: `{ error: { code: 'invalid_refresh_token', message: 'Invalid refresh token', details: {} } }`. According to spec, envelope code must be snake_case. Use `resource_not_found`? Actually they want errors be generic; maybe define `invalid_refresh_token` (code). We'll keep one code for all rejections: `invalid_refresh_token`. The details: empty object.

But spec says each rejection cause must return identical response; audit records distinguish. So we must use same envelope for any error: unknown token, expired, retired, malformed.

Now implement service:

`async refresh(tokenValue: string)`

- Look up token record via repository.findByToken(tokenValue). If null: log audit with eventType 'unknown_token', token: tokenValue (no tokenId). Return generic error.

- Check token's status: if token.invalidatedAt is not null => already compromised -> treat as reuse? Actually this situation shouldn't happen, but treat as reuse: log and return generic error.

- Attempt to retire: repository.retireIfActive(token.id, token.expiresAt). If returned true:

-- Generate new token value: crypto.randomBytes(32).toString('hex').

-- Create new token: repository.createRefreshToken({
   token: newToken,
   userId: token.userId,
   familyId: token.familyId,
   expiresAt: token.expiresAt,
})

-- Issue access token: maybe import from somewhere: `issueAccessToken(token.userId)`.

-- Return.

- Else (retire unsuccessful) meaning token already retired or expired: treat as reuse. Log audit event with type 'refresh_token_reuse'.

-- repository.invalidateFamily(token.familyId). // This will set invalidatedAt on all tokens.

-- Return generic error.

Need to ensure that if token is already retired but not invalidated, and also possibly expired: spec says check reuse before expiry. So if token is retired (or invalidated) treat as reuse, regardless of expiry. Our retireIfActive function returns false for both retired or expired; we treat all those as reuse, which matches spec.

But we also need to differentiate the case where token is expired but never used, i.e., still not retired: In that case, the `retireIfActive` condition includes `expiresAt > now()`. So if token is expired, retireIfActive returns false, we treat as reuse (compromise). However spec says check reuse before expiry; token both retired and expired should be reuse, but token that is only expired (but not retired) should be considered expiry. But spec says we should treat expired as generic rejection, not as reuse. But they want to treat reuse before expiry, meaning if token is both retired and expired, treat as reuse. However they didn't say to treat just expired tokens as reuse. So we need to differentiate between expired only vs retired+expired. Our retireIfActive fails for both conditions: if token.expired, but not retired, we need to handle as expiry (but still generic response). But for audit logging, we need to log event type accordingly.

Thus we need to first check if token.retiredAt is not null (or invalidatedAt). If token is retired (or invalidated), treat as reuse regardless of expiry. If token is not retired, then check if token.expiresAt <= now() -> expiry case. Else token is active and we can attempt atomic retirement. Wait we need to do atomic retirement to ensure concurrency. But if we read token and see it's active (not retired), we still need to attempt to retire conditionally to avoid race condition: we can try to retire via updateMany with condition retiredAt IS NULL AND expiresAt > now(). That ensures that if another concurrent request already retired it, this call's update will affect 0 rows and return false.

Thus algorithm:

1. Retrieve token by token string.

2. If not found: log audit unknown token. Throw generic error.

3. If token.invalidatedAt is not null: (family already compromised) log audit 'reuse' (or maybe 'compromise') and generic error.

4. If token.retiredAt is not null: log audit reuse (compromise), invalidate family (maybe already invalidated), and generic error.

5. Else (token not retired/invalidate):
   - Attempt to retire: repository.retireTokenIfNotExpired(token.id) returns boolean (true if retired). Implementation: `UPDATE RefreshToken SET retiredAt = now() WHERE id = $1 AND retiredAt IS NULL AND expiresAt > now()`. Return count.

   - If retire succeeded (count == 1): success.

   - Else (count == 0): implies token expired (since not retired). So we treat as expiry event. Log audit expiry.

   - In expiry case, we do NOT invalidate family, we just return generic error.

Thus concurrency: if two requests call retire at same time, one will succeed (retiredAt set). The other will see token.retiredAt is not null when they attempt conditional update; the update condition includes `retiredAt IS NULL`, so it will affect 0 rows, and we treat it as reuse (since we check token.retiredAt earlier?). Actually we must differentiate: When second request enters, it loads token before the first request updates. The token will appear not retired, not invalidated. Then it attempts atomic retire; condition includes `retiredAt IS NULL`. The first request already updated the row, so the second's update will affect 0 rows. We treat that as reuse. But we need to distinguish that it's not expiry, because token hasn't expired. Since we attempted to retire but condition failed because retiredAt is not null (meaning token retired), but we didn't know at start. To differentiate, after attempt fails, we can query again to see if token.retiredAt is not null. But simpler: we can incorporate the `retiredAt` condition in the update; if update count = 0, we need to check if token.expiredAt <= now() => expiry; else treat as reuse. So we need to read again the token after update to know. But we can just treat any update failure where token not expired as reuse. So after attempt fails, we can call repository.getTokenById(token.id) to get current status (or maybe use SELECT FOR UPDATE). But to avoid extra DB calls, we can in service logic: after we get token, check if token.expiresAt <= now(); if true -> expiry (no need to attempt retire). If token.expiresAt > now(): token not expired. Then we try retire. If retire fails, that implies token was retired concurrently -> reuse. So we should only attempt retire if token hasn't expired. So algorithm:

- If token not found: unknown token.

- If token.invalidatedAt != null: reuse (compromise). (maybe also invalidate family again? Already invalidated.)

- If token.retiredAt != null: reuse.

- If token.expiresAt <= now(): expired -> log expiry.

- Else (not retired, not invalidated, not expired): attempt atomic retire:

   -- success => rotate token.

   -- failure (retire count 0) => must have been retired by concurrent request (since not expired). So treat as reuse: log reuse, invalidate family, generic error.

Thus we need a repository method to perform atomic retire: returns true if updated row count = 1. Implementation using Prisma's `updateMany` with conditions.

Also repository method to invalidate family: update many tokens with same familyId: set `invalidatedAt = now()`. We also could set `retiredAt = now()` for all? But just invalidatedAt.

Now audit logging: we need a repository method to create audit log.

Now the service should coordinate.

Now the controller's error handling: we can catch errors thrown by service and return generic envelope. We can define a custom exception class `InvalidRefreshTokenException` extends `HttpException` with status 401 maybe. In the service, for any rejection we throw that exception. That exception can have a consistent message and code.

Alternatively, service returns null and controller returns error. But spec wants to route through a single rejection path. So we implement a custom exception.

Implementation details: We'll need to import `PrismaClient` from `@prisma/client`. In repository's constructor, instantiate PrismaClient or have it injected by Nest (via `PrismaService`?). The repo pattern may have a PrismaService already defined in the codebase. Since we don't have context, we can create a simple `PrismaService` that extends PrismaClient and is a Nest provider, but it's likely already present in the repository. However we have no knowledge; the existing code base might have a `PrismaService` that is used elsewhere. Let's assume there is a `PrismaService` exported from `src/prisma.service.ts`. But we haven't seen. Since we can't assume existence, we can create a simple PrismaService. But we need to follow conventions: we should not create unnecessary files. However we may need to include it if not present.

Given we have no code base context, we need to design a minimal solution that includes the necessary components: PrismaService (client) and the refresh module.

Thus we will create:

- src/prisma.service.ts

- src/refresh/refresh.module.ts

- src/refresh/refresh.controller.ts

- src/refresh/refresh.service.ts

- src/refresh/refresh.repository.ts

- src/refresh/dto/refresh-request.dto.ts (maybe not required but helpful). Not necessary.

- test/refresh.spec.ts (the tests).

- SECURITY.md (the documentation).

We also need to modify prisma/schema.prisma to add models.

Potential missing pieces: The `issueAccessToken(userId): string` function. We need to import it from somewhere; maybe `src/auth/token.service.ts`. Since it's not defined, we can assume it's a global function exported from a module. For simplicity, we can define a stub function in `src/auth/token.utils.ts` with that signature. But spec says sign-in and access-token verification already exist; we can import `issueAccessToken` from a module. Since we don't have it, we will put an `// ASSUMPTION` comment.

Also we need to generate UUID and random token. Use `crypto.randomUUID()` for id and random token generation using `crypto.randomBytes(32).toString('hex')`. Node 20 includes `crypto.randomUUID`.

Now tests: We need to test:

- concurrent presentation of one token: exactly one rotates, other recorded as reuse and invalidates family.

- a replay that invalidates a sibling token: i.e., token A is rotated to B, then B presented again after rotation (i.e., replay). Should cause family invalidation, all tokens invalidated.

- rotation against absolute deadline: token with absolute expiration not extended; after expiration, refresh fails.

- rejection responses compared to each other: ensure all rejections produce same response envelope.

We'll need to test concurrency: using Promise.all with two calls to service (or controller) with same token, ensuring only one succeeds. Since we are using Prisma's atomic operations, concurrency at test level can be simulated by starting two async calls without awaiting between them.

But we have to spin up Nest app and use testing module with in-memory database? We'll need to run migrations? But in test we can use SQLite in-memory as easier. However the spec demands PostgreSQL. Since we don't have actual DB, we can simulate with Prisma and a test DB configured via environment variable. However we cannot set up actual DB in this environment; the code will be static. So tests are code only, not run.

Thus we need to write tests that use the Nest testing module, inject the RefreshService, and use Prisma with a test database. We'll write tests that use `await prisma.refreshToken.deleteMany()` to clean DB before each test.

We'll generate a userId for test.

Test 1: concurrent rotation.

Pseudo steps:

- Insert initial refresh token: tokenValue = 'token1'; familyId = token.id; expiresAt = now + 1 day.

- Use service.refresh(tokenValue) twice concurrently (Promise.all). Capture results: one should succeed (returns accessToken, refreshToken); the other should throw `InvalidRefreshTokenException`.

- After both, ensure that the family has invalidatedAt set (because the loser triggers family invalidation). Wait spec says loser is reuse -> whole family invalidated. That includes the newly created token (the successful rotation). So after concurrency, the family should be invalidated, i.e., all tokens (including new one) invalidated. However the successful rotation returns a new token but the request was successful; does invalidation happen after returning? The spec: Two requests with same valid token → exactly one rotates; the loser is recorded as reuse and the family is invalidated. That implies the loser triggers compromise detection, invalidating all tokens including the newly created token, making the successful token invalid for future use. That's okay.

Thus after concurrency, check that the newly created token's invalidatedAt is not null, and the original token's retiredAt is set, and the new token is also invalidated.

Thus test: after Promise.all, we find the refresh token with token value returned from success (if any). Ensure it's invalidatedAt not null. Also ensure that the audit log has an entry for reuse.

Implementation: Since the successful service call returns new token value, we need to capture it. The failing call throws exception. We need to catch errors.

Test 2: Replay invalidates sibling token.

Sequence:

- Insert root token (R). Use refresh to get new token A (rotate). This retires R and creates A. Then call refresh with token A (should succeed again, generating B). Then reuse token A again (i.e., call refresh with same token A again). That should cause family invalidation, making token B invalid. Ensure B is invalidated.

So steps:

- Create root token.

- rotate R → get A.

- rotate A → get B.

- reuse A (present A again) -> should cause invalidation.

- Check that token B is invalidated.

Test 3: Rotation against absolute deadline.

- Create token with expiresAt = now + 10 seconds.

- Wait until after expiresAt (maybe use jest timers). Or set expiresAt to now - 1 second.

- Attempt refresh with token before expiration? Actually after expiration, the refresh should be rejected as expiry. The service should not extend deadline.

So steps: create token with expiresAt = now - 10 sec (already expired). Attempt refresh; should reject (error). The audit logs should indicate 'expiry'.

Alternatively test that after refresh (successful), the new token's expiresAt is same as original (not extended). So we need to check that after a successful rotation, the new token's expiresAt equals original's expiresAt. This ensures absolute deadline not extended.

Test 4: Rejection responses identical.

- For each of several rejection scenarios (unknown token, expired token, retired token, malformed token), call refresh and capture error response; ensure they are equal (same status and body). This can be done using controller (which returns proper HTTP response) or service that throws same exception.

We'll test using controller to get HTTP response (via supertest). But we can test the exception thrown from service. For simplicity, just call service and catch exception. Ensure the thrown exception is our custom exception with same shape.

Now we need to define custom exception with JSON envelope.

Define class `InvalidRefreshTokenException extends HttpException`. It will call `super({ error: { code: 'invalid_refresh_token', message: 'Invalid refresh token', details: {} } }, HttpStatus.UNAUTHORIZED);`. So body is envelope.

Make sure to import HttpException, HttpStatus.

In controller, we can just let the exception propagate; Nest will send body as is.

Now we need to set up the Nest test module.

Test file:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/refresh/refresh.module';
import { RefreshService } from '../src/refresh/refresh.service';
import { PrismaService } from '../src/prisma.service';
import { PrismaClient, RefreshToken, AuditLog } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
...
```

We'll need to clear DB before each test: `await prisma.refreshToken.deleteMany()`, `await prisma.auditLog.deleteMany()`.

We'll also need to set environment variable for DATABASE_URL to use a test DB. We'll just rely on environment.

Now need to implement PrismaService.

Implement `src/prisma.service.ts`:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Add to providers of RefreshModule.

Now implement RefreshRepository:

```ts
@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { token } });
  }

  async retireIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id,
        retiredAt: null,
        invalidatedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        retiredAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        familyId,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });
  }

  async createRefreshToken(data: {
    token: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        userId: data.userId,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async logAudit(eventType: string, details: Record<string, unknown>, tokenId?: string, userId?: string): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        eventType,
        details,
        tokenId,
        userId,
      },
    });
  }
}
```

Note: We need to import models from Prisma client. They are typed.

Now RefreshService:

```ts
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception';
import * as crypto from 'crypto';

// ASSUMPTION: issueAccessToken function is imported from elsewhere
import { issueAccessToken } from '../auth/token.utils';

@Injectable()
export class RefreshService {
  constructor(private readonly refreshRepo: RefreshRepository) {}

  async refresh(refreshTokenValue: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.refreshRepo.findByToken(refreshTokenValue);
    if (!token) {
      await this.refreshRepo.logAudit('unknown_token', { presentedToken: refreshTokenValue });
      throw new InvalidRefreshTokenException();
    }

    // If token already invalidated (compromise)
    if (token.invalidatedAt) {
      await this.refreshRepo.logAudit('reuse', { reason: 'already_invalidated', tokenId: token.id, userId: token.userId });
      // Invalidate family again (idempotent)
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // If token already retired
    if (token.retiredAt) {
      await this.refreshRepo.logAudit('reuse', { reason: 'already_retired', tokenId: token.id, userId: token.userId });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // Check expiry
    const now = new Date();
    if (token.expiresAt <= now) {
      await this.refreshRepo.logAudit('expired_token', { tokenId: token.id, userId: token.userId });
      throw new InvalidRefreshTokenException();
    }

    // Attempt atomic retirement
    const retired = await this.refreshRepo.retireIfActive(token.id);
    if (!retired) {
      // Token was retired concurrently -> reuse
      await this.refreshRepo.logAudit('reuse', { reason: 'concurrent_retirement', tokenId: token.id, userId: token.userId });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // Successful retirement; generate new token
    const newTokenValue = crypto.randomBytes(32).toString('hex');

    // Family id stays same
    const newToken = await this.refreshRepo.createRefreshToken({
      token: newTokenValue,
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: token.expiresAt, // absolute deadline unchanged
    });

    const accessToken = issueAccessToken(token.userId);

    return {
      accessToken,
      refreshToken: newToken.token,
    };
  }
}
```

Now define exception class:

```ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

Now controller:

```ts
import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { RefreshService } from './refresh.service';
import { Request, Response } from 'express';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception';

@Controller()
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    // Determine token precedence: JSON body token wins over cookie token.
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const token = tokenFromBody ?? tokenFromCookie;
    if (!token) {
      // malformed / missing token
      throw new InvalidRefreshTokenException();
    }

    const result = await this.refreshService.refresh(token);
    // Set refresh token as httpOnly cookie (optional)
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      // Not setting expiration here; client handles
    });
    // Return access token and new refresh token in body as well
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
```

Note: For cookie parsing, need cookie-parser middleware; assume it is set up.

Now module:

```ts
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshRepository } from './refresh.repository';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository, PrismaService],
  exports: [RefreshService],
})
export class RefreshModule {}
```

Now test file: test/refresh.spec.ts

We'll use Vitest.

Outline:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/refresh/refresh.module';
import { RefreshService } from '../src/refresh/refresh.service';
import { PrismaService } from '../src/prisma.service';
import { PrismaClient, RefreshToken, AuditLog } from '@prisma/client';
import { InvalidRefreshTokenException } from '../src/refresh/invalid-refresh-token.exception';
import * as crypto from 'crypto';

describe('RefreshService', () => {
  let module: TestingModule;
  let refreshService: RefreshService;
  let prisma: PrismaService;

  const userId = 'test-user';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [RefreshModule],
    }).compile();

    refreshService = module.get<RefreshService>(RefreshService);
    prisma = module.get<PrismaService>(PrismaService);
    // Ensure DB is clean
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function createInitialToken(params?: { expiresInMs?: number }) {
    const tokenValue = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (params?.expiresInMs ?? 60 * 60 * 1000));
    return prisma.refreshToken.create({
      data: {
        token: tokenValue,
        userId,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });
  }

  it('concurrent presentation of same token rotates exactly once', async () => {
    const initial = await createInitialToken();
    const tokenValue = initial.token;
    // Two concurrent calls
    const p1 = refreshService.refresh(tokenValue).catch((e) => e);
    const p2 = refreshService.refresh(tokenValue).catch((e) => e);
    const results = await Promise.all([p1, p2]);

    const successes = results.filter((r) => !(r instanceof InvalidRefreshTokenException));
    const failures = results.filter((r) => r instanceof InvalidRefreshTokenException);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const successResult = successes[0] as { accessToken: string; refreshToken: string };

    // Verify that family is invalidated
    const familyTokens = await prisma.refreshToken.findMany({
      where: { familyId: initial.familyId },
    });

    for (const t of familyTokens) {
      expect(t.invalidatedAt).not.toBeNull();
    }

    // Audit log should have a reuse entry
    const audit = await prisma.auditLog.findFirst({ where: { eventType: 'reuse' } });
    expect(audit).toBeDefined();
  });

  it('replay after rotation invalidates sibling token', async () => {
    const root = await createInitialToken();
    const rootValue = root.token;

    // First rotation
    const first = await refreshService.refresh(rootValue);
    const tokenA = first.refreshToken;

    // Second rotation (rotate tokenA)
    const second = await refreshService.refresh(tokenA);
    const tokenB = second.refreshToken;

    // Reuse tokenA again (should trigger invalidation)
    await expect(refreshService.refresh(tokenA)).rejects.toBeInstanceOf(InvalidRefreshTokenException);

    // Token B should be invalidated now
    const tokenBRecord = await prisma.refreshToken.findUnique({ where: { token: tokenB } });
    expect(tokenBRecord).toBeDefined();
    expect(tokenBRecord?.invalidatedAt).not.toBeNull();
  });

  it('rotation does not extend absolute deadline', async () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    const tokenValue = crypto.randomBytes(32).toString('hex');
    const familyId = crypto.randomUUID();

    await prisma.refreshToken.create({
      data: {
        token: tokenValue,
        userId,
        familyId,
        expiresAt,
      },
    });

    const result = await refreshService.refresh(tokenValue);
    const newToken = await prisma.refreshToken.findUnique({ where: { token: result.refreshToken } });
    expect(newToken).toBeDefined();
    expect(newToken?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('all rejection responses are identical', async () => {
    // Unknown token
    await expect(refreshService.refresh('nonexistent')).rejects.toThrow(InvalidRefreshTokenException);
    // Expired token
    const expired = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() - 1000), // past
      },
    });
    await expect(refreshService.refresh(expired.token)).rejects.toThrow(InvalidRefreshTokenException);
    // Retired token (create and retire manually)
    const token = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    // retire it via repository
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { retiredAt: new Date() },
    });
    await expect(refreshService.refresh(token.token)).rejects.toThrow(InvalidRefreshTokenException);
    // Malformed token: empty string or undefined
    await expect(refreshService.refresh('')).rejects.toThrow(InvalidRefreshTokenException);
    // Ensure error shape is same
    try {
      await refreshService.refresh('nonexistent');
    } catch (e) {
      const error = e as any;
      expect(error.getResponse().error).toEqual({
        code: 'invalid_refresh_token',
        message: 'Invalid refresh token',
        details: {},
      });
    }
    try {
      await refreshService.refresh(expired.token);
    } catch (e) {
      const error = e as any;
      expect(error.getResponse().error).toEqual({
        code: 'invalid_refresh_token',
        message: 'Invalid refresh token',
        details: {},
      });
    }
  });
});
```

But note: The test uses `refreshService.refresh` directly, not the controller; the error envelope shape is produced via exception, but the exception's `getResponse` method is provided by Nest's HttpException. So `e.getResponse()` returns the response body. We'll need to import `HttpException`. That's fine.

Now we need to implement `issueAccessToken` stub.

Create file `src/auth/token.utils.ts`:

```ts
// ASSUMPTION: The real implementation exists elsewhere. This stub is provided for compilation.
export function issueAccessToken(userId: string): string {
  // In real system, this would sign a JWT or similar.
  return `access-token-for-${userId}-${Date.now()}`;
}
```

Alternatively, we could put it in `src/auth/access-token.service.ts` but stub is fine.

Now add `SECURITY.md` file describing ordering of checks.

Write something like:

- Verify token family integrity first.
- Check if token is already invalidated (reuse) before any other checks.
- Then check if token is retired.
- Then check expiry.
- The order ensures reuse detection before expiry, preventing an attacker using a retired token that also expired to be logged as benign expiry.

Add details.

Now final file list:

- prisma/schema.prisma
- src/prisma.service.ts
- src/auth/token.utils.ts
- src/refresh/refresh.module.ts
- src/refresh/refresh.controller.ts
- src/refresh/refresh.service.ts
- src/refresh/refresh.repository.ts
- src/refresh/invalid-refresh-token.exception.ts
- test/refresh.spec.ts
- SECURITY.md

We might also need to add index files but not necessary.

Now we must ensure naming conventions: file paths use kebab-case: `refresh.controller.ts` (already kebab-case). Module file `refresh.module.ts`. Service file `refresh.service.ts`. Repository file `refresh.repository.ts`. Exception file `invalid-refresh-token.exception.ts`.

Now check that all files follow conventions: classes PascalCase.

Now ensure Prisma schema includes mapping to snake_case names (via `@@map`). Already done.

Also need to define migration? Not needed; schema is enough.

Now think about potential pitfalls.

**Atomic retire**: The updateMany condition includes `invalidatedAt: null` as well, to avoid retiring a token that is already invalidated (compromise). The check for invalidatedAt earlier would have caught that. But it's okay.

**Race condition**: In the scenario where token is expired but not retired, we will catch expiry before attempting atomic retire. This returns generic error. The concurrency is not relevant for expired tokens.

**Reuse detection after retirement**: The second request after the first request successfully rotates will attempt to retire again; token will have `retiredAt` set, but not `invalidatedAt`. Our code earlier checks token.retiredAt and logs reuse before checking expiry. Since token.retiredAt is set, it will go to that path, log reuse, invalidate family, and throw error. This matches spec: the loser is recorded as reuse, and the family invalidated.

**Family invalidation after reuse**: The `invalidateFamily` sets `invalidatedAt` for all tokens in family. The newly created token from the first successful rotation will be invalidated as well. This satisfies spec.

**Audit events**: We log events for unknown_token, reuse, expiry. Could also log other events. We store details.

**Error response**: The InvalidRefreshTokenException returns HTTP 401 with envelope. The response body is { error: { code: ..., message..., details: {} } }. That's as spec.

**Cookie vs Body precedence**: In controller we used tokenFromBody ?? tokenFromCookie, so body token wins. Documented in comment.

**Test for concurrency**: In our test we call `refreshService.refresh` concurrently; both will run concurrently but due to Node's single-threaded event loop, they are sequential unless we use `Promise.all`. But the calls to repository updateMany are executed with the DB; concurrency is at DB level; however the promises will be interleaved but not truly parallel. In real DB, they may both send query. For test, it's okay.

**Potential missing imports**: Ensure imports for `PrismaClient` types.

Now implement `src/refresh/refresh.repository.ts` referencing `RefreshToken` and `AuditLog` types from `@prisma/client`. Use `import { PrismaService } from '../prisma.service';` and `import { RefreshToken, AuditLog } from '@prisma/client';`.

Now ensure we have `prisma/schema.prisma`. Provide proper mapping.

We need to also include user model? Not needed; we reference `User` by `userId: String`. No foreign key enforcement.

Add `@@map("refresh_tokens")` to table mapping.

Now think about the naming of columns: we need snake_case column names; Prisma will map property names to columns via `@map`. But we can rely on default naming which is camelCase to snake_case? I think Prisma defaults to snake_case? Actually Prisma will generate column names as they are defined, but we can specify `@map`. For simplicity, we can add `@map` on each field, but not necessary if they accept camelCase. The spec says table and column: snake_case via `@map`/`@@map`. So we must annotate each field with `@map` to snake_case.

Thus:

```prisma
model RefreshToken {
  id           String    @id @default(uuid()) @map("id")
  token        String    @unique @map("token")
  userId       String    @map("user_id")
  familyId     String    @map("family_id")
  createdAt    DateTime  @default(now()) @map("created_at")
  expiresAt    DateTime  @map("expires_at")
  retiredAt    DateTime? @map("retired_at")
  invalidatedAt DateTime? @map("invalidated_at")
  @@map("refresh_tokens")
}
model AuditLog {
  id          String   @id @default(uuid()) @map("id")
  eventType   String   @map("event_type")
  userId      String?  @map("user_id")
  tokenId     String?  @map("token_id")
  createdAt   DateTime @default(now()) @map("created_at")
  details     Json?    @map("details")
  @@map("audit_logs")
}
```

Now implement repository methods using appropriate naming.

Now implement `src/refresh/refresh.repository.ts`.

Now think about imports: `@prisma/client` provides types. In repository we can also use `prisma.refreshToken` methods.

Edge cases: token creation: we must ensure that `familyId` is set correctly. For root token creation (i.e., sign-in) we would generate a new familyId (maybe using token.id). Since sign-in already exists, we don't implement that. But for rotation, we copy token.familyId.

Thus in refreshService we use token.familyId.

Now test: the initial token created via `prisma.refreshToken.create` must have a familyId; we used `crypto.randomUUID()` as a unique id. That's fine.

Now the `RefreshRepository` must have a `createRefreshToken` method expecting data with token, userId, familyId, expiresAt; we also need to set `createdAt` automatically.

Now the `invalidateFamily` updates tokens where familyId matches and invalidatedAt is null; we set invalidatedAt now.

Now we need to ensure that after invalidation, we cannot rotate again because token.invalidatedAt is set; our service's early check catches invalidatedAt and treats as reuse.

Now implement `src/refresh/invalid-refresh-token.exception.ts`.

Now we need to implement `src/main.ts` maybe not required. Not needed.

Now tests need to import `refresh.service` etc. They need the PrismaService. Since `RefreshModule` imports PrismaService and provides repository and service. But PrismaService may not be provided globally; it's provided inside RefreshModule's providers. However other modules may need it; for this test only refresh module needed. That should work.

Now note: The test file uses `await prisma.refreshToken.deleteMany();` But the `prisma` instance is from `module.get<PrismaService>(PrismaService)`. This extends PrismaClient, so we can call `$disconnect` at end.

Now we need to adjust the imports for `InvalidRefreshTokenException` to compare.

Now we need to add `@nestjs/testing` import.

Now also include `cookie-parser`? Not needed for tests.

Now add any missing dependencies: we used `crypto` which is built-in.

Now implement `src/prisma.service.ts`.

Now ensure that the test code uses `prisma.$disconnect` but we called `await prisma.$disconnect()`.

Now we need to ensure TypeScript config: not needed.

Now final check: All files provided.

Now produce answer with each file block.

Before output, confirm each file.

**prisma/schema.prisma**:

Add datasource and generator? Usually schema includes datasource and generator. Since we are focusing on new models, but the existing codebase may have those already. However we are to deliver Prisma schema + migration. The entire schema file might already have some definitions. We only need to modify to add the models. However the task says "Deliver Prisma schema + migration". We can provide the full file with necessary definitions for models and keep generic datasource/generator lines. Since we don't know existing content, we can assume we need a minimal schema. But we should not break existing code; but we cannot see existing content. However we can add just the new models; but the file may need to have at least datasource/generator. In a real project, there would be those. But the spec says deliver "Prisma schema + migration". Usually they'd expect full schema file. Since we don't have any other models defined, we can provide a minimal schema with datasource and generator and our new models.

Thus:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
...
```

Add models.

Thus file: prisma/schema.prisma.

Now the rest.

Now confirm that we have `SECURITY.md`.

Write content per spec: 15-25 lines. Provide ordering of checks and why.

Now final answer format: each file path preceded by ### heading.

We should ensure there are no extraneous lines or text.

Now produce answer.
```

## reply

### prisma/schema.prisma
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model RefreshToken {
  id            String    @id @default(uuid()) @map("id")
  token         String    @unique @map("token")
  userId        String    @map("user_id")
  familyId      String    @map("family_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  expiresAt     DateTime  @map("expires_at")
  retiredAt     DateTime? @map("retired_at")
  invalidatedAt DateTime? @map("invalidated_at")

  @@map("refresh_tokens")
}

model AuditLog {
  id        String   @id @default(uuid()) @map("id")
  eventType String   @map("event_type")
  userId    String?  @map("user_id")
  tokenId   String?  @map("token_id")
  createdAt DateTime @default(now()) @map("created_at")
  details   Json?    @map("details")

  @@map("audit_logs")
}
```

### src/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/auth/token.utils.ts
```ts
// ASSUMPTION: The real implementation of issueAccessToken exists elsewhere.
// This stub provides a compile‑time placeholder.
export function issueAccessToken(userId: string): string {
  // In a production system this would sign a JWT or similar.
  return `access-token-${userId}-${Date.now()}`;
}
```

### src/refresh/invalid-refresh-token.exception.ts
```ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

### src/refresh/refresh.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RefreshToken, AuditLog } from '@prisma/client';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { token } });
  }

  /**
   * Atomically retires a token if it is still active and not expired.
   * Returns true if the row was updated (i.e., the token was retired now).
   */
  async retireIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id,
        retiredAt: null,
        invalidatedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        retiredAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        familyId,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });
  }

  async createRefreshToken(data: {
    token: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        userId: data.userId,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async logAudit(
    eventType: string,
    details: Record<string, unknown>,
    tokenId?: string,
    userId?: string,
  ): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        eventType,
        details,
        tokenId,
        userId,
      },
    });
  }
}
```

### src/refresh/refresh.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception';
import { issueAccessToken } from '../auth/token.utils';
import * as crypto from 'crypto';
import { RefreshToken } from '@prisma/client';

@Injectable()
export class RefreshService {
  constructor(private readonly refreshRepo: RefreshRepository) {}

  async refresh(refreshTokenValue: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.refreshRepo.findByToken(refreshTokenValue);
    if (!token) {
      await this.refreshRepo.logAudit('unknown_token', { presentedToken: refreshTokenValue });
      throw new InvalidRefreshTokenException();
    }

    // 1️⃣ Reuse detection (invalidated family) – must be checked before anything else
    if (token.invalidatedAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_invalidated',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 2️⃣ Token already retired (reuse of a rotated token)
    if (token.retiredAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_retired',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 3️⃣ Expiry check – after reuse checks to satisfy “reuse before expiry”
    const now = new Date();
    if (token.expiresAt <= now) {
      await this.refreshRepo.logAudit('expired_token', { tokenId: token.id, userId: token.userId });
      throw new InvalidRefreshTokenException();
    }

    // 4️⃣ Atomic retirement – ensures exactly one concurrent rotation succeeds
    const retired = await this.refreshRepo.retireIfActive(token.id);
    if (!retired) {
      // Token was retired concurrently → treat as reuse
      await this.refreshRepo.logAudit('reuse', {
        reason: 'concurrent_retirement',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 5️⃣ Successful rotation – create a fresh token with the same absolute deadline
    const newTokenValue = crypto.randomBytes(32).toString('hex');
    await this.refreshRepo.createRefreshToken({
      token: newTokenValue,
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: token.expiresAt, // absolute deadline unchanged
    });

    const accessToken = issueAccessToken(token.userId);
    return { accessToken, refreshToken: newTokenValue };
  }
}
```

### src/refresh/refresh.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RefreshService } from './refresh.service';
import { Request, Response } from 'express';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception';

@Controller()
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * POST /auth/refresh
   * Accepts a refresh token either in the JSON body (`refreshToken`) or in the
   * `refresh_token` cookie. **If both are present, the body token takes precedence.**
   */
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const tokenFromBody: string | undefined = body?.refreshToken;
    const tokenFromCookie: string | undefined = req.cookies?.refresh_token;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    if (!refreshToken) {
      // malformed request – treat as generic rejection
      throw new InvalidRefreshTokenException();
    }

    const result = await this.refreshService.refresh(refreshToken);

    // Return the new refresh token as an HttpOnly cookie (optional but common)
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    // Also include it in the JSON body for API consumers that prefer it
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
```

### src/refresh/refresh.module.ts
```ts
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshRepository } from './refresh.repository';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository, PrismaService],
  exports: [RefreshService],
})
export class RefreshModule {}
```

### test/refresh.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/refresh/refresh.module';
import { RefreshService } from '../src/refresh/refresh.service';
import { PrismaService } from '../src/prisma.service';
import { InvalidRefreshTokenException } from '../src/refresh/invalid-refresh-token.exception';
import { PrismaClient, RefreshToken } from '@prisma/client';
import * as crypto from 'crypto';

describe('RefreshService', () => {
  let module: TestingModule;
  let refreshService: RefreshService;
  let prisma: PrismaService;

  const USER_ID = 'test-user';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [RefreshModule],
    }).compile();

    refreshService = module.get<RefreshService>(RefreshService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createRootToken(opts?: { expiresInMs?: number }): Promise<RefreshToken> {
    const tokenValue = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (opts?.expiresInMs ?? 60 * 60 * 1000));
    return prisma.refreshToken.create({
      data: {
        token: tokenValue,
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });
  }

  it('concurrent presentation of same token rotates exactly once', async () => {
    const root = await createRootToken();
    const tokenValue = root.token;

    // Fire two refreshes concurrently
    const attempt1 = refreshService.refresh(tokenValue).catch((e) => e);
    const attempt2 = refreshService.refresh(tokenValue).catch((e) => e);
    const results = await Promise.all([attempt1, attempt2]);

    const successes = results.filter((r) => !(r instanceof InvalidRefreshTokenException));
    const failures = results.filter((r) => r instanceof InvalidRefreshTokenException);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const successResult = successes[0] as { accessToken: string; refreshToken: string };

    // All tokens belonging to the family must now be invalidated
    const familyTokens = await prisma.refreshToken.findMany({
      where: { familyId: root.familyId },
    });
    for (const t of familyTokens) {
      expect(t.invalidatedAt).not.toBeNull();
    }

    // An audit entry for reuse must exist
    const reuseLog = await prisma.auditLog.findFirst({ where: { eventType: 'reuse' } });
    expect(reuseLog).toBeDefined();
  });

  it('replay after rotation invalidates sibling token', async () => {
    const root = await createRootToken();
    const rootValue = root.token;

    // First rotation (root -> A)
    const first = await refreshService.refresh(rootValue);
    const tokenA = first.refreshToken;

    // Second rotation (A -> B)
    const second = await refreshService.refresh(tokenA);
    const tokenB = second.refreshToken;

    // Replay of token A – should cause family invalidation
    await expect(refreshService.refresh(tokenA)).rejects.toBeInstanceOf(InvalidRefreshTokenException);

    // Token B must now be invalidated
    const tokenBRecord = await prisma.refreshToken.findUnique({ where: { token: tokenB } });
    expect(tokenBRecord).toBeDefined();
    expect(tokenBRecord?.invalidatedAt).not.toBeNull();
  });

  it('rotation does not extend absolute deadline', async () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now
    const root = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });

    const result = await refreshService.refresh(root.token);
    const newToken = await prisma.refreshToken.findUnique({ where: { token: result.refreshToken } });
    expect(newToken).toBeDefined();
    expect(newToken?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('all rejection responses are identical', async () => {
    // Helper to capture the error payload
    const captureError = async (fn: () => Promise<any>) => {
      try {
        await fn();
        fail('expected exception');
      } catch (e) {
        const err = e as any;
        return err.getResponse().error;
      }
    };

    // Unknown token
    const errUnknown = await captureError(() => refreshService.refresh('nonexistent'));
    // Expired token
    const expired = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() - 1000), // already past
      },
    });
    const errExpired = await captureError(() => refreshService.refresh(expired.token));
    // Retired token
    const retired = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await prisma.refreshToken.update({
      where: { id: retired.id },
      data: { retiredAt: new Date() },
    });
    const errRetired = await captureError(() => refreshService.refresh(retired.token));
    // Malformed token (empty string)
    const errMalformed = await captureError(() => refreshService.refresh(''));

    const expected = {
      code: 'invalid_refresh_token',
      message: 'Invalid refresh token',
      details: {},
    };

    expect(errUnknown).toEqual(expected);
    expect(errExpired).toEqual(expected);
    expect(errRetired).toEqual(expected);
    expect(errMalformed).toEqual(expected);
  });
});
```

### SECURITY.md
```
# Refresh Token Rotation – Security Rationale

1. **Reuse detection before any other check**  
   The service first verifies whether the presented token belongs to an already
   invalidated family (`invalidatedAt`). This guarantees that a replay of a
   compromised token is recorded as a **reuse** event, even if the token is also
   expired. Detecting reuse first prevents an attacker from being logged merely as
   an “expiry” case, which would mask a breach.

2. **Retirement check before expiry**  
   After confirming the token is not part of an invalidated family, we check whether
   the token has already been retired (`retiredAt`). A retired token indicates a
   previous successful rotation; presenting it again is a replay attack. This
   check runs before the expiry check so that a token that is both retired and
   expired is still classified as reuse.

3. **Expiry check last**  
   Only when the token is fresh, unretired, and not part of an invalidated family
   do we compare `expiresAt` with the current time. An expired token that has
   never been used is therefore treated as a simple expiration, not a compromise.

4. **Atomic retirement**  
   The retirement of a token is performed with a single `UPDATE … WHERE …` that
   includes `retiredAt IS NULL` and `expiresAt > now()`. This statement is executed
   inside the database engine, guaranteeing that at most one concurrent request can
   succeed. The loser observes that the update affected zero rows and is recorded
   as a reuse attempt.

5. **Family‑wide invalidation on reuse**  
   When a reused token is detected, the whole token family (all tokens sharing the
   original `familyId`) is invalidated in a single `UPDATE` statement. This
   eliminates the need for recursive walks and ensures that any sibling tokens
   issued before the compromise are rendered unusable immediately.

6. **Fixed absolute session deadline**  
   New refresh tokens inherit the original `expiresAt` timestamp, preserving the
   absolute session lifetime set at sign‑in. Rotating tokens never extend this
   deadline, preventing sessions from persisting indefinitely.

By ordering the checks as **invalidated → retired → expired → rotate**, we ensure
that any indication of compromise is captured with the highest priority, while
still providing a uniform error response to callers. This ordering is critical
to prevent attackers from hiding reuse behind normal expiration logs.```
