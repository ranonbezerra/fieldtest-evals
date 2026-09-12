import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma.service';
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

describe('Auth Refresh Token Rotation', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let authRepository: AuthRepository;
  let prisma: PrismaService;
  let user: any;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    authRepository = moduleRef.get<AuthRepository>(AuthRepository);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await prisma.refreshTokenAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    // Create a user for the tests
    user = await prisma.user.create({
      data: {
        email: `test${Date.now()}@example.com`,
        // Adjust fields according to the actual User model if necessary
      },
    });
  });

  it('exactly one of two concurrent refreshes may rotate', async () => {
    const tokenValue = randomUUID();
    await authRepository.createRefreshToken({
      token: tokenValue,
      userId: user.id,
      parentId: null,
      rootId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    const p1 = authService.refresh(tokenValue);
    const p2 = authService.refresh(tokenValue);
    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const success = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(success).toHaveProperty('accessToken');
    expect(success).toHaveProperty('refreshToken');

    // After both calls, no active tokens should remain (family invalidated)
    const activeTokens = await prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        retiredAt: null,
      },
    });
    expect(activeTokens).toHaveLength(0);

    const reuseAudits = await prisma.refreshTokenAudit.findMany({
      where: {
        event: 'reuse',
      },
    });
    expect(reuseAudits.length).toBeGreaterThanOrEqual(1);
  });

  it('replay of a retired token invalidates the whole family', async () => {
    const rootToken = randomUUID();
    await authRepository.createRefreshToken({
      token: rootToken,
      userId: user.id,
      parentId: null,
      rootId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // First rotation
    const res1 = await authService.refresh(rootToken);
    const token1 = res1.refreshToken;

    // Second rotation
    const res2 = await authService.refresh(token1);
    const token2 = res2.refreshToken;

    // Reuse of token1 (already retired)
    await expect(authService.refresh(token1)).rejects.toThrow(HttpException);

    // All tokens in the family should now be retired
    const active = await prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        retiredAt: null,
      },
    });
    expect(active).toHaveLength(0);

    // Subsequent use of token2 should also be rejected
    await expect(authService.refresh(token2)).rejects.toThrow(HttpException);
  });

  it('rotation does not extend absolute session deadline', async () => {
    const absoluteExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const rootToken = randomUUID();
    await authRepository.createRefreshToken({
      token: rootToken,
      userId: user.id,
      parentId: null,
      rootId: null,
      issuedAt: new Date(),
      expiresAt: absoluteExpiry,
    });

    const res = await authService.refresh(rootToken);
    const newToken = res.refreshToken;

    const newRecord = await prisma.refreshToken.findUnique({
      where: { token: newToken },
    });
    expect(newRecord).not.toBeNull();
    expect(newRecord?.expiresAt.getTime()).toBe(absoluteExpiry.getTime());
  });

  it('rejection responses are indistinguishable across failure types', async () => {
    // Malformed token
    const malformed = 'not-a-uuid';

    // Unknown token (valid UUID but not stored)
    const unknown = randomUUID();

    // Expired token
    const expiredToken = randomUUID();
    await authRepository.createRefreshToken({
      token: expiredToken,
      userId: user.id,
      parentId: null,
      rootId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // already expired
    });

    // Reuse token (retired)
    const reuseToken = randomUUID();
    await authRepository.createRefreshToken({
      token: reuseToken,
      userId: user.id,
      parentId: null,
      rootId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // Retire it manually to simulate reuse
    await prisma.refreshToken.update({
      where: { token: reuseToken },
      data: { retiredAt: new Date() },
    });

    const attempts = [
      () => authService.refresh(malformed),
      () => authService.refresh(unknown),
      () => authService.refresh(expiredToken),
      () => authService.refresh(reuseToken),
    ];

    const responses: any[] = [];

    for (const fn of attempts) {
      try {
        await fn();
      } catch (e) {
        if (e instanceof HttpException) {
          responses.push(e.getResponse());
        } else {
          throw e;
        }
      }
    }

    expect(responses).toHaveLength(4);
    const first = responses[0];
    for (const resp of responses) {
      expect(resp).toEqual(first);
    }
  });
});
