# solution

## reasoning

```
We need to design a solution for the described problem: refresh token rotation with detection of reuse. The repo seems to be a typical NestJS project with Prisma. However we have no existing code. We need to create all files required: prisma schema, migrations (but we can just add model definitions), NestJS module, controller, service, repository, tests, and a SECURITY.md file.

The problem states:

- The rest of the authentication system (sign-in and access-token verification) already exist. There's an `issueAccessToken(userId): string` function we can call to issue an access token (maybe imported from elsewhere). We need to assume it exists.

- We'll need a model for refresh tokens with fields: token identifier (maybe the token value itself stored hashed), userId, parentTokenId? Or we can model families via a `session_id` linking all tokens of same sign-in. Also need absolute expiration deadline per session (the original sign-in's absolute expiry time). Also need token-specific expiration (maybe same as session expiration?). The rotation should produce a new token each time; we need to store the token in DB with a `revoked` boolean or `retired_at` timestamp.

- For reuse detection, we need to be able to invalidate all tokens belonging to a session when a retired token is presented. That means a token model should have `sessionId` linking to a session model. Or we can store a root token id (original sign-in token) and have tokens link to it, but we need to be able to invalidate "every token descended from the same original sign-in". So a session entity with fields: id, userId, expiresAt (absolute deadline), isCompromised (maybe not needed). Refresh tokens would have fields: id (uuid), token (hashed), sessionId (FK), createdAt, expiresAt (maybe same as session expires?), retiredAt (timestamp when retired), used (maybe not needed), maybe a `previousTokenId` to track chain, but not needed for invalidation.

- For atomic rotation: When presenting a refresh token, we need to attempt to retire it and issue a new token in a transaction that does an UPDATE where token is not retired and not expired, and return number of rows affected. If 0 rows updated, we treat as reuse (or unknown). For concurrency, we rely on PostgreSQL row-level locking via conditional UPDATE.

Implementation steps:

1. Parse the incoming request. The token may be in request body `refreshToken` or in cookie `refresh_token`. Precedence: maybe body wins over cookie (or vice versa). The spec says define and document which wins when both are present. We'll choose body token takes precedence (makes sense because body is explicit). Document this in the controller comment.

2. Validate token format: assume token is a random string (e.g., JWT or opaque). We'll treat as string.

3. In service, call repository to attempt rotation:

- Steps:

a. Look up the token row by hashed value (or token id) with its token column (maybe storing token hashed). We'll need a function to compute hash (e.g., using bcrypt, but for simplicity we can store token as plain text). Since security is a concern, we might store hashed tokens. But we can just store plain for simplicity. Let's mention assumptions.

b. Acquire a transaction that does:

- UPDATE refresh_tokens SET retired_at = now() WHERE id = $tokenId AND retired_at IS NULL AND expires_at > now() RETURNING *;

If this returns a row, we successfully retired token.

- Then insert a new token row with same sessionId, expires_at same as session.expires_at (absolute deadline). The token value is generated randomly (e.g., using crypto.randomBytes base64url). Insert with retired_at = null.

- Return the new token and userId.

- Also optionally insert audit log entry.

If the UPDATE returns 0 rows, meaning token was already retired or expired, treat as reuse scenario.

However spec says: "Check reuse before expiry". If token is both retired and expired, treat as reuse. So we need to check if token is already retired (retired_at != null) or used before expiration. But the conditional update already includes retired_at IS NULL AND expires_at > now(). So if token is retired, update will affect zero rows, treat as reuse. If token is not retired but expires_at <= now(), the update also affects zero rows. But spec wants to treat token both retired and expired as reuse, not expiry. Since both conditions fail, we can't differentiate, but we can still treat as reuse for any failure. However we also need to differentiate for audit: record reason: "expired", "retired", "unknown", "malformed". Since we need to record all four distinct cases in audit. So we need to fetch token details (maybe before trying update) to see why it failed.

Approach:

- In repository, find token by token value (maybe hashed). If not found, it's unknown (or malformed). Then audit unknown and return failure.

- If found, check if token.retired_at is not null => reuse event. We'll then invalidate session tokens and audit as reuse.

- Else if token.expires_at <= now() => token expired. According to spec, we should treat as reuse if it's also retired (but if retired_at is null, it's not reuse). But spec says "Check reuse before expiry" - if token both retired and expired, reuse should be recorded. Since we already checked retired before expiry, that works.

- If token is valid (retired_at null, expires_at > now()), we attempt rotation. But to handle concurrency, we need to do atomic operation: we could use "UPDATE ... WHERE id = $id AND retired_at IS NULL AND expires_at > now() RETURNING *" and check rowCount. This will succeed only for one of concurrent requests. If the first request retires the token and inserts new token, the second request will try to update but rowCount will be zero, then treat as reuse (since token is now retired). But we may have already flagged that token as retired earlier, but we need to ensure we capture the reuse detection. So flow:

- In service: call repository.tryRetireToken(tokenValue) which does conditional UPDATE and returns the token row if succeeded (original token). If succeeded, we then insert new token, record audit success, and return new tokens.

- If it fails, we need to fetch token again to see why it failed (maybe it's already retired). So we can have repository.getTokenByValue(tokenValue). Then check retired_at etc. But concurrency: after the first rotation, the token is retired, so second call fails on update, we then fetch token and see retired_at not null => treat as reuse. Then call repository.invalidateSession(token.sessionId) and record audit.

But we also need to handle unknown token: if fetch returns null => unknown.

Implementation details:

- Refresh token generation: use `crypto.randomBytes(32).toString('hex')` or base64url.

- Hash storage: We could hash tokens with SHA256 for lookup (since we need to find token by presented token). Let's do:

  - At issuance, generate token string (e.g., `crypto.randomBytes(48).toString('base64url')`). Compute its SHA256 digest hex string, store `tokenHash` column. Return the plain token to client.

  - On presentation, compute SHA256 hash of presented token, look up by tokenHash.

- Database schema:

  - Model Session: fields: id (String @id @default(uuid())), userId (String?), createdAt (DateTime @default(now())), expiresAt (DateTime), compromisedAt (DateTime?) maybe optional. Relationship: tokens (RefreshToken[]).

  - Model RefreshToken: id (String @id @default(uuid())), tokenHash (String @unique), sessionId (String @map("session_id")), createdAt (DateTime @default(now())), expiresAt (DateTime) (maybe equals session.expiresAt), retiredAt (DateTime?), previousTokenId (String?) maybe not needed.

  - Model AuditLog: id (String @id @default(uuid())), event (String), details (Json), timestamp (DateTime @default(now())).

But we might not need AuditLog model, but we can just insert rows into an `audit_logs` table for simplicity. Or we could just log to console. However spec says "Record the event for audit". We should store it.

Better to have an AuditLog model with fields: id, event (enum?), details (Json), createdAt.

Simplify: We can create a `RefreshTokenEvent` model for audit, with `type` (e.g., 'reuse', 'unknown', 'expired', 'malformed') and `details` Json.

But spec says audit distinguishes all four rejections. Also need to record reuse events when a retired token is presented. Also need to record the whole family invalidation.

Thus we need a model for audit logs:

model TokenAudit {
  id String @id @default(uuid())
  tokenId String? // optional, token that caused event
  sessionId String?
  event String // e.g., "reuse_detected", "unknown_token", "expired_token", "malformed_token"
  details Json
  createdAt DateTime @default(now())
}

Alternatively, we can have an enum.

Given scope, we can implement a simple AuditLog repository method that just inserts a row.

We also need the NestJS module: maybe path `src/auth/refresh/`? Let's decide to create a module at `src/auth/refresh`.

Thus we will have:

- src/auth/refresh/refresh.module.ts
- src/auth/refresh/refresh.controller.ts
- src/auth/refresh/refresh.service.ts
- src/auth/refresh/refresh.repository.ts

Testing: We'll write Vitest test under `test/auth-refresh.spec.ts`.

Test Cases:

- Concurrent presentation: simulate concurrency using Promise.all where two calls to service.refresh(token) concurrently. Expect only one succeed, the other gets reuse detection.

- Replay that invalidates sibling token: This means after a token is rotated, its sibling token (e.g., the token that is a child of same session) remains valid; but presenting a retired token should invalidate whole family. So test scenario: sign-in -> token A. Rotate to token B (present token A -> token B). Now token A is retired. Then present token A again; that should cause invalidation of all tokens for that session, which includes token B; after that, token B should be invalid for future rotations. So test: after presenting token A again, attempt to rotate token B; it should fail as token family invalidated.

- Rotation against absolute deadline: sign-in with session expiry e.g., 1 day. After rotating, the new token must have same expiresAt as original session (no extension). Test by setting expiry time short, rotate multiple times, ensure expiresAt doesn't change.

- Rejection responses: All rejections (unknown, expired, malformed, retired) produce same error response (JSON error envelope). We'll test the controller's response shape.

Implementation specifics:

- Since we can't run migrations, we need to write the Prisma schema that includes models.

- The NestJS controller will have route POST '/auth/refresh' (maybe path prefix '/auth', but we can register in module with controller's route). For simplicity, we can define controller like:

```
@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: string }, @Req() req: Request, @Res() res: Response) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token; // Need cookie-parser middleware. We'll assume cookie parser is set up.

    const token = tokenFromBody ?? tokenFromCookie;

    // Document precedence: body token wins over cookie.

    if (!token) {
      // treat as malformed (no token)
      return this.handleError('malformed_token', res);
    }

    try {
      const result = await this.refreshService.rotate(token);
      // set new refresh token cookie
      res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: true, sameSite: 'lax' });
      return { accessToken: result.accessToken };
    } catch (e) {
      if (e instanceof RefreshError) {
        return this.handleError(e.code, res);
      }
      // unknown error
      return this.handleError('unknown_error', res);
    }
  }

  private handleError(code: string, res: Response) {
    res.status(401);
    return { error: { code, message: 'Invalid refresh token', details: {} } };
  }
}
```

But we need to define a custom error class to capture error codes: maybe `RefreshError` with property `code` being one of 'reuse_detected', 'expired_token', 'unknown_token', 'malformed_token'.

The service will throw these errors. The controller catches them and returns the uniform error envelope.

The service will orchestrate repository calls. It will contain:

- rotate(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>

Implementation:

```
async rotate(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashToken(presentedToken);
  const rotationResult = await this.refreshRepository.tryRotate(tokenHash);
  // rotationResult either success (new token and session) or null if rotation not possible.
  if (rotationResult?.newRefreshToken && rotationResult?.session) {
    const accessToken = issueAccessToken(rotationResult.session.userId);
    return { accessToken, refreshToken: rotationResult.newRefreshToken };
  }

  // Rotation not possible: figure out cause
  const tokenRecord = await this.refreshRepository.findByHash(tokenHash);
  if (!tokenRecord) {
    // unknown token
    await this.refreshRepository.audit('unknown_token', { presentedToken });
    throw new RefreshError('unknown_token');
  }

  // token exists
  if (tokenRecord.retiredAt) {
    // reuse
    await this.refreshRepository.invalidateSession(tokenRecord.sessionId);
    await this.refreshRepository.audit('reuse_detected', { tokenId: tokenRecord.id, sessionId: tokenRecord.sessionId });
    throw new RefreshError('reuse_detected');
  }

  const now = new Date();
  if (tokenRecord.expiresAt <= now) {
    // token expired
    // According to spec, treat expired token as reuse if retired? Already handled. So this is pure expiry.
    await this.refreshRepository.audit('expired_token', { tokenId: tokenRecord.id, sessionId: tokenRecord.sessionId });
    throw new RefreshError('expired_token');
  }

  // any other case, treat as malformed?
  await this.refreshRepository.audit('malformed_token', { presentedToken });
  throw new RefreshError('malformed_token');
}
```

But we need atomic rotate operation: tryRotate should be implemented as a transaction that attempts to update the token's retiredAt and inserts new token.

Implementation in repository:

```
async tryRotate(tokenHash: string): Promise<{ newRefreshToken: string; session: Session }> | null {
  return await this.prisma.$transaction(async (tx) => {
    const token = await tx.refreshToken.findFirst({
      where: { tokenHash },
    });
    if (!token) {
      return null;
    }
    const now = new Date();
    // Check if token is valid (not retired and not expired)
    if (token.retiredAt || token.expiresAt <= now) {
      return null;
    }

    // retire token
    const retired = await tx.refreshToken.updateMany({
      where: {
        id: token.id,
        retiredAt: null,
        expiresAt: { gt: now },
      },
      data: { retiredAt: now },
    });

    if (retired.count === 0) {
      // concurrent update or token already retired/expired
      return null;
    }

    // create new token
    const newTokenPlain = generateRandomToken();
    const newTokenHash = hashToken(newTokenPlain);
    const newRefresh = await tx.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        sessionId: token.sessionId,
        expiresAt: token.expiresAt,
        // createdAt automatically set
      },
    });

    // fetch session
    const session = await tx.session.findUnique({
      where: { id: token.sessionId },
    });

    // Return new token string (plain) and session for access token issue.
    // Note: we cannot return plain token via transaction because it's not stored; just return from function.
    // However the token is generated inside transaction; we need to return it.
    // The transaction function can return object with newRefreshToken (plain) and session.

    return { newRefreshToken: newTokenPlain, session };
  });
}
```

But note: In Prisma `$transaction`, the function can be async and can return value. We must use `tx.refreshToken.updateMany` etc.

Potential concurrency: Two concurrent calls will both attempt to updateSame token. One will succeed with `count: 1`, the other will get `count: 0` because token.retiredAt is now set (or the where condition fails). So second will return null; then service will treat as reuse.

But we also need to ensure that the second request logs a reuse event and invalidates the session. So after tryRotate returns null, the service fetches token (via findByHash) to determine cause. It may see token.retiredAt set, so reuse. Then call invalidateSession to set compromisedAt or mark all tokens as retired (maybe set all tokens' retiredAt = now?). The spec says "invalidate the whole family". So we need to update all refresh tokens of the session to set retiredAt (or compromisedAt) to now, effectively making all future rotations fail. Also maybe we add a flag to session to indicate compromised, but it's enough to update tokens.

Implementation of invalidateSession:

```
async invalidateSession(sessionId: string) {
  await this.prisma.refreshToken.updateMany({
    where: {
      sessionId,
      retiredAt: null,
    },
    data: { retiredAt: new Date() },
  });
}
```

Optionally, we could also set a `compromisedAt` in Session model for audit.

Audit logging:

Define model TokenAudit with fields:

```
model TokenAudit {
  id          String   @id @default(uuid())
  event       String
  tokenHash   String?  // maybe null for unknown
  sessionId   String?
  details     Json
  createdAt   DateTime @default(now())
}
```

Repository's `audit(event, details)` will insert into TokenAudit.

Now the Prisma schema:

We'll include models: User? Not needed. Session, RefreshToken, TokenAudit.

We need to decide on mapping (snake_case columns). Use @map.

We need to set up environment variable `DATABASE_URL` but that's default.

We need migration - not required to write migrations file, just include schema.

We need to implement helper functions: generateRandomToken and hashToken. Use Node crypto.

Define `hashToken(token: string): string` using `createHash('sha256').update(token).digest('hex')`. For simplicity, store as string.

Define `generateRandomToken(): string` using `randomBytes(48).toString('base64url')`. However Node's `crypto.randomBytes(...).toString('base64url')` works only in newer Node, which is fine.

Now the NestJS module: define providers and controllers.

- RefreshModule:

```
@Module({
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository],
  exports: [RefreshService],
})
export class RefreshModule {}
```

Potential imports: PrismaModule to provide Prisma client. We need to assume a PrismaService is present that extends `PrismaClient`. If not, we need to implement it. Usually NestJS with Prisma has a `PrismaService` defined under `src/prisma/prisma.service.ts`. It may not exist. But we can create it. For completeness, we should create a `src/prisma/prisma.service.ts` that provides PrismaClient. Then import this module into RefreshModule.

Define `PrismaModule`:

```
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Alternatively, if they already have it, we can assume it's there. But to be safe, we can include it.

