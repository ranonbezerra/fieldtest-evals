# solution

## reasoning

```
We need to implement token rotation with reuse detection. Need to create Prisma schema, migration, NestJS module with controller, service, repository, tests, and SECURITY.md.

We need to assume existing sign-in and access token issuance functions exist elsewhere, we just need refresh.

We must follow architecture: controller validates input, calls service. Service holds logic, no Prisma client calls. Repository does DB.

We need to define tables for refresh tokens, session tracking.

Design:

RefreshToken model:

- id: String @id @default(uuid())
- token: String @unique // stored hash? We'll store token string for simplicity.
- userId: String (or relation to User)
- sessionId: String // identifier for the session (original sign-in)
- expiresAt: DateTime
- createdAt: DateTime @default(now())
- retiredAt: DateTime? // null if active, set when rotated or revoked
- parentTokenId: String? // for chain tracking maybe.
- // maybe originalIssuedAt: DateTime for absolute lifetime.

But requirement: session has absolute lifetime fixed at sign-in, rotation issues new token but never extends deadline. So we need Session model:

Session:
- id: String @id @default(uuid())
- userId: String
- expiresAt: DateTime (absolute)
- createdAt
- revokedAt: DateTime? // for compromise detection.

RefreshToken linked to session, and also a flag retired.

When token is presented:

- Find token record (by token string). Need to handle token from body or cookie.

- If token not found -> treat as unknown. Return generic error envelope.

- If token.retiredAt != null => token already retired; treat as compromise: we need to invalidate whole session (set revokedAt now), and record audit.

- If token.expiresAt < now => expired. Return generic error.

- If session.revokedAt != null => session already revoked (compromise). Return generic error.

- If now > session.expiresAt => session expired (absolute lifetime). Return generic error (no rotation).

If token is valid (not retired, not expired, session not revoked, within absolute lifetime):

- Need to rotate: create new refresh token, link to same session, with new token string, expiresAt same as original token's expiry? Usually new token has same ttl. We'll compute new expiry = now + refreshTokenTtl (maybe config). But must not extend session's absolute expiry, so new token's expiresAt cannot exceed session.expiresAt. So newExpiresAt = min(now + REFRESH_TTL, session.expiresAt).

- Insert new token (active), set its parentTokenId = old token id.

- Mark old token as retiredAt = now.

- Return new access token (via assumed issueAccessToken(userId)) and new refresh token string (maybe set cookie? but just return JSON).

Concurrency: Two concurrent requests with same token may both try to rotate. Need to ensure exactly one rotates. Approach: In repository, perform an atomic update where we set retiredAt only if retiredAt IS NULL and session not revoked and token not expired. Use a database transaction with SELECT FOR UPDATE maybe. In Prisma, we can use transaction with raw query to update with condition and get rows affected. Or we can attempt to update token where retiredAt IS NULL and expiresAt > now and session not revoked, using updateMany with where and set retiredAt = now. If rowsAffected == 1, we succeeded rotation; else some other request already rotated/invalidated.

We'll need to fetch token after attempt to see if we succeeded.

Implementation steps in service:

- Determine token string from request (body.refreshToken vs cookie.refresh_token). Document that cookie wins? We'll define: if both present, cookie takes precedence.

- Call repository.findToken(tokenString) -> token record (including session).

- If not found => return error.

- Call repository.attemptRetireAndRotate(oldTokenId, newTokenString, newExpiresAt) which within transaction:

   - Update token where id = oldTokenId AND retiredAt IS NULL AND expiresAt > now AND session.revokedAt IS NULL AND session.expiresAt > now (session not revoked, not expired) set retiredAt = now.

   - If update count = 0 => rotation not allowed (maybe already retired) handle accordingly (compromise if retired already else other case).

   - If succeeded, create new token row with token = newTokenString, userId, sessionId, expiresAt = newExpiresAt, createdAt now.

   - Return new token.

- If token was already retired (found but retiredAt not null) => treat as compromise: repository.revokeSession(sessionId) and audit log. Return generic error.

- For audit, we could have RefreshTokenAudit model with fields.

Simplify: We'll create a simple audit table: TokenAudit with id, tokenId, event (enum), timestamp, ip? but just store.

Testing: Need vitest tests for concurrent presentation of one token, replay that invalidates sibling token, rotation against absolute deadline, and rejection responses compared.

We'll need to mock Prisma client (or use in-memory?) For tests, we can use an in-memory SQLite with Prisma? But spec says PostgreSQL. In tests we can use Prisma client with SQLite for speed but assume environment. We'll just write tests that simulate repository behavior using jest mock? In Vitest, we can mock repository.

Given complexity, but we need to provide files. Provide:

- prisma/schema.prisma (with User, Session, RefreshToken, TokenAudit models)

- src/auth/auth.module.ts

- src/auth/auth.controller.ts

- src/auth/auth.service.ts

- src/auth/auth.repository.ts

- test/auth-refresh.spec.ts

- SECURITY.md

Also need to export functions like issueAccessToken - assume imported from elsewhere.

We'll also need DTO for request body.

Implement using NestJS.

Now write files.

Assumptions: there is a User model elsewhere; we just reference its id.

Define constants REFRESH_TOKEN_TTL = 30 days? We'll set env var REFRESH_TOKEN_TTL_SECONDS.

Generate random token string using crypto.randomBytes(32).toString('hex').

Now code.
```

