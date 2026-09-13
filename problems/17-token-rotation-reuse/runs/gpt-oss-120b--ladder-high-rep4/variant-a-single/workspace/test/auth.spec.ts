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