Thus we need to create:

- src/prisma/prisma.service.ts
- src/prisma/prisma.module.ts

But the layout guidelines say we can put them anywhere.

Now the test file.

We need tests for:

1. Concurrent presentation: we can simulate using Vitest and Promise.all with two calls to service.rotate. But service.rotate expects a token string and will use Prisma transaction. For test, we need to set up an in-memory SQLite or test Postgres. However we can use the Prisma client with SQLite in memory for speed. But the repo may expect Postgres. However for test, we can set up the DB using test environment variables. Without actual DB, can't run tests. But we can implement tests assuming the DB exists. Provide tests as code that uses NestTestingModule to initialize the module and repository.

Simplify: Provide test file that uses Nest's `Test.createTestingModule` to import RefreshModule and PrismaModule. Then in beforeEach we create a fresh database (maybe using Prisma migrate). But given limited context, we can write tests that use Prisma client to set up data.

We'll need to create helper function to create a session and initial refresh token. Use repository's `createSession(userId, expiresIn)` maybe not exist. We'll need to add a method to repository to create initial tokens for tests, or use Prisma directly in test.

Simplify: In test, use Prisma client to create a Session and RefreshToken record directly.

Test flow:

- Insert a User? Not needed. We'll just use userId as a string.

- Session:

```
const session = await prisma.session.create({
  data: {
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
  },
});
```