## reply

### prisma/schema.prisma
```prisma
// Prisma schema for refresh‑token rotation with reuse detection

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  previewFeatures = ["filterJson"]
}

/**
 * Existing user model – only the id field is required for foreign‑keys.
 * Assume it is defined elsewhere in the real project.
 */
model User {
  id        String   @id @default(uuid())
  // …other fields…
  sessions  Session[]
  refreshTokens RefreshToken[]
}

/**
 * A long‑lived session that is created at sign‑in.
 * Its lifetime never extends, even when refresh tokens are rotated.
 */
model Session {
  id          String    @id @default(uuid())
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  createdAt   DateTime  @default(now())
  expiresAt   DateTime               // absolute deadline set at sign‑in
  revokedAt   DateTime?              // set when a compromised token is detected
  refreshTokens RefreshToken[]
}

/**
 * Refresh tokens that belong to a session.
 * When a token is used it is *retired* (retiredAt is set) and a new token is
 * inserted.  The token chain can be followed via parentId.
 */
model RefreshToken {
  id          String    @id @default(uuid())
  token       String    @unique
  session     Session   @relation(fields: [sessionId], references: [id])
  sessionId   String
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  createdAt   DateTime  @default(now())
  expiresAt   DateTime               // short‑term TTL, never beyond session.expiresAt
  retiredAt   DateTime?              // null while the token is active
  parentId    String?                // points to the token that was rotated from
  parent      RefreshToken? @relation("TokenChain", fields: [parentId], references: [id])
  children    RefreshToken[] @relation("TokenChain")
}

/**
 * Audit log for every refresh‑token operation.
 * The `event` field distinguishes the reason for the log entry.
 */
model TokenAudit {
  id          String    @id @default(uuid())
  token       String
  sessionId   String
  userId      String
  event       String                // e.g. "rotation", "replay_detected", "expired", "unknown"
  createdAt   DateTime @default(now())
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { PrismaClient } from '@prisma/client';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: PrismaClient,
      useFactory: () => {
        const client = new PrismaClient();
        // The connection is established lazily by Prisma.
        return client;
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

### src/auth/auth.controller.ts
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
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Refresh an access token.
   *
   * The refresh token can be sent either:
   *  - in the JSON body as `refreshToken`
   *  - as a cookie named `refresh_token`
   *
   * If both are present, the cookie value takes precedence.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;

    // Cookie wins when both are supplied.
    const presentedToken = tokenFromCookie ?? tokenFromBody;

    const result = await this.authService.refresh(presentedToken, req.ip);

    if (!result.success) {
      // All rejections have the same envelope.
      return res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_refresh_token',
          message: 'Refresh token is invalid or has been revoked',
          details: {},
        },
      });
    }

    // On success we return the new access token and the new refresh token.
    // The caller may store the refresh token as they wish (e.g., set a cookie).
    return res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  }
}
```

