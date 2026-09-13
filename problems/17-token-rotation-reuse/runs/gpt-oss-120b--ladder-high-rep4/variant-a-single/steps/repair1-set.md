# repair1-set

## reasoning

```
We need to adjust imports for ESM: need .js extensions and import types. Likely add .js to local imports and to utils token. Also need to install types for express, uuid, but we can import from 'node:crypto' and use import crypto from 'node:crypto'? In repo they used crypto import without .js causing error? Need .js extension: import crypto from 'crypto' -> should be 'node:crypto' or 'crypto' with .js? In ESM, need './utils/token.js' etc. Also need to add import type for Express types via @types/express not present, but can use import type { Request, Response } from 'express' still error because no types. Might need to add // @ts-ignore? Simpler: replace express imports with from 'express' but add .js? No. Probably need to add "type": "module" causing need extensions for relative imports only. So fix relative imports to include .js. Files: auth.controller.ts imports './auth.service' -> should be './auth.service.js'. Also import from 'express' need to add .js? It's package, not needed. But TS can't find module 'express' types; we can add a stub: create a declaration? But easier: change import to import type { Request, Response } from 'express'; but still need types. Maybe we can replace with any: import { Request, Response } from 'express'; error remains. Could add a dev dependency not possible. So we can create a minimal local mock module named 'express' with types. But simpler: change to import { Request, Response } from 'express'; but add // @ts-ignore? Not allowed. Better: use import type from 'express' but TS still needs types. Could declare module 'express' in a .d.ts file. Add a file src/express.d.ts with minimal types. That would satisfy imports. Same for uuid: need types, we can similarly create a declaration module 'uuid' exporting v4 function. Add src/uuid.d.ts. Also need crypto.randomBytes property; using import crypto from 'crypto' gives type Crypto which doesn't have randomBytes static. Should import * as crypto from 'crypto'; then crypto.randomBytes works. So adjust imports in repository and test.

Implement changes: modify src/auth/auth.repository.ts import crypto from 'crypto' to import * as crypto from 'crypto'. Similarly test file uses crypto.randomBytes; need import * as crypto from 'crypto'.

Add .js extensions to relative imports in controller, module, service, repository.

Create src/express.d.ts and src/uuid.d.ts with minimal types.

Return changed files.
```

## reply

### src/auth/auth.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

/**
 * Refresh endpoint.
 *
 * The refresh token can be supplied either in the JSON body (`refreshToken`)
 * or in a `refresh_token` HTTP‑only cookie.
 *
 * **Precedence**: If both are present, the value from the request body wins.
 *
 * All error responses are indistinguishable to the client and conform to the
 * shared error envelope.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Extract token with documented precedence.
    const tokenFromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const tokenFromCookie = typeof req?.cookies?.refresh_token === 'string' ? req.cookies.refresh_token : undefined;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    try {
      const { accessToken, refreshToken: newRefreshToken } =
        await this.authService.refresh(refreshToken);

      // Return the new refresh token as an HTTP‑only cookie.
      res.cookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        // The cookie expiration mirrors the absolute session deadline.
        // (Clients should treat the token itself as the source of truth.)
      });

      // Return the access token in the response body.
      res.status(HttpStatus.OK).json({ accessToken });
    } catch (err) {
      // All failures map to a single, generic error response.
      const errorResponse = {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token.',
          details: {},
        },
      };
      res.status(HttpStatus.UNAUTHORIZED).json(errorResponse);
    }
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [PrismaService, AuthRepository, AuthService],
})
export class AuthModule {}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RefreshToken } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a refresh‑token record by its opaque token value.
   *
   * @param token The token string as supplied by the client.
   * @returns The matching `RefreshToken` or `null` if none exists.
   */
  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  /**
   * Atomically retires a token *iff* it is still active (not revoked).
   *
   * The operation is performed as a single `UPDATE … WHERE revoked = false`
   * statement; Prisma translates this to an `UPDATE ... WHERE ...` that returns
   * the number of affected rows.
   *
   * @param tokenId The primary key of the token to retire.
   * @param now The timestamp at which the revocation occurs.
   * @returns `true` if the token was successfully retired, `false` otherwise.
   */
  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
    return result.count === 1;
  }

  /**
   * Revokes *all* active tokens belonging to the same family (i.e. all
   * descendants of the original sign‑in). This is used when a reused token is
   * detected.
   *
   * @param familyId Identifier for the token family.
   * @param now The timestamp at which the revocation occurs.
   */
  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
  }

  /**
   * Persists a newly issued refresh token.
   *
   * @param userId The identifier of the token owner.
   * @param familyId Identifier for the token family (inherited from the parent token).
   * @param expiresAt Absolute expiry timestamp for the session (unchanged across rotations).
   * @returns The freshly created `RefreshToken` record.
   */
  async createRefreshToken(
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        familyId,
        expiresAt,
        createdAt: now,
        // `revoked` defaults to false; `revokedAt` stays null.
      },
    });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { issueAccessToken } from '../utils/token.js';