- Generate refresh token plain: use `generateRandomToken`. Compute hash. Insert token:

```
const tokenPlain = generateRandomToken();
const tokenHash = hashToken(tokenPlain);
await prisma.refreshToken.create({
  data: {
    tokenHash,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  },
});
```

Now test concurrent rotation:

```
await Promise.all([
  refreshService.rotate(tokenPlain),
  refreshService.rotate(tokenPlain),
]).then((results) => {
  // One should succeed, other should reject with reuse error.
});
```

But service.rotate throws errors for failures. So we need to capture them.

Implementation details: We'll use try/catch to differentiate.

Test should assert that exactly one of the results succeeded (i.e., returned access token and new refresh token). The other should throw a `RefreshError` with code 'reuse_detected'.

Also test that after reuse detection (i.e., after second attempt), the sibling token (the new token from successful rotation) is invalidated because whole session family invalidated. So after the concurrent attempt, we need to call rotate on the new token (from successful rotation). It should fail with reuse or unknown? It should treat as reuse detection again because session already invalidated. But after invalidation, the token is retired (as part of invalidation). So rotate(newToken) should fail as reuse (maybe token.retiredAt set). But we need to test that.

Test for absolute deadline: verify that the new token's expiresAt equals session.expiresAt, not later. We can fetch the new token's DB record via its hash, and check expiresAt equals original.

Test for uniform rejection: we can simulate unknown token (random string) and expired token (token with expiresAt in past), and retired token (maybe manually set retiredAt), and malformed token (e.g., empty). All should produce same response body structure from controller.

Thus we need to test the controller's response.

Implementation of controller's handleError must produce:

```
{
  error: {
    code: <code>,
    message: 'Invalid refresh token',
    details: {}
  }
}
```

All errors same shape; only code changes.

Now we need to define `RefreshError` class:

```
export class RefreshError extends Error {
  constructor(public readonly code: string) {
    super(`Refresh error: ${code}`);
  }
}
```

Now we need to implement the repository:

`src/auth/refresh/refresh.repository.ts`

Implementation will import PrismaService.

We will define:

- findByHash(tokenHash): Promise<RefreshToken | null>

- tryRotate(tokenHash): Promise<{ newRefreshToken: string; session: Session } | null>

- invalidateSession(sessionId): Promise<void>

- audit(event: string, details: any): Promise<void>

Need to define types for models: Prisma generated types (e.g., Prisma.RefreshToken, Prisma.Session). We'll import them via Prisma client type.

Define `RefreshToken` model in Prisma schema:

```
model Session {
  id          String        @id @default(uuid())
  userId      String
  createdAt   DateTime      @default(now())
  expiresAt   DateTime
  refreshTokens RefreshToken[]
  @@map("sessions")
}

model RefreshToken {
  id          String   @id @default(uuid())
  tokenHash   String   @unique @map("token_hash")
  session     Session  @relation(fields: [sessionId], references: [id])
  sessionId   String   @map("session_id")
  createdAt   DateTime @default(now())
  expiresAt   DateTime @map("expires_at")
  retiredAt   DateTime? @map("retired_at")
  @@map("refresh_tokens")
}

model TokenAudit {
  id          String   @id @default(uuid())
  event       String
  tokenHash   String?  @map("token_hash")
  sessionId   String?  @map("session_id")
  details     Json
  createdAt   DateTime @default(now())
  @@map("token_audits")
}
```

Make columns snake_case via @map.

Now we need to ensure that `refreshToken` is stored hashed.

Now we need to write code for token generation and hashing. We'll create a utility file:

`src/auth/refresh/refresh.utils.ts`

Containing:

```
import { randomBytes, createHash } from 'crypto';

export function generateRandomToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

Now service imports those.

Now service's `rotate` method will return plain tokens, not hashed.

Now we also need to handle `issueAccessToken(userId)`. The spec says assume `issueAccessToken(userId): string` exists. We'll import it from somewhere, maybe `src/auth/auth.utils` or `src/auth/token.service`. We'll use placeholder import: `import { issueAccessToken } from '../auth.utils';`. Then we can add comment: // ASSUMPTION: issueAccessToken function is available and returns a signed JWT access token.

Now tests.

Test file:

`test/auth-refresh.spec.ts`

Will use Vitest.

We'll import NestTestingModule, create app, get services.

We'll also need to import PrismaService to clean DB between tests.

We'll implement helper to create session and token.

We'll write tests.

Potential issues:

- Because the repository's tryRotate uses transaction and generate new token inside transaction, we need to compute new token plain inside transaction; this is okay.

- The repository's invalidateSession will set retiredAt on all tokens for session; but the token being used for reuse detection is already retired. This will also set retiredAt on sibling token.

- Audit: We'll just use prisma.tokenAudit.create.

Now about the controller: It will need cookie parser to read cookies; we can assume that request object has a cookies property. In NestJS, you can inject `@Req() req: Request`. To have cookies, you need to use `cookie-parser` middleware. We'll assume it's set up.

Now the module imports: RefreshModule may need to import PrismaModule.

Now we need to include a `src/main.ts` and `src/app.module.ts`? Not required but we can include if they exist. However the task only asks for files needed for solution: we need to provide Prisma schema, NestJS module files (controller, service, repository), tests, and SECURITY.md. We'll need to also create `SECURITY.md`.

Thus we will produce:

- prisma/schema.prisma
- src/prisma/prisma.service.ts
- src/prisma/prisma.module.ts
- src/auth/refresh/refresh.module.ts
- src/auth/refresh/refresh.controller.ts
- src/auth/refresh/refresh.service.ts
- src/auth/refresh/refresh.repository.ts
- src/auth/refresh/refresh.utils.ts
- src/auth/refresh/refresh.error.ts (error class)
- test/auth-refresh.spec.ts
- SECURITY.md

Optionally, we might need to define DTOs for request body. But not needed.

Now ensure code is TypeScript strict, uses imports correctly.

Define type for Prisma client: `PrismaService extends PrismaClient`. We'll need to import `PrismaClient` from `@prisma/client`.

Implementation details:

`prisma.service.ts`:

```
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

`prisma.module.ts`:

```
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Now `refresh.error.ts`:

```
export class RefreshError extends Error {
  constructor(public readonly code: string) {
    super(`Refresh error: ${code}`);
    this.name = 'RefreshError';
  }
}
```

Now `refresh.utils.ts` with functions as described.

Now `refresh.repository.ts`:

We need to import PrismaService and types.

Implementation:

```
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Session, RefreshToken } from '@prisma/client';
import { generateRandomToken, hashToken } from './refresh.utils';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  async tryRotate(tokenHash: string): Promise<{ newRefreshToken: string; session: Session } | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Find the token
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });
      if (!token) {
        return null;
      }

      // Check token validity (not retired, not expired)
      if (token.retiredAt !== null || token.expiresAt <= now) {
        return null;
      }

      // Retire the token atomically
      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          retiredAt: null,
          expiresAt: { gt: now },
        },
        data: {
          retiredAt: now,
        },
      });

      if (updateResult.count === 0) {
        // Another concurrent rotation succeeded
        return null;
      }

      // Create new token
      const newPlainToken = generateRandomToken();
      const newTokenHash = hashToken(newPlainToken);
      await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          sessionId: token.sessionId,
          expiresAt: token.expiresAt,
        },
      });

      // Fetch session for access token issuance
      const session = await tx.session.findUnique({
        where: { id: token.sessionId },
      });

      if (!session) {
        // Should not happen; abort
        throw new Error('Session not found during token rotation');
      }

      return { newRefreshToken: newPlainToken, session };
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        retiredAt: null,
      },
      data: {
        retiredAt: now,
      },
    });
    // Optionally mark session compromised
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { compromisedAt: now },
    });
  }

  async audit(event: string, details: any): Promise<void> {
    await this.prisma.tokenAudit.create({
      data: {
        event,
        details,
      },
    });
  }
}
```

We referenced a `compromisedAt` column on Session, need to add it to schema.

Add to Session model:

```
compromisedAt DateTime? @map("compromised_at")
```

Now `refresh.service.ts`:

```
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository';
import { RefreshError } from './refresh.error';
// ASSUMPTION: issueAccessToken(userId: string): string is available for import
import { issueAccessToken } from '../../auth.utils'; // adjust path as needed

@Injectable()
export class RefreshService {
  constructor(private readonly repo: RefreshRepository) {}

