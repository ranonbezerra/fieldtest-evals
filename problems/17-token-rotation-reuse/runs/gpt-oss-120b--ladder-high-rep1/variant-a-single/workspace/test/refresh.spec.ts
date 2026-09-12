import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/refresh/refresh.module.js';
import { RefreshService } from '../src/refresh/refresh.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { InvalidRefreshTokenException } from '../src/refresh/invalid-refresh-token.exception.js';
import { PrismaClient, RefreshToken } from '@prisma/client';
import * as crypto from 'crypto';
import { fail } from 'vitest';

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