### src/auth/dto/refresh.dto.ts
```ts
export class RefreshDto {
  refreshToken?: string;
}
```

### src/auth/auth.service.ts
```ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'crypto';
import { issueAccessToken } from '../utils/token.utils'; // ASSUMPTION: helper exists
import { Prisma, RefreshToken } from '@prisma/client';

@Injectable()
export class AuthService {
  // Refresh token TTL in seconds – can be tuned via env.
  private readonly REFRESH_TTL_SECONDS = Number(
    process.env.REFRESH_TTL_SECONDS ?? '2592000', // 30 days
  );

  constructor(private readonly repo: AuthRepository) {}

  /**
   * Core refresh‑token rotation logic.
   *
   * Returns a success envelope with the new access token and refresh token,
   * or a failure envelope (the controller turns it into the generic error).
   */
  async refresh(
    presentedToken: string | undefined,
    ipAddress: string,
  ): Promise<
    | { success: true; accessToken: string; refreshToken: string }
    | { success: false }
  > {
    if (!presentedToken) {
      // Missing token – treat as unknown.
      await this.repo.recordAudit(undefined, undefined, undefined, 'unknown');
      return { success: false };
    }

    // 1. Load the token together with its session and user.
    const token = await this.repo.findActiveToken(presentedToken);

    if (!token) {
      // Unknown token.
      await this.repo.recordAudit(undefined, undefined, undefined, 'unknown');
      return { success: false };
    }

    // 2. Detect already‑retired token (replay attack).
    if (token.retiredAt) {
      // Compromise detected – revoke the whole session.
      await this.repo.revokeSession(token.sessionId);
      await this.repo.recordAudit(
        token.id,
        token.sessionId,
        token.userId,
        'replay_detected',
      );
      return { success: false };
    }

    // 3. Check expiration of the token itself.
    const now = new Date();
    if (token.expiresAt < now) {
      await this.repo.recordAudit(token.id, token.sessionId, token.userId, 'expired');
      return { success: false };
    }

    // 4. Check session status (revoked or absolute deadline).
    const session = await this.repo.getSession(token.sessionId);
    if (!session) {
      // Should never happen, but treat as unknown.
      await this.repo.recordAudit(token.id, token.sessionId, token.userId, 'unknown');
      return { success: false };
    }
    if (session.revokedAt) {
      await this.repo.recordAudit(token.id, token.sessionId, token.userId, 'compromised');
      return { success: false };
    }
    if (session.expiresAt < now) {
      await this.repo.recordAudit(token.id, token.sessionId, token.userId, 'session_expired');
      return { success: false };
    }

    // 5. Compute new expiry – must not exceed session.expiresAt.
    const proposedExpiry = new Date(now.getTime() + this.REFRESH_TTL_SECONDS * 1000);
    const newExpiresAt =
      proposedExpiry < session.expiresAt ? proposedExpiry : session.expiresAt;

    // 6. Generate a fresh token value.
    const newTokenValue = randomBytes(32).toString('hex');

    // 7. Attempt rotation atomically.
    const rotated = await this.repo.rotateToken({
      oldTokenId: token.id,
      newToken: newTokenValue,
      newExpiresAt,
    });

    if (!rotated) {
      // Another concurrent request already rotated or retired this token.
      // Treat it as a replay – the other request already retired it.
      await this.repo.revokeSession(token.sessionId);
      await this.repo.recordAudit(
        token.id,
        token.sessionId,
        token.userId,
        'replay_detected',
      );
      return { success: false };
    }

    // 8. Issue a fresh access token.
    const accessToken = issueAccessToken(token.userId);

    // 9. Record successful rotation.
    await this.repo.recordAudit(
      rotated.id,
      token.sessionId,
      token.userId,
      'rotation',
    );

    return {
      success: true,
      accessToken,
      refreshToken: rotated.token,
    };
  }
}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, RefreshToken, Session } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Find a token by its raw value, including its session and user IDs. */
  async findActiveToken(tokenValue: string): Promise<
    (RefreshToken & { sessionId: string; userId: string }) | null
  > {
    return this.prisma.refreshToken.findUnique({
      where: { token: tokenValue },
      include: {
        session: true,
        user: true,
      },
    }) as any; // cast because we only need a subset
  }

  /** Retrieve a session by ID. */
  async getSession(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
    });
  }

  /** Record an audit event. */
  async recordAudit(
    tokenId: string | undefined,
    sessionId: string | undefined,
    userId: string | undefined,
    event: string,
  ): Promise<void> {
    await this.prisma.tokenAudit.create({
      data: {
        token: tokenId ?? '',
        sessionId: sessionId ?? '',
        userId: userId ?? '',
        event,
      },
    });
  }

  /** Revoke an entire session (compromise handling). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Atomically retire the old token *if* it is still active and create the new token.
   * Returns the newly created token record on success, otherwise null.
   */
  async rotateToken(params: {
    oldTokenId: string;
    newToken: string;
    newExpiresAt: Date;
  }): Promise<RefreshToken | null> {
    const { oldTokenId, newToken, newExpiresAt } = params;
    const now = new Date();

    // Use a transaction to guarantee atomicity.
    return await this.prisma.$transaction(async (tx) => {
      // 1. Try to retire the old token only if it is still active.
      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: oldTokenId,
          retiredAt: null,
          expiresAt: { gt: now },
          session: {
            revokedAt: null,
            expiresAt: { gt: now },
          },
        },
        data: { retiredAt: now },
      });

      if (updateResult.count !== 1) {
        // The token was already retired or the session is invalid.
        return null;
      }

      // 2. Create the new token, linking it to the same session and user.
      const newTokenRecord = await tx.refreshToken.create({
        data: {
          token: newToken,
          expiresAt: newExpiresAt,
          session: { connect: { id: (await tx.refreshToken.findUnique({ where: { id: oldTokenId } })).sessionId } },
          user: { connect: { id: (await tx.refreshToken.findUnique({ where: { id: oldTokenId } })).userId } },
          parent: { connect: { id: oldTokenId } },
        },
      });

      return newTokenRecord;
    });
  }
}
```