  async rotate(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(presentedToken);
    const rotationResult = await this.repo.tryRotate(tokenHash);
    if (rotationResult) {
      const accessToken = issueAccessToken(rotationResult.session.userId);
      return { accessToken, refreshToken: rotationResult.newRefreshToken };
    }

    // Rotation failed – determine reason
    const tokenRecord = await this.repo.findTokenByHash(tokenHash);
    if (!tokenRecord) {
      await this.repo.audit('unknown_token', { presentedToken });
      throw new RefreshError('unknown_token');
    }

    // Reuse detection (already retired)
    if (tokenRecord.retiredAt) {
      await this.repo.invalidateSession(tokenRecord.sessionId);
      await this.repo.audit('reuse_detected', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('reuse_detected');
    }

    // Expired token
    const now = new Date();
    if (tokenRecord.expiresAt <= now) {
      await this.repo.audit('expired_token', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('expired_token');
    }

    // Any other case treated as malformed
    await this.repo.audit('malformed_token', { presentedToken });
    throw new RefreshError('malformed_token');
  }
}
```

But we used `hashToken` in service, need to import from utils:

```
import { hashToken } from './refresh.utils';
```

Add that import.

Now controller:

`refresh.controller.ts`:

```
import { Body, Controller, Post, Req, Res, HttpCode } from '@nestjs/common';
import { RefreshService } from './refresh.service';
import { RefreshError } from './refresh.error';
import { Request, Response } from 'express';

@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * Handles refresh token rotation.
   * Token source precedence: JSON body `refreshToken` takes precedence over
   * `refresh_token` cookie if both are present.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const presentedToken = tokenFromBody ?? tokenFromCookie;

    if (!presentedToken) {
      return this.respondWithError(res, 'malformed_token');
    }

    try {
      const result = await this.refreshService.rotate(presentedToken);
      // Set new refresh token in HttpOnly secure cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        // No expiration set; rely on client to handle session expiration via token content
      });
      return res.json({ accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof RefreshError) {
        return this.respondWithError(res, err.code);
      }
      // Unexpected error – treat as generic unknown token error for safety
      return this.respondWithError(res, 'unknown_error');
    }
  }

  private respondWithError(res: Response, code: string) {
    res.status(401).json({
      error: {
        code,
        message: 'Invalid refresh token',
        details: {},
      },
    });
    return;
  }
}
```

Note: We used `res.json` after setting cookie; this is acceptable with `@Res()` and no need to return a value, as we are using raw response.

Now `refresh.module.ts`:

```
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshRepository } from './refresh.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository],
  exports: [RefreshService],
})
export class RefreshModule {}
```

Now need to add the module to the overall app module (maybe not required). But can define an `src/app.module.ts` if not present. However not asked.

Now security.md.

We'll produce a markdown file with 15-25 lines. It must state ordering between checks and why it is that way round.

Spec: Check reuse before expiry. Also check token existence (unknown) and malformed first? The spec says reuse detection before expiry; the code reflects that.

Write content accordingly.

Now test file.

Implementation details for testing concurrency: Use Promise.all on two concurrent rotate calls. We'll need to import RefreshService and RefreshRepository. We'll need PrismaService for data preparation and cleanup.

The test will need to reset DB after each test.

Simplify: Use `beforeAll` to initialize NestTestingModule, get services; use `beforeEach` to clear tables via prisma.$executeRaw or delete many.

We'll write helper to create session and token.

Define tests:

Test 1: "Concurrent refresh: exactly one rotation succeeds"

Implementation:

```
test('concurrent refresh with same token results in exactly one successful rotation', async () => {
  const { userId, session, tokenPlain } = await createSessionAndToken('user-1', 60 * 60 * 1000); // 1 hour

  const promise1 = refreshService.rotate(tokenPlain);
  const promise2 = refreshService.rotate(tokenPlain);

  const results = await Promise.allSettled([promise1, promise2]);

  const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const error = rejected[0].reason;
  expect(error).toBeInstanceOf(RefreshError);
  expect(error.code).toBe('reuse_detected');

  // Verify the sibling token (the new refresh token) is now invalid due to session invalidation
  const successfulResult = fulfilled[0].value;
  const siblingToken = successfulResult.refreshToken;
  await expect(refreshService.rotate(siblingToken)).rejects.toMatchObject({ code: 'reuse_detected' });
});
```

We'll need a `createSessionAndToken` function that uses prisma to create session and token.

Test 2: "Presenting a retired token invalidates the whole family"

We'll create session and token A, rotate to token B (which retires A). Then present token A again (reuse). Expect reuse detection and invalidation, and after that token B also fails.

Implementation:

```
test('replay of retired token invalidates sibling token', async () => {
  const { tokenPlain: tokenA } = await createSessionAndToken('user-2', 60 * 60 * 1000);
  // First rotation: tokenA -> tokenB
  const { refreshToken: tokenB } = await refreshService.rotate(tokenA);

  // Replay tokenA
  await expect(refreshService.rotate(tokenA)).rejects.toMatchObject({ code: 'reuse_detected' });

  // Now tokenB should be invalidated
  await expect(refreshService.rotate(tokenB)).rejects.toMatchObject({ code: 'reuse_detected' });
});
```

Test 3: "Rotation does not extend absolute session deadline"

We'll create session with expiresAt = now + 10 seconds; rotate token, then retrieve new token from DB and assert its expiresAt equals original session expiresAt (not later). Since we can't easily get the token's expiresAt from service (it returns plain token only). We'll fetch from DB using hash of new token.

Implementation:

```
test('rotation does not extend absolute session deadline', async () => {
  const expiresAt = new Date(Date.now() + 10 * 1000);
  const { tokenPlain } = await createSessionAndToken('user-3', expiresAt.getTime() - Date.now());

  const result = await refreshService.rotate(tokenPlain);
  const newTokenPlain = result.refreshToken;
  const newTokenHash = hashToken(newTokenPlain);
  const tokenRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: newTokenHash } });
  expect(tokenRecord).not.toBeNull();
  expect(tokenRecord?.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -1);
});
```

But we used a helper `hashToken` from utils.

Test 4: "All rejections have identical response shape"

We'll test via controller. For unknown token, expired token, malformed token (no token), and reuse. For each case, we call the endpoint and assert response shape.

We'll need to create a testing HTTP server using Nest's `INestApplication`. We'll start the app, make supertest requests. Use `supertest` library.

Implementation: set up app in beforeAll.

```
import * as request from 'supertest';
...
let app: INestApplication;
...
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [RefreshModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(require('cookie-parser')()); // to parse cookies
  await app.init();
});
```

Then test each case:

- Malformed: POST without token body or cookie.

```
const res = await request(app.getHttpServer())
  .post('/auth/refresh')
  .send({});
expect(res.status).toBe(401);
expect(res.body).toEqual({
  error: {
    code: 'malformed_token',
    message: 'Invalid refresh token',
    details: {}
  }
});
```

- Unknown token: use random string.

```
const res = await request(app.getHttpServer())
  .post('/auth/refresh')
  .send({ refreshToken: 'unknown-token' });
...
expect(res.body.error.code).toBe('unknown_token');
```

- Expired token: create a token with past expiresAt, then present it.

- Reuse token: rotate token, then use old token again.

All should have same body shape: only code varies.

Now we need to define `createSessionAndToken` function within test file (maybe using prisma directly). It should accept a userId and expiry duration or absolute expiration timestamp. We'll need a function that sets expiresAt accordingly and generate token.

Implementation of helper:

```
async function createSessionAndToken(userId: string, ttlMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
    },
  });
  const tokenPlain = generateRandomToken();
  const tokenHash = hashToken(tokenPlain);
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      sessionId: session.id,
      expiresAt,
    },
  });
  return { userId, session, tokenPlain };
}
```

Add import for `generateRandomToken` and `hashToken`.

Now after each test we clear tables: we can use `await prisma.tokenAudit.deleteMany(); await prisma.refreshToken.deleteMany(); await prisma.session.deleteMany();`

Now test file will include required imports.

Potential missing parts: The Session model has `compromisedAt`, but we don't use it.

Need to adjust `RefreshRepository.invalidateSession` to also set compromisedAt. Add column.

Now update Prisma schema accordingly.

Now we need to ensure we have proper `@map` for snake_case.

Add to Prisma schema:

```
model Session {
  id          String        @id @default(uuid())
  userId      String        @map("user_id")
  createdAt   DateTime      @default(now()) @map("created_at")
  expiresAt   DateTime      @map("expires_at")
  compromisedAt DateTime? @map("compromised_at")
  refreshTokens RefreshToken[]
  @@map("sessions")
}
```

RefreshToken fields mapping already defined.

TokenAudit model mapping.

Now ensure imports.

Now final deliverable: we must output each file with heading and fenced block.

Let's compile all file contents.

File list:

1. prisma/schema.prisma
2. src/prisma/prisma.service.ts
3. src/prisma/prisma.module.ts
4. src/auth/refresh/refresh.utils.ts
5. src/auth/refresh/refresh.error.ts
6. src/auth/refresh/refresh.repository.ts
7. src/auth/refresh/refresh.service.ts
8. src/auth/refresh/refresh.controller.ts
9. src/auth/refresh/refresh.module.ts
10. test/auth-refresh.spec.ts
11. SECURITY.md

Check naming conventions: file names kebab-case. So path `src/auth/refresh/refresh.service.ts` is correct.

Now produce each file with appropriate content.

One nuance: In NestJS, the controller with `@Res()` returns directly using Express response, we need to import `Response` from `express`. Also we used `@Body()` to parse JSON. Ensure we have `import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';` plus `import { Request, Response } from 'express';`.