import { RefreshToken } from '@prisma/client';

/**
 * Specific error used internally to indicate a failure of the refresh flow.
 * The controller deliberately hides the concrete `code` from the client.
 */
class RefreshTokenError extends Error {
  constructor(public readonly code: string, public readonly details: any = {}) {
    super(code);
  }
}

/**
 * AuthService contains the business logic for refresh‑token rotation.
 * It performs the following steps (in order):
 *
 * 1. Input validation (malformed token).
 * 2. Lookup the token record.
 * 3. Reuse detection (token already revoked) – this is checked *before* expiry.
 * 4. Expiry check.
 * 5. Atomic retirement of the presented token.
 * 6. On success: issue a new refresh token (same family, same absolute deadline)
 *    and a new access token.
 * 7. On any failure: record an audit event and throw a `RefreshTokenError`.
 *
 * All audit events are logged via `recordAudit`. In production this would be
 * persisted to a dedicated audit store; for the purpose of this exercise a
 * simple `console.log` is sufficient.
 */
@Injectable()
export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Performs a refresh‑token rotation.
   *
   * @param tokenString The raw refresh token supplied by the client.
   * @returns An object containing a fresh access token and a fresh refresh token.
   * @throws RefreshTokenError on any validation, lookup, or rotation failure.
   */
  async refresh(
    tokenString: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. Input validation (malformed token)
    if (!tokenString || typeof tokenString !== 'string') {
      this.recordAudit('malformed_token', { token: tokenString });
      throw new RefreshTokenError('malformed_token');
    }

    // 2. Lookup token record
    const tokenRecord: RefreshToken | null =
      await this.authRepository.findByToken(tokenString);
    const now = new Date();

    if (!tokenRecord) {
      // Unknown token
      this.recordAudit('unknown_token', { token: tokenString });
      throw new RefreshTokenError('unknown_token');
    }

    // 3. Reuse detection (token already revoked) – checked before expiry
    if (tokenRecord.revoked) {
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_revoked_token', {
        token: tokenString,
        userId: tokenRecord.userId,
        familyId: tokenRecord.familyId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 4. Expiry check (only after confirming the token is not already revoked)
    if (tokenRecord.expiresAt <= now) {
      this.recordAudit('expired_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_expired');
    }

    // 5. Atomic retirement of the presented token
    const retired = await this.authRepository.revokeIfActive(
      tokenRecord.id,
      now,
    );

    if (!retired) {
      // The token was retired between the lookup and this point – treat as reuse.
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_concurrent_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 6. Successful rotation – issue a new refresh token with the *same* absolute deadline.
    const newRefresh = await this.authRepository.createRefreshToken(
      tokenRecord.userId,
      tokenRecord.familyId,
      tokenRecord.expiresAt,
    );

    const accessToken = issueAccessToken(tokenRecord.userId);

    this.recordAudit('refresh_success', {
      userId: tokenRecord.userId,
      oldToken: tokenString,
      newToken: newRefresh.token,
      familyId: tokenRecord.familyId,
    });

    return {
      accessToken,
      refreshToken: newRefresh.token,
    };
  }

  /**
   * Simple audit hook – in a real system this would write to a structured audit
   * store. For the purpose of the exercise we use `console.log`.
   *
   * @param event A short string identifying the audit event.
   * @param details Arbitrary JSON‑serialisable data giving context.
   */
  private recordAudit(event: string, details: any): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, details }));
  }
}
```

### test/auth.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { RefreshToken } from '@prisma/client';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

/**
 * In‑memory fake repository implementing the same contract as `AuthRepository`.
 * It stores tokens in a `Map<string, RefreshToken>` keyed by the token string.
 *
 * This allows us to test the business logic without a real PostgreSQL instance.
 */
class FakeAuthRepository implements Partial<AuthRepository> {
  private tokensById = new Map<string, RefreshToken>();
  private tokensByValue = new Map<string, RefreshToken>();

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.tokensByValue.get(token) ?? null;
  }

  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const token = this.tokensById.get(tokenId);
    if (token && !token.revoked) {
      token.revoked = true;
      token.revokedAt = now;
      // Ensure maps stay in sync
      this.tokensById.set(tokenId, token);
      this.tokensByValue.set(token.token, token);
      return true;
    }
    return false;
  }

  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    for (const token of this.tokensById.values()) {
      if (token.familyId === familyId && !token.revoked) {
        token.revoked = true;
        token.revokedAt = now;
        this.tokensById.set(token.id, token);
        this.tokensByValue.set(token.token, token);
      }
    }
  }

  async createRefreshToken(
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const tokenString = `rt-${crypto.randomBytes(16).toString('hex')}`;
    const now = new Date();
    const token: RefreshToken = {
      id: uuidv4(),
      token: tokenString,
      userId,
      familyId,
      expiresAt,
      createdAt: now,
      revoked: false,
      revokedAt: null,
    };
    this.tokensById.set(token.id, token);
    this.tokensByValue.set(token.token, token);
    return token;
  }

  // Helper for tests: directly insert a token into the store.
  insertToken(token: Partial<RefreshToken>) {
    const full: RefreshToken = {
      id: token.id ?? uuidv4(),
      token: token.token ?? `rt-${crypto.randomBytes(16).toString('hex')}`,
      userId: token.userId ?? 'user-test',
      familyId: token.familyId ?? uuidv4(),
      expiresAt: token.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: token.createdAt ?? new Date(),
      revoked: token.revoked ?? false,
      revokedAt: token.revokedAt ?? null,
    };
    this.tokensById.set(full.id, full);
    this.tokensByValue.set(full.token, full);
    return full;
  }
}

/**
 * Minimal mock of an Express response object that records status,
 * JSON payload, and cookies set by the controller.
 */
class MockResponse {
  statusCode: number = 200;
  body: any = null;
  cookies: Record<string, any> = {};

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    return this;
  }

  cookie(name: string, value: any, options: any) {
    this.cookies[name] = { value, options };
    return this;
  }
}

describe('AuthModule – refresh‑token rotation', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let authController: AuthController;
  let fakeRepo: FakeAuthRepository;

  beforeEach(async () => {
    fakeRepo = new FakeAuthRepository();

    moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: AuthRepository,
          useValue: fakeRepo,
        },
      ],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    authController = moduleRef.get<AuthController>(AuthController);
  });

  it('allows exactly one of two concurrent refreshes to succeed', async () => {
    // Arrange: a single active refresh token.
    const original = fakeRepo.insertToken({
      token: 'original-token',
      familyId: 'family-1',
      userId: 'user-1',
    });

    // Act: launch two refresh attempts concurrently.
    const p1 = authService.refresh('original-token');
    const p2 = authService.refresh('original-token');
    const results = await Promise.allSettled([p1, p2]);

    // Assert: only one promise fulfilled.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The successful result should contain a new refresh token.
    const success = fulfilled[0] as PromiseFulfilledResult<{
      accessToken: string;
      refreshToken: string;
    }>;
    expect(typeof success.value.refreshToken).toBe('string');
    expect(success.value.refreshToken).not.toBe('original-token');

    // After both calls, the family should be fully revoked (new token also revoked).
    const familyTokens = Array.from(fakeRepo['tokensById'].values()).filter(
      (t) => t.familyId === original.familyId,
    );
    for (const t of familyTokens) {
      expect(t.revoked).toBe(true);
    }
  });

  it('invalidates sibling tokens when a reused token is presented', async () => {
    // Arrange: two sibling tokens in the same family.
    const familyId = 'family-2';
    const tokenA = fakeRepo.insertToken({
      token: 'token-A',
      familyId,
      userId: 'user-2',
    });
    const tokenB = fakeRepo.insertToken({
      token: 'token-B',
      familyId,
      userId: 'user-2',
    });

    // First, rotate using token A – should succeed and produce token C.
    const first = await authService.refresh('token-A');
    const tokenC = await fakeRepo.findByToken(first.refreshToken);
    expect(tokenC).not.toBeNull();
    expect(tokenC?.revoked).toBe(false);

    // Now, present the already‑retired token A again (reuse).
    await expect(authService.refresh('token-A')).rejects.toThrow();

    // All tokens in the family (B and C) must now be revoked.
    const tokenBAfter = await fakeRepo.findByToken('token-B');
    const tokenCAfter = await fakeRepo.findByToken(first.refreshToken);
    expect(tokenBAfter?.revoked).toBe(true);
    expect(tokenCAfter?.revoked).toBe(true);
  });

  it('preserves the absolute deadline across rotations', async () => {
    const absoluteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const original = fakeRepo.insertToken({
      token: 'deadline-token',
      familyId: 'family-3',
      userId: 'user-3',
      expiresAt: absoluteExpiry,
    });

    const result = await authService.refresh('deadline-token');
    const newToken = await fakeRepo.findByToken(result.refreshToken);
    expect(newToken).not.toBeNull();
    expect(newToken?.expiresAt.getTime()).toBe(absoluteExpiry.getTime());
  });

  it('returns an identical error response for all rejection cases', async () => {
    // Helper to invoke the controller and capture the JSON payload.
    async function invokeController(
      bodyToken?: string,
      cookieToken?: string,
    ): Promise<{ status: number; body: any }> {
      const mockReq = {
        body: bodyToken ? { refreshToken: bodyToken } : {},
        cookies: cookieToken ? { refresh_token: cookieToken } : {},
      } as Request;
      const mockRes = new MockResponse() as unknown as Response;
      await authController.refresh(
        (mockReq as unknown) as Request,
        (mockRes as unknown) as Response,
      );
      return { status: mockRes.statusCode, body: mockRes.body };
    }

    // 1. Missing token (malformed)
    const missing = await invokeController();
    // 2. Unknown token
    const unknown = await invokeController('nonexistent-token');
    // 3. Expired token
    const expiredToken = fakeRepo.insertToken({
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000), // already past
      familyId: 'family-4',
      userId: 'user-4',
    });
    const expired = await invokeController('expired-token');
    // 4. Reuse (present a revoked token)
    const revokedToken = fakeRepo.insertToken({
      token: 'revoked-token',
      revoked: true,
      revokedAt: new Date(),
      familyId: 'family-5',
      userId: 'user-5',
    });
    const reused = await invokeController('revoked-token');

    // All responses must be identical (status code & body shape).
    const expected = missing.body;
    expect(missing.status).toBe(401);
    expect(unknown.body).toEqual(expected);
    expect(expired.body).toEqual(expected);
    expect(reused.body).toEqual(expected);
  });

  it('gives precedence to the token in the request body over the cookie', async () => {
    // Insert both tokens into the fake store.
    const bodyToken = fakeRepo.insertToken({
      token: 'body-token',
      familyId: 'family-6',
      userId: 'user-6',
    });
    const cookieToken = fakeRepo.insertToken({
      token: 'cookie-token',
      familyId: 'family-6',
      userId: 'user-6',
    });

    // The controller should use the body token.
    const mockReq = {
      body: { refreshToken: 'body-token' },
      cookies: { refresh_token: 'cookie-token' },
    } as Request;
    const mockRes = new MockResponse() as unknown as Response;

    await authController.refresh(
      (mockReq as unknown) as Request,
      (mockRes as unknown) as Response,
    );

    // The response must contain a new refresh token derived from the body token.
    expect(mockRes.statusCode).toBe(200);
    const responseBody = mockRes.body as { accessToken: string };
    expect(responseBody).toHaveProperty('accessToken');

    // Verify that the cookie token is untouched (still active).
    const untouched = await fakeRepo.findByToken('cookie-token');
    expect(untouched?.revoked).toBe(false);
  });
});
```

### src/express.d.ts
```ts
declare module 'express' {
  import { IncomingMessage, ServerResponse } from 'http';
  import { ParsedUrlQuery } from 'querystring';
  import { CookieOptions } from 'express-serve-static-core';

  export interface Request<P = any, ResBody = any, ReqBody = any, Query = ParsedUrlQuery>
    extends IncomingMessage {
    body?: ReqBody;
    cookies?: Record<string, string>;
    query?: Query;
    params?: P;
  }

  export interface Response<ResBody = any, Locals extends Record<string, any> = Record<string, any>>
    extends ServerResponse {
    status(code: number): this;
    json: (body: any) => this;
    cookie(name: string, value: any, options?: CookieOptions): this;
  }
}
```

### src/uuid.d.ts
```ts
declare module 'uuid' {
  export function v4(options?: any, buffer?: any, offset?: number): string;
}
```
