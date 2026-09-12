import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  INVALID_REFRESH_TOKEN_RESPONSE,
  RefreshController,
  RefreshResponse,
} from '../src/refresh/refresh.controller.js';
import { RefreshService } from '../src/refresh/refresh.service.js';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository.js';

type FulfilledResult = { status: 'fulfilled'; value: RefreshResponse };
type RejectedResult = { status: 'rejected'; reason: unknown };

const prisma = new PrismaClient();
const repository = new RefreshTokenRepository(prisma);
const service = new RefreshService(repository, {
  issueAccessToken: (userId: string) => `access.${userId}`,
});
const controller = new RefreshController(service);

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface CreateTokenOptions {
  value: string;
  userId?: string;
  familyId?: string;
  expiresAt?: Date;
  retiredAt?: Date | null;
  reusedAt?: Date | null;
  predecessorId?: string | null;
}

async function createToken(options: CreateTokenOptions) {
  return prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(options.value),
      userId: options.userId ?? 'user-1',
      familyId: options.familyId ?? `family-${options.value}`,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      retiredAt: options.retiredAt ?? null,
      reusedAt: options.reusedAt ?? null,
      predecessorId: options.predecessorId ?? null,
      createdAt: new Date(),
    },
  });
}

async function captureRejection(promise: Promise<unknown>): Promise<UnauthorizedException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    return error as UnauthorizedException;
  }

  throw new Error('Expected the refresh request to be rejected');
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.refreshAudit.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/refresh', () => {
  it('rotates exactly once when the same token is presented concurrently', async () => {
    await createToken({
      value: 'concurrent',
      userId: 'user-1',
      familyId: 'family-concurrent',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const results = await Promise.allSettled([
      controller.refresh({ refreshToken: 'concurrent' }, undefined),
      controller.refresh({ refreshToken: 'concurrent' }, undefined),
    ]);

    const fulfilled = results.filter(
      (result): result is FulfilledResult => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is RejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const firstFulfilled = fulfilled[0];
    const firstRejected = rejected[0];
    if (!firstFulfilled || !firstRejected) {
      throw new Error('Expected one fulfilled and one rejected result');
    }

    const success = firstFulfilled.value;
    expect(success.accessToken).toBe('access.user-1');
    expect(success.refreshToken).not.toBe('concurrent');

    const failure = firstRejected.reason as UnauthorizedException;
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(failure.getStatus()).toBe(401);
    expect(failure.getResponse()).toEqual(INVALID_REFRESH_TOKEN_RESPONSE);

    const tokens = await prisma.refreshToken.findMany({ where: { familyId: 'family-concurrent' } });
    expect(tokens).toHaveLength(2);

    const original = tokens.find((token) => token.tokenHash === hashToken('concurrent'));
    const successor = tokens.find((token) => token.tokenHash === hashToken(success.refreshToken));

    expect(original).toBeDefined();
    expect(successor).toBeDefined();
    expect(original?.retiredAt).not.toBeNull();
    expect(successor?.retiredAt).not.toBeNull();
    expect(successor?.reusedAt).not.toBeNull();

    const audits = await prisma.refreshAudit.findMany({ where: { familyId: 'family-concurrent' } });
    expect(audits.map((audit) => audit.reason).sort()).toEqual(['rotated', 'retired'].sort());
  });

  it('invalidates a sibling token when a retired token is replayed', async () => {
    await createToken({
      value: 'old',
      userId: 'user-2',
      familyId: 'family-replay',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await controller.refresh({ refreshToken: 'old' }, undefined);
    const second = await captureRejection(controller.refresh({ refreshToken: 'old' }, undefined));

    expect(second.getStatus()).toBe(401);
    expect(second.getResponse()).toEqual(INVALID_REFRESH_TOKEN_RESPONSE);

    const tokens = await prisma.refreshToken.findMany({ where: { familyId: 'family-replay' } });
    expect(tokens).toHaveLength(2);

    const sibling = tokens.find((token) => token.tokenHash === hashToken(first.refreshToken));
    expect(sibling).toBeDefined();
    expect(sibling?.retiredAt).not.toBeNull();
    expect(sibling?.reusedAt).not.toBeNull();

    const audits = await prisma.refreshAudit.findMany({ where: { familyId: 'family-replay' } });
    expect(
      audits.some((audit) => audit.event === 'reuse_detected' && audit.reason === 'retired'),
    ).toBe(true);
  });

  it('rejects expired tokens and never extends the absolute deadline', async () => {
    await createToken({
      value: 'expired',
      userId: 'user-3',
      familyId: 'family-expired',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const error = await captureRejection(controller.refresh({ refreshToken: 'expired' }, undefined));
    expect(error.getResponse()).toEqual(INVALID_REFRESH_TOKEN_RESPONSE);

    const expiredTokens = await prisma.refreshToken.findMany({
      where: { familyId: 'family-expired' },
    });
    expect(expiredTokens).toHaveLength(1);

    const expiredAudits = await prisma.refreshAudit.findMany({
      where: { familyId: 'family-expired' },
    });
    expect(expiredAudits.map((audit) => audit.reason)).toEqual(['expired']);

    const deadline = new Date(Date.now() + 123_456);
    await createToken({
      value: 'deadline',
      userId: 'user-3',
      familyId: 'family-deadline',
      expiresAt: deadline,
    });

    const rotated = await controller.refresh({ refreshToken: 'deadline' }, undefined);
    const successor = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rotated.refreshToken) },
    });
    const original = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken('deadline') },
    });

    expect(successor).not.toBeNull();
    expect(original).not.toBeNull();
    expect(successor?.expiresAt.getTime()).toBe(deadline.getTime());
    expect(successor?.predecessorId).toBe(original?.id);
  });

  it('returns the same rejection envelope for malformed, unknown, expired, and retired tokens', async () => {
    const malformed = await captureRejection(
      controller.refresh({ refreshToken: '' }, undefined),
    );
    const unknown = await captureRejection(
      controller.refresh({ refreshToken: `missing-${randomUUID()}` }, undefined),
    );

    await createToken({
      value: 'expired-compare',
      userId: 'user-4',
      familyId: 'family-expired-compare',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const expired = await captureRejection(
      controller.refresh({ refreshToken: 'expired-compare' }, undefined),
    );

    await createToken({
      value: 'retired-compare',
      userId: 'user-4',
      familyId: 'family-retired-compare',
      expiresAt: new Date(Date.now() + 60_000),
      retiredAt: new Date(),
    });
    const retired = await captureRejection(
      controller.refresh({ refreshToken: 'retired-compare' }, undefined),
    );

    for (const error of [malformed, unknown, expired, retired]) {
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toEqual(INVALID_REFRESH_TOKEN_RESPONSE);
    }

    const audits = await prisma.refreshAudit.findMany({ orderBy: { createdAt: 'asc' } });
    expect(audits.map((audit) => audit.reason).sort()).toEqual(
      ['malformed', 'unknown', 'expired', 'retired'].sort(),
    );
  });

  it('prefers a non-empty body refreshToken over the refresh_token cookie', async () => {
    await createToken({
      value: 'body',
      userId: 'user-5',
      familyId: 'family-precedence',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createToken({
      value: 'cookie',
      userId: 'user-5',
      familyId: 'family-precedence-cookie',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await controller.refresh({ refreshToken: 'body' }, 'refresh_token=cookie');

    const bodyRow = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken('body') },
    });
    const cookieRow = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken('cookie') },
    });

    expect(bodyRow).not.toBeNull();
    expect(cookieRow).not.toBeNull();
    expect(bodyRow?.retiredAt).not.toBeNull();
    expect(cookieRow?.retiredAt).toBeNull();
    expect(result.accessToken).toBe('access.user-5');
  });
});