Now the error codes: The envelope expects `"code": "resource_not_found"` style snake_case. Our codes are 'unknown_token', 'reuse_detected', 'expired_token', 'malformed_token'. These are snake_case, okay.

Spec says error envelope: `error` with `code`, `message`, `details`. Our respondWithError returns that.

Now we need to ensure that we treat unknown token as `unknown_token`. Also for any unexpected error in controller we treat as generic `unknown_error`. But we may not have test for that.

Now we need to ensure that the repository's audit logs `event` maybe same as code. We'll use same.

Now we must add import for `Prisma` types for `Session` and `RefreshToken`. Use `import { Prisma, Session, RefreshToken } from '@prisma/client';` but may not need Prisma.

Now we need to define the `RefreshRepository.findTokenByHash` method; used in service; we implemented findTokenByHash.

Make sure to add the method.

Now we need to check the code for potential compile errors: `refresh.service.ts` imports `hashToken` but we didn't import from utils. Add import line.

Now we used `issueAccessToken` function. We need to import it; we have comment for ASSUMPTION. We'll import from a placeholder module.

Let's assume `src/auth/auth.utils.ts` contains `issueAccessToken`. But we can import from `'../auth.utils'` relative to service file (since service is at `src/auth/refresh/refresh.service.ts` and auth.utils would be at `src/auth/auth.utils.ts`). Provide a placeholder comment.

We'll put:

```ts
// ASSUMPTION: issueAccessToken(userId: string): string is defined in a utility module.
import { issueAccessToken } from '../auth.utils';
```

Now we need to create that `src/auth/auth.utils.ts` file? Not required by spec. It's assumed to exist. However to avoid TypeScript error, we can still create a stub file that exports a dummy function. But spec says not to create files you were not asked for. However we are not certain if such file exists. But we can use a comment ASSUMPTION and not import to avoid compile errors. But TypeScript will error if we have an import that resolves to missing module. We should not import a non-existing module. Instead we can define a type for the function inside service as placeholder. We could define it as a function variable declared in same file:

```
declare function issueAccessToken(userId: string): string;
```

Using `declare` statement informs TypeScript that it exists elsewhere. This avoids import.

Better to use:

```ts
// ASSUMPTION: The function issueAccessToken(userId: string): string is globally available.
declare function issueAccessToken(userId: string): string;
```

That satisfies compiler.

Now adjust the service to use it.

Now we need to add `hashToken` import from utils.

Now the repository's `invalidateSession` updates `session` table's `compromisedAt`. The Session model includes compromisedAt column.

Now we need to add import for `PrismaClient` in PrismaService.

Now we need to add the path imports correctly: `import { PrismaService } from '../../prisma/prisma.service';` but the repository is under `src/auth/refresh`, so relative path `../../prisma/prisma.service`. Yes.

Now `refresh.module.ts` imports `PrismaModule` from `'../../prisma/prisma.module'`.

Now `refresh.controller.ts` imports `RefreshService` from `'./refresh.service'` and `RefreshError` from `'./refresh.error'`.

Now we need to create the folder structure: `src/auth/refresh/` with files.

Now tests.

Test file imports:

```
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/auth/refresh/refresh.module';
import { RefreshService } from '../src/auth/refresh/refresh.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { generateRandomToken, hashToken } from '../src/auth/refresh/refresh.utils';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
```

But we used relative paths from test folder.

Now test will use PrismaService.

Now we need to ensure that the test uses `await app.close()` after all tests.

Now write test functions accordingly.

Potential issues: The repository's `tryRotate` returns `{ newRefreshToken: string; session: Session } | null`. The service uses rotationResult.session.userId. Ensure Session model has `userId` field.

Now `session.userId` is present.

Now we need to add `userId` column in Session model mapping.

Now we must adjust imports.

Now we need to ensure we used `DateTime` correctly.

Now we need to ensure that the token expiration handling: The token's expiresAt is set to session.expiresAt. Good.

Now we need to ensure that the token's retiredAt is set as `Date` with `new Date()`.

Now we need to ensure that the token generation is cryptographically random.

Now we need to ensure concurrency works: The `$transaction` ensures atomic. However we need to ensure that `tokenHash` is unique, which is required to find token.

Now we need to ensure that we handle the case where token not found, returning null early; the service will then audit unknown token.

Now we need to ensure that token invalidation updates all tokens' retiredAt in the session, plus sets compromisedAt.

Now we need to ensure that the test for absolute deadline uses token's expiresAt.

Now we need to implement `prisma.schema.prisma`.

Let's write it fully.

```
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id            String          @id @default(uuid()) @map("id")
  userId        String          @map("user_id")
  createdAt     DateTime        @default(now()) @map("created_at")
  expiresAt     DateTime        @map("expires_at")
  compromisedAt DateTime?       @map("compromised_at")
  refreshTokens RefreshToken[]

  @@map("sessions")
}

model RefreshToken {
  id          String   @id @default(uuid()) @map("id")
  tokenHash   String   @unique @map("token_hash")
  session     Session  @relation(fields: [sessionId], references: [id])
  sessionId   String   @map("session_id")
  createdAt   DateTime @default(now()) @map("created_at")
  expiresAt   DateTime @map("expires_at")
  retiredAt   DateTime? @map("retired_at")

  @@map("refresh_tokens")
}

model TokenAudit {
  id        String   @id @default(uuid()) @map("id")
  event     String   @map("event")
  tokenHash String?  @map("token_hash")
  sessionId String?  @map("session_id")
  details   Json     @map("details")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("token_audits")
}
```

Note: `@@map` is for model name mapping, but each column also gets @map. The `@@map` is for table name. Already added.

Now we need to include any missing columns for `Session` like `userId`. That's fine.

Now we need to note we used `prisma` client generated from this schema.

Now we should also add any indexes if needed, but not required.

Now we need to implement `refresh.repository.ts` imports.

Potential issues: In `$transaction`, we used `await tx.refreshToken.findUnique({ where: { tokenHash } })`. But we need to ensure that tokenHash is unique.

Now we need to return the new token string (plain) from tryRotate, not hashed. That's fine.

Now we need to define type for returned token: In `tryRotate`, we have:

```
return tx.prisma.$transaction...
```

But TypeScript may infer return type. We'll type method signature accordingly.

Now the `tryRotate` returns `Promise<{ newRefreshToken: string; session: Session } | null>`.

Now in the repository we referenced `this.prisma.session.update` in `invalidateSession`. However we used `compromisedAt` column; ensure that column exists. Yes, we added.

Now we need to ensure that the code compiles.

Let's review each file for errors.

## prisma/schema.prisma

Will compile.

## src/prisma/prisma.service.ts

```
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

Should compile.

## src/prisma/prisma.module.ts

```
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Compile.

## src/auth/refresh/refresh.utils.ts