### test/auth-refresh.spec.ts
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

// Helper to create a session + refresh token.
async function createSessionWithToken(prisma: PrismaClient, ttlSeconds: number) {
  const now = new Date();
  const sessionExpiry = new Date(now.getTime() + ttlSeconds * 1000);
  const user = await prisma.user.create({
    data: {
      // Minimal user – assume required fields are satisfied.
      // @ts-ignore
      email: `test-${randomBytes(4).toString('hex')}@example.com`,
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expiresAt: sessionExpiry,
    },
  });
  const refreshTokenValue = randomBytes(32).toString('hex');
  const refreshToken = await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1h
      sessionId: session.id,
      userId: user.id,
    },
  });
  return { user, session, refreshToken };
}

describe('Refresh token rotation (variant A)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Ensure a clean DB state.
    await prisma.tokenAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();

    const moduleRef = await NestFactory.createApplicationContext(AuthModule, {
      logger: false,
    });
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('concurrent presentation of the same valid token – only one rotation succeeds', async () => {
    const { refreshToken } = await createSessionWithToken(prisma, 3600);

    // Fire two concurrent requests.
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: refreshToken.token })
        .expect(200),
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: refreshToken.token })
        .expect(401),
    ]);

    // Exactly one succeeded.
    expect(res1.body.accessToken).toBeDefined();
    expect(res1.body.refreshToken).toBeDefined();
    expect(res2.body.error).toBeDefined();
  });

  it('replay of a retired token invalidates sibling token', async () => {
    const { refreshToken, session } = await createSessionWithToken(prisma, 3600);

    // First successful rotation – get a sibling token.
    const firstRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshToken.token })
      .expect(200);

    const siblingToken = firstRes.body.refreshToken;

    // Replay the *original* token (now retired) – should revoke the whole session.
    const replayRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshToken.token })
      .expect(401);

    // Now trying to use the sibling token must also fail.
    const siblingRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: siblingToken })
      .expect(401);
    expect(siblingRes.body.error).toBeDefined();
  });

  it('rotation does not extend absolute session deadline', async () => {
    // Session lifetime = 5 minutes, refresh token TTL = 10 minutes (configured env)
    const shortLifetime = 5 * 60; // 5 minutes
    const { refreshToken, session } = await createSessionWithToken(prisma, shortLifetime);

    // Override env for this test to a longer refresh TTL.
    process.env.REFRESH_TTL_SECONDS = (10 * 60).toString();

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshToken.token })
      .expect(200);

    // The new refresh token must expire at session.expiresAt, not later.
    const newToken = await prisma.refreshToken.findUnique({
      where: { token: res.body.refreshToken },
    });
    expect(newToken).toBeDefined();
    expect(newToken!.expiresAt.getTime()).toBe(session.expiresAt.getTime());
  });

  it('all rejection responses have identical shape', async () => {
    // Unknown token
    const unknownRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'nonexistent' })
      .expect(401);
    // Missing token
    const missingRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(401);
    // Expired token
    const { refreshToken } = await createSessionWithToken(prisma, 1); // 1 sec ttl
    // wait for expiry
    await new Promise((r) => setTimeout(r, 2000));
    const expiredRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshToken.token })
      .expect(401);

    const shape = (obj: any) => ({
      error: {
        code: expect.any(String),
        message: expect.any(String),
        details: expect.any(Object),
      },
    });

    expect(unknownRes.body).toMatchObject(shape(unknownRes.body));
    expect(missingRes.body).toMatchObject(shape(missingRes.body));
    expect(expiredRes.body).toMatchObject(shape(expiredRes.body));
  });
});
```

### SECURITY.md
```markdown
# Security considerations for refresh‑token rotation