```
import { randomBytes, createHash } from 'crypto';

export function generateRandomToken(): string {
  // 48 bytes => 64 characters in base64url
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

## src/auth/refresh/refresh.error.ts

```
export class RefreshError extends Error {
  constructor(public readonly code: string) {
    super(`Refresh error: ${code}`);
    this.name = 'RefreshError';
  }
}
```

## src/auth/refresh/refresh.repository.ts

Let's write it fully.

```
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Session, RefreshToken, TokenAudit } from '@prisma/client';
import { generateRandomToken, hashToken } from './refresh.utils';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  async tryRotate(tokenHash: string): Promise<{ newRefreshToken: string; session: Session } | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (!token) {
        return null;
      }

      // If token is already retired or expired, abort rotation
      if (token.retiredAt !== null || token.expiresAt <= now) {
        return null;
      }

      // Attempt to retire the token atomically
      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          retiredAt: null,
          expiresAt: { gt: now },
        },
        data: {
          retiredAt: now,
        },
      });

      if (updateResult.count === 0) {
        // Another concurrent rotation succeeded
        return null;
      }

      // Create a new refresh token for the same session
      const newPlainToken = generateRandomToken();
      const newTokenHash = hashToken(newPlainToken);
      await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          sessionId: token.sessionId,
          expiresAt: token.expiresAt,
        },
      });

      // Retrieve the session to issue an access token
      const session = await tx.session.findUnique({
        where: { id: token.sessionId },
      });

      if (!session) {
        throw new Error('Session not found during token rotation');
      }

      return { newRefreshToken: newPlainToken, session };
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        retiredAt: null,
      },
      data: {
        retiredAt: now,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { compromisedAt: now },
    });
  }

  async audit(event: string, details: any): Promise<void> {
    await this.prisma.tokenAudit.create({
      data: {
        event,
        details,
        // tokenHash and sessionId are optional; include if present in details
        tokenHash: details?.tokenHash ?? undefined,
        sessionId: details?.sessionId ?? undefined,
      },
    });
  }
}
```

Check for import of `TokenAudit`: not needed because we use prisma directly.

Potential issue: The `tokenAudit.create` expects fields tokenHash and sessionId to be optional; in schema they are `String?`. That's okay.

Now `refresh.service.ts`:

```
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository';
import { RefreshError } from './refresh.error';
import { hashToken } from './refresh.utils';

// ASSUMPTION: The function issueAccessToken(userId: string): string is globally available.
declare function issueAccessToken(userId: string): string;

@Injectable()
export class RefreshService {
  constructor(private readonly repo: RefreshRepository) {}

  async rotate(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(presentedToken);
    const rotationResult = await this.repo.tryRotate(tokenHash);

    if (rotationResult) {
      const accessToken = issueAccessToken(rotationResult.session.userId);
      return { accessToken, refreshToken: rotationResult.newRefreshToken };
    }

    // Rotation failed – determine the reason
    const tokenRecord = await this.repo.findTokenByHash(tokenHash);
    if (!tokenRecord) {
      await this.repo.audit('unknown_token', { presentedToken });
      throw new RefreshError('unknown_token');
    }

    // Reuse detection (already retired)
    if (tokenRecord.retiredAt) {
      await this.repo.invalidateSession(tokenRecord.sessionId);
      await this.repo.audit('reuse_detected', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('reuse_detected');
    }

    const now = new Date();

    // Expired token
    if (tokenRecord.expiresAt <= now) {
      await this.repo.audit('expired_token', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('expired_token');
    }

    // Malformed or any other unexpected condition
    await this.repo.audit('malformed_token', { presentedToken });
    throw new RefreshError('malformed_token');
  }
}
```

Now `refresh.controller.ts`:

```
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { RefreshService } from './refresh.service';
import { RefreshError } from './refresh.error';
import { Request, Response } from 'express';

@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * Refresh token rotation endpoint.
   *
   * Token precedence:
   * - If both JSON body `refreshToken` and `refresh_token` cookie are present,
   *   the body token takes precedence.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const presentedToken = tokenFromBody ?? tokenFromCookie;

    if (!presentedToken) {
      return this.respondWithError(res, 'malformed_token');
    }

    try {
      const result = await this.refreshService.rotate(presentedToken);
      // Set the new refresh token as an HttpOnly secure cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });
      return res.json({ accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof RefreshError) {
        return this.respondWithError(res, err.code);
      }
      // For any unexpected error, respond with a generic unknown error code
      return this.respondWithError(res, 'unknown_error');
    }
  }

  private respondWithError(res: Response, code: string) {
    res.status(401).json({
      error: {
        code,
        message: 'Invalid refresh token',
        details: {},
      },
    });
    return;
  }
}
```

Now `refresh.module.ts`:

```
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshRepository } from './refresh.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository],
  exports: [RefreshService],
})
export class RefreshModule {}
```

Now test file.

`test/auth-refresh.spec.ts`:

We'll write the test.

```
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { RefreshModule } from '../src/auth/refresh/refresh.module';
import { RefreshService } from '../src/auth/refresh/refresh.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { generateRandomToken, hashToken } from '../src/auth/refresh/refresh.utils';
import * as request from 'supertest';
import cookieParser from 'cookie-parser';
import { RefreshError } from '../src/auth/refresh/refresh.error';

describe('Refresh Token Rotation (Integration)', () => {
  let app: INestApplication;
  let refreshService: RefreshService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [RefreshModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    refreshService = moduleRef.get<RefreshService>(RefreshService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up database after each test
    await prisma.tokenAudit.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.session.deleteMany({});
  });

  async function createSessionAndToken(userId: string, ttlMs: number) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const session = await prisma.session.create({
      data: {
        userId,
        expiresAt,
      },
    });
    const tokenPlain = generateRandomToken();
    const tokenHash = hashToken(tokenPlain);
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        sessionId: session.id,
        expiresAt,
      },
    });
    return { session, tokenPlain };
  }

  it('concurrent refresh with same token results in exactly one successful rotation', async () => {
    const { tokenPlain } = await createSessionAndToken('user-1', 60 * 60 * 1000); // 1 hour

    const promise1 = refreshService.rotate(tokenPlain);
    const promise2 = refreshService.rotate(tokenPlain);

    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = rejected[0].reason;
    expect(error).toBeInstanceOf(RefreshError);
    expect(error.code).toBe('reuse_detected');

    // The successful rotation returns a new refresh token
    const newToken = fulfilled[0].value.refreshToken;

    // Attempt to use the sibling token after the reuse detection; it should be invalidated
    await expect(refreshService.rotate(newToken)).rejects.toMatchObject({ code: 'reuse_detected' });
  });

  it('replay of a retired token invalidates its sibling token', async () => {
    const { tokenPlain: tokenA } = await createSessionAndToken('user-2', 60 * 60 * 1000);
    // First rotation: tokenA -> tokenB
    const { refreshToken: tokenB } = await refreshService.rotate(tokenA);

    // Replay tokenA (should be detected as reuse)
    await expect(refreshService.rotate(tokenA)).rejects.toMatchObject({ code: 'reuse_detected' });

    // tokenB should now be invalid
    await expect(refreshService.rotate(tokenB)).rejects.toMatchObject({ code: 'reuse_detected' });
  });

  it('rotation does not extend the absolute session deadline', async () => {
    const ttlMs = 10 * 1000; // 10 seconds
    const { tokenPlain } = await createSessionAndToken('user-3', ttlMs);
    const result = await refreshService.rotate(tokenPlain);
    const newPlainToken = result.refreshToken;
    const newTokenHash = hashToken(newPlainToken);
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: newTokenHash },
    });
    expect(tokenRecord).not.toBeNull();
    // The expiresAt of the new token should match the session's original expiresAt
    const session = await prisma.session.findUnique({
      where: { id: tokenRecord!.sessionId },
    });
    expect(tokenRecord!.expiresAt.getTime()).toBeCloseTo(session!.expiresAt.getTime(), -1);
  });

  it('all rejection responses have identical envelope shape', async () => {
    // Malformed (no token)
    const malformedRes = await request(app.getHttpServer()).post('/auth/refresh').send({});
    expect(malformedRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(malformedRes.body).toEqual({
      error: {
        code: 'malformed_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // Unknown token
    const unknownRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'some-unknown-token' });
    expect(unknownRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(unknownRes.body).toEqual({
      error: {
        code: 'unknown_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // Expired token
    const { tokenPlain: expiredToken } = await createSessionAndToken('user-4', -1000); // already expired
    const expiredRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: expiredToken });
    expect(expiredRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(expiredRes.body).toEqual({
      error: {
        code: 'expired_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // Reuse (retired) token
    const { tokenPlain: tokenA } = await createSessionAndToken('user-5', 60 * 60 * 1000);
    const { refreshToken: tokenB } = await refreshService.rotate(tokenA);
    // Present tokenA again
    const reuseRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA });
    expect(reuseRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(reuseRes.body).toEqual({
      error: {
        code: 'reuse_detected',
        message: 'Invalid refresh token',
        details: {},
      },
    });
  });
});
```

Potential adjustments:

- The `createSessionAndToken` with ttlMs negative for expired token may cause session expiresAt in the past; that works.

- In `createSessionAndToken`, we set token's expiresAt same as session.expiresAt. For negative ttl, token will be expired.

- The `request(app.getHttpServer()).post('/auth/refresh')` will need to use cookie parser and also to parse JSON. Nest automatically parses JSON body. Ensure we set `Content-Type` automatically.

- For the concurrency test, we used `refreshService.rotate(tokenPlain)` directly; but to test concurrency at DB level, it might be okay. It uses direct service calls, which internally call repository and transaction; concurrency is simulated via Promise.all.

Potential nuance: In concurrency test, the second call may run after the first call has already retired token, but the `Promise.all` may still cause them to execute concurrently (they start simultaneously). That's okay.

- The test expects `rejects.toMatchObject({ code: 'reuse_detected' })`. Since we throw RefreshError with code property, `rejects` will reject with RefreshError instance. That works.

Now we need to ensure that import paths are correct.

The test file uses relative import `'../src/auth/refresh/refresh.module'` but the test file is at `test/auth-refresh.spec.ts`, which is at root level? The path should be `../src/...`. Actually, the test file is in `test/` directory, at path `test/auth-refresh.spec.ts`. So from there, `../src/...` is correct.

Now check import path for PrismaService: `'../src/prisma/prisma.service'`.

Now check import for generateRandomToken and hashToken: `'../src/auth/refresh/refresh.utils'`.

Now for RefreshError import: `'../src/auth/refresh/refresh.error'`.

Now `request(app.getHttpServer())` uses supertest.

Now we used `cookieParser` import and `app.use(cookieParser())`. Need to install cookie-parser in real repo; but not needed for code.

Now the test expects `HttpStatus.UNAUTHORIZED` constant imported from `@nestjs/common`. We imported that.

Now we need to ensure that the `RefreshController` uses `@Res()` and returns a value; we responded with `return this.respondWithError`. In Nest when using `@Res()` the returned value is ignored; we use `res.json` and `res.status`. The `return` statements are optional.

Now we need to make sure that in the controller, we import `Response` from 'express', and `Request` from 'express'.

Now we need to add any missing imports for `RefreshError` in controller. Already imported.

Now security.md content.

We need to produce a file with 15-25 lines stating ordering between checks and why it is that way round.

Write something like:

```
# Security Considerations for Refresh Token Rotation

- **Check token existence first** – if the token is not present in the database we record an `unknown_token` event and reject. This prevents leaking information about valid tokens.
- **Detect reuse before expiry** – a token that has already been retired is treated as a compromise even if it is also expired. By checking `retired_at` prior to `expires_at` we ensure an attacker replaying a stolen token is logged as `reuse_detected`, not just an expired token.
- **Retire the presented token atomically** – the rotation uses a conditional `UPDATE … WHERE retired_at IS NULL AND expires_at > now()` inside a transaction. Only one concurrent request can succeed, guaranteeing that exactly one fresh token is issued.
- **Invalidate the entire session family on reuse** – once a retired token is presented again, we set `retired_at` on **all** refresh tokens belonging to the same `session_id` and mark the session as compromised. This cuts off any remaining valid refresh tokens that could have been stolen.
- **Do not extend the absolute deadline** – every new refresh token inherits the original session `expires_at`. The rotation never pushes the session expiration forward, preserving the intended session lifetime.
- **Record an audit entry for every rejection** – the repository writes a `TokenAudit` row with the specific event (`unknown_token`, `reuse_detected`, `expired_token`, `malformed_token`). Auditors can distinguish the root cause while callers see a uniform error envelope.
- **Uniform error response** – the controller always returns a `401` with the envelope `{ "error": { "code": "...", "message": "Invalid refresh token", "details": {} } }`. The `code` is the only differentiator, keeping the API contract stable and avoiding information leakage.

These ordering decisions prioritize early detection of compromise, guarantee a single successful rotation under concurrency, and keep the observable behavior identical for all failure modes.
```

Count lines: Approximately 19 lines. Good.

Now ensure all required files are present.

One missing piece: the `RefreshError` class uses `code` property, but we might want to type its `code` property as a union of possible string literals for better type safety, but not required.

Now potential missing imports:

In `refresh.repository.ts` we imported `TokenAudit` but we didn't use it; not needed. We can remove import to avoid unused. Let's remove it.

We imported `Session, RefreshToken` from Prisma client. That's fine.

Now check for any `any` type usage: none.

Now compile.

Potential errors:

- In Prisma schema, we used `@@map` incorrectly? Actually model-level mapping uses `@@map`. According to Prisma docs, we use `@@map("table_name")` not `@@map`. The correct attribute is `@@map`. Yes we used `@@map`. The schema uses `@@map` at the end of model. That's fine.

But in the model we wrote:

```
@@map("sessions")
```

However we also have `@map` on fields; these are okay.

Now we need to check that we have a `Session` field mapping: `userId` column has `@map("user_id")`. Fine.

Now we need to ensure that we have a `compromisedAt` column. Added.

Now we need to ensure that the `RefreshToken` model has `tokenHash` unique. Good.

Now we need to ensure that the `TokenAudit` has `details Json`. Good.

Now we need to ensure we have correct plural forms.

Now ensure that we didn't miss any imports.

Now we need to ensure that we exported the module.

Now final step: output all files as per format.

Check each file for syntax.

### prisma/schema.prisma

Make sure we include generator and datasource.

### src/prisma/prisma.service.ts

### src/prisma/prisma.module.ts

### src/auth/refresh/refresh.utils.ts

### src/auth/refresh/refresh.error.ts

### src/auth/refresh/refresh.repository.ts

### src/auth/refresh/refresh.service.ts

### src/auth/refresh/refresh.controller.ts

### src/auth/refresh/refresh.module.ts

### test/auth-refresh.spec.ts

### SECURITY.md

Now generate final answer.
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

model Session {
  id            String          @id @default(uuid()) @map("id")
  userId        String          @map("user_id")
  createdAt     DateTime        @default(now()) @map("created_at")
  expiresAt     DateTime        @map("expires_at")
  compromisedAt DateTime?       @map("compromised_at")
  refreshTokens RefreshToken[]

  @@map("sessions")
}

model RefreshToken {
  id          String   @id @default(uuid()) @map("id")
  tokenHash   String   @unique @map("token_hash")
  session     Session  @relation(fields: [sessionId], references: [id])
  sessionId   String   @map("session_id")
  createdAt   DateTime @default(now()) @map("created_at")
  expiresAt   DateTime @map("expires_at")
  retiredAt   DateTime? @map("retired_at")

  @@map("refresh_tokens")
}

model TokenAudit {
  id        String   @id @default(uuid()) @map("id")
  event     String   @map("event")
  tokenHash String?  @map("token_hash")
  sessionId String?  @map("session_id")
  details   Json     @map("details")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("token_audits")
}
```

### src/prisma/prisma.service.ts
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

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/auth/refresh/refresh.utils.ts
```ts
import { randomBytes, createHash } from 'crypto';

export function generateRandomToken(): string {
  // 48 bytes => 64 URL‑safe characters
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

### src/auth/refresh/refresh.error.ts
```ts
export class RefreshError extends Error {
  constructor(public readonly code: string) {
    super(`Refresh error: ${code}`);
    this.name = 'RefreshError';
  }
}
```

### src/auth/refresh/refresh.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Session, RefreshToken } from '@prisma/client';
import { generateRandomToken, hashToken } from './refresh.utils';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * Attempts an atomic rotation:
   * - Retires the presented token only if it is still live.
   * - Issues a brand‑new refresh token linked to the same session.
   * Returns null if the token could not be retired (already retired,
   * expired, or a concurrent rotation succeeded).
   */
  async tryRotate(tokenHash: string): Promise<{ newRefreshToken: string; session: Session } | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (!token) {
        return null;
      }

      // Abort if token is already retired or expired
      if (token.retiredAt !== null || token.expiresAt <= now) {
        return null;
      }

      // Conditional update – only succeeds if the token is still live
      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          retiredAt: null,
          expiresAt: { gt: now },
        },
        data: {
          retiredAt: now,
        },
      });

      if (updateResult.count === 0) {
        // Another concurrent request succeeded first
        return null;
      }

      // Issue a fresh token with the same absolute expiry
      const newPlainToken = generateRandomToken();
      const newTokenHash = hashToken(newPlainToken);
      await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          sessionId: token.sessionId,
          expiresAt: token.expiresAt,
        },
      });

      // Retrieve the session to issue an access token
      const session = await tx.session.findUnique({
        where: { id: token.sessionId },
      });

      if (!session) {
        throw new Error('Session not found during token rotation');
      }

      return { newRefreshToken: newPlainToken, session };
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        retiredAt: null,
      },
      data: {
        retiredAt: now,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { compromisedAt: now },
    });
  }

  async audit(event: string, details: any): Promise<void> {
    await this.prisma.tokenAudit.create({
      data: {
        event,
        details,
        tokenHash: details?.tokenHash ?? undefined,
        sessionId: details?.sessionId ?? undefined,
      },
    });
  }
}
```

### src/auth/refresh/refresh.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository';
import { RefreshError } from './refresh.error';
import { hashToken } from './refresh.utils';

// ASSUMPTION: The function issueAccessToken(userId: string): string is globally available.
declare function issueAccessToken(userId: string): string;

@Injectable()
export class RefreshService {
  constructor(private readonly repo: RefreshRepository) {}

  /**
   * Rotates a refresh token.
   * On success returns a fresh access token and a brand‑new refresh token.
   * On failure throws RefreshError with a code that the controller maps to the
   * uniform error envelope.
   */
  async rotate(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(presentedToken);
    const rotationResult = await this.repo.tryRotate(tokenHash);

    if (rotationResult) {
      const accessToken = issueAccessToken(rotationResult.session.userId);
      return { accessToken, refreshToken: rotationResult.newRefreshToken };
    }

    // Rotation could not happen – diagnose the cause
    const tokenRecord = await this.repo.findTokenByHash(tokenHash);
    if (!tokenRecord) {
      await this.repo.audit('unknown_token', { presentedToken });
      throw new RefreshError('unknown_token');
    }

    // Reuse detection: token already retired
    if (tokenRecord.retiredAt) {
      await this.repo.invalidateSession(tokenRecord.sessionId);
      await this.repo.audit('reuse_detected', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('reuse_detected');
    }

    const now = new Date();

    // Expired token (not already retired)
    if (tokenRecord.expiresAt <= now) {
      await this.repo.audit('expired_token', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('expired_token');
    }

    // Any other abnormality is treated as malformed
    await this.repo.audit('malformed_token', { presentedToken });
    throw new RefreshError('malformed_token');
  }
}
```

### src/auth/refresh/refresh.controller.ts
```ts
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { RefreshService } from './refresh.service';
import { RefreshError } from './refresh.error';
import { Request, Response } from 'express';

@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * Refresh token rotation endpoint.
   *
   * Token precedence:
   * - If both JSON body `refreshToken` and `refresh_token` cookie are present,
   *   the body token wins.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const presentedToken = tokenFromBody ?? tokenFromCookie;

    if (!presentedToken) {
      return this.respondWithError(res, 'malformed_token');
    }

    try {
      const result = await this.refreshService.rotate(presentedToken);
      // Set the new refresh token as an HttpOnly, Secure cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });
      return res.json({ accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof RefreshError) {
        return this.respondWithError(res, err.code);
      }
      // Unexpected error – treat as generic unknown token error
      return this.respondWithError(res, 'unknown_error');
    }
  }

  private respondWithError(res: Response, code: string) {
    res.status(401).json({
      error: {
        code,
        message: 'Invalid refresh token',
        details: {},
      },
    });
    return;
  }
}
```

### src/auth/refresh/refresh.module.ts
```ts
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshRepository } from './refresh.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository],
  exports: [RefreshService],
})
export class RefreshModule {}
```

### test/auth-refresh.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { RefreshModule } from '../src/auth/refresh/refresh.module';
import { RefreshService } from '../src/auth/refresh/refresh.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { generateRandomToken, hashToken } from '../src/auth/refresh/refresh.utils';
import * as request from 'supertest';
import cookieParser from 'cookie-parser';
import { RefreshError } from '../src/auth/refresh/refresh.error';

describe('Refresh Token Rotation (Integration)', () => {
  let app: INestApplication;
  let refreshService: RefreshService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [RefreshModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    refreshService = moduleRef.get<RefreshService>(RefreshService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean the tables between tests
    await prisma.tokenAudit.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.session.deleteMany({});
  });

  async function createSessionAndToken(userId: string, ttlMs: number) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const session = await prisma.session.create({
      data: {
        userId,
        expiresAt,
      },
    });
    const tokenPlain = generateRandomToken();
    const tokenHash = hashToken(tokenPlain);
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        sessionId: session.id,
        expiresAt,
      },
    });
    return { session, tokenPlain };
  }

  it('concurrent refresh with same token results in exactly one successful rotation', async () => {
    const { tokenPlain } = await createSessionAndToken('user-1', 60 * 60 * 1000); // 1 hour

    const promise1 = refreshService.rotate(tokenPlain);
    const promise2 = refreshService.rotate(tokenPlain);

    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = rejected[0].reason;
    expect(error).toBeInstanceOf(RefreshError);
    expect(error.code).toBe('reuse_detected');

    // The successful rotation returned a fresh token
    const siblingToken = fulfilled[0].value.refreshToken;

    // The sibling should now be invalid because the reuse event invalidated the whole family
    await expect(refreshService.rotate(siblingToken)).rejects.toMatchObject({ code: 'reuse_detected' });
  });

  it('replay of a retired token invalidates its sibling token', async () => {
    const { tokenPlain: tokenA } = await createSessionAndToken('user-2', 60 * 60 * 1000);
    // First rotation: tokenA → tokenB
    const { refreshToken: tokenB } = await refreshService.rotate(tokenA);

    // Replay tokenA – should be detected as reuse
    await expect(refreshService.rotate(tokenA)).rejects.toMatchObject({ code: 'reuse_detected' });

    // tokenB is now part of the invalidated family
    await expect(refreshService.rotate(tokenB)).rejects.toMatchObject({ code: 'reuse_detected' });
  });

  it('rotation does not extend the absolute session deadline', async () => {
    const ttlMs = 10 * 1000; // 10 seconds
    const { tokenPlain } = await createSessionAndToken('user-3', ttlMs);
    const result = await refreshService.rotate(tokenPlain);
    const newPlainToken = result.refreshToken;
    const newTokenHash = hashToken(newPlainToken);
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: newTokenHash },
    });
    expect(tokenRecord).not.toBeNull();

    const session = await prisma.session.findUnique({
      where: { id: tokenRecord!.sessionId },
    });
    expect(tokenRecord!.expiresAt.getTime()).toBeCloseTo(session!.expiresAt.getTime(), -1);
  });

  it('all rejection responses have identical envelope shape', async () => {
    // 1. Malformed request (no token supplied)
    const malformedRes = await request(app.getHttpServer()).post('/auth/refresh').send({});
    expect(malformedRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(malformedRes.body).toEqual({
      error: {
        code: 'malformed_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // 2. Unknown token
    const unknownRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'nonexistent-token' });
    expect(unknownRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(unknownRes.body).toEqual({
      error: {
        code: 'unknown_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // 3. Expired token
    const { tokenPlain: expiredToken } = await createSessionAndToken('user-4', -1000); // already expired
    const expiredRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: expiredToken });
    expect(expiredRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(expiredRes.body).toEqual({
      error: {
        code: 'expired_token',
        message: 'Invalid refresh token',
        details: {},
      },
    });

    // 4. Reuse (retired) token
    const { tokenPlain: tokenA } = await createSessionAndToken('user-5', 60 * 60 * 1000);
    const { refreshToken: tokenB } = await refreshService.rotate(tokenA);
    // Present tokenA again – reuse path
    const reuseRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA });
    expect(reuseRes.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(reuseRes.body).toEqual({
      error: {
        code: 'reuse_detected',
        message: 'Invalid refresh token',
        details: {},
      },
    });
  });
});
```

### SECURITY.md
```md
# Security Considerations for Refresh Token Rotation

- **Check token existence first** – if the token is not present in the database we record an `unknown_token` event and reject. This prevents leaking information about valid tokens.

- **Detect reuse before expiry** – a token that has already been retired is treated as a compromise even if it is also expired. By checking `retired_at` prior to `expires_at` we ensure an attacker replaying a stolen token is logged as `reuse_detected`, not merely as an expired token.

- **Retire the presented token atomically** – the rotation uses a conditional `UPDATE … WHERE retired_at IS NULL AND expires_at > now()` inside a transaction. Only one concurrent request can succeed, guaranteeing that exactly one fresh token is issued.

- **Invalidate the entire session family on reuse** – once a retired token is presented again, we set `retired_at` on **all** refresh tokens belonging to the same `session_id` and mark the session as compromised. This cuts off any remaining valid refresh tokens that could have been stolen.

- **Do not extend the absolute deadline** – every new refresh token inherits the original session `expires_at`. The rotation never pushes the session expiration forward, preserving the intended session lifetime.

- **Record an audit entry for every rejection** – the repository writes a `TokenAudit` row with the specific event (`unknown_token`, `reuse_detected`, `expired_token`, `malformed_token`). Auditors can distinguish the root cause while callers see a uniform error envelope.

- **Uniform error response** – the controller always returns a `401` with the envelope `{ "error": { "code": "...", "message": "Invalid refresh token", "details": {} } }`. The `code` is the only differentiator, keeping the API contract stable and avoiding information leakage.

These ordering decisions prioritize early detection of compromise, guarantee a single successful rotation under concurrency, and keep the observable behavior identical for all failure modes.
```