1. **Order of checks** – The service validates the presented token **after** it
   has been retrieved from the database but **before** any state mutation.
   The sequence is:
   - Presence of the token.
   - Whether the token is already retired (replay detection).
   - Token expiration.
   - Session revocation status.
   - Session absolute expiration.

   This ordering guarantees that a compromised (already‑retired) token
   immediately triggers session revocation, preventing an attacker from using any
   sibling tokens that were issued before the compromise was observed.

2. **Atomic rotation** – The retirement of the old token and creation of the
   new token are performed in a single database transaction guarded by a
   conditional `UPDATE ... WHERE retiredAt IS NULL`.  This ensures that, under
   concurrent requests, at most one request can succeed in rotating the token.
   All other concurrent requests will observe the token as retired and will be
   treated as a replay, leading to session revocation.

3. **Absolute session deadline** – The `expiresAt` of a session is set once at
   sign‑in and never altered by token rotation.  When a new refresh token is
   issued its expiry is the **minimum** of the configured refresh‑token TTL and
   the session’s absolute deadline, preventing a token from extending the
   session’s lifetime.

4. **Uniform error envelope** – All failure responses are indistinguishable to
   the client (`invalid_refresh_token`).  The server records the precise cause
   (`unknown`, `expired`, `replay_detected`, `session_expired`, etc.) in the
   `TokenAudit` table, enabling forensic analysis without leaking implementation
   details.

5. **Compromise handling** – Upon detection of a replayed (already‑retired)
   token, the whole session is revoked (`revokedAt` is set).  This invalidates
   every refresh token that belongs to the same session, mitigating the impact
   of token theft.

6. **Source of the token** – If both the JSON body field `refreshToken` and the
   `refresh_token` cookie are supplied, the cookie value takes precedence.
   This deterministic rule avoids ambiguity and aligns with the typical
   “cookie‑over‑body” precedence used by browsers.

7. **Audit trail** – Every operation (rotation, replay detection, expiration,
   unknown token) creates a row in `TokenAudit`.  The `event` field records the
   exact reason, while the generic client‑facing error remains constant.

By adhering to this sequence and employing atomic database operations, the
system guarantees **exactly‑once** rotation under concurrency, fast compromise
containment, and a clear, auditable security posture.
```
