import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { ArgumentsHost } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';

import { AuthService, type RefreshResult } from '../src/auth/auth.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { StubAccessTokenIssuer } from '../src/auth/access-token.provider.js';
import { RefreshRejectedError } from '../src/auth/refresh-rejected.error.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

const prisma = new PrismaClient();

const MIGRATION_SQL = new URL(
  '../prisma/migrations/20250601000000_refresh_rotation/migration.sql',
  import.meta.url,
);

function newService(): AuthService {
  return new AuthService(new AuthRepository(prisma), new StubAccessTokenIssuer());
}

function randomToken(): string {
  return randomBytes(48).toString('base64url');
}

async function seedSession(opts: { familyAgeMs?: number; tokenTtlMs?: number } = {}) {
  const now = Date.now();
  const family = await prisma.refreshFamily.create({
    data: {
      userId: 'user-1',
      absoluteExpiryAt: new Date(now + (opts.familyAgeMs ?? 30 * 86_400_000)),
    },
  });
  const token = await prisma.refreshToken.create({
    data: {
      token: randomToken(),
      familyId: family.id,
      expiresAt: new Date(now + (opts.tokenTtlMs ?? 3_600_000)),
    },
  });
  return { family, token };
}

async function auditEvents(familyId?: string) {
  return prisma.refreshAuditEvent.findMany({ where: familyId ? { familyId } : undefined });
}

async function expectRejection(call: () => Promise<RefreshResult>): Promise<RefreshRejectedError> {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(RefreshRejectedError);
    return error as RefreshRejectedError;
  }
  throw new Error('expected the refresh call to be rejected');
}

/** Push one rejection through the app's filter and capture the HTTP result. */
function envelopeFor(error: unknown) {
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(error, host);
  return { status, body };
}

function cookieRequest(token: string): Request {
  return { headers: { cookie: `refresh_token=${encodeURIComponent(token)}` } } as unknown as Request;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL instance to run these tests.');
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(`Cannot reach PostgreSQL at DATABASE_URL: ${String(error)}`);
  }
  // Apply the shipped migration if the schema is not there yet (PG 13+ for
  // gen_random_uuid()).
  try {
    await prisma.refreshFamily.count();
  } catch {
    const sql = readFileSync(MIGRATION_SQL, 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "refresh_tokens", "refresh_families", "refresh_audit_events" CASCADE',
  );
});

describe('refresh-token rotation (POST /auth/refresh)', () => {
  it('lets exactly one of several concurrent presentations of one token rotate', async () => {
    const { family, token } = await seedSession();
    const service = newService();

    // Genuinely concurrent: five in-flight refreshes of the same token.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.refresh(token.token)),
    );
    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<RefreshResult> => o.status === 'fulfilled',
    );
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const outcome of rejected) {
      expect(outcome.reason).toBeInstanceOf(RefreshRejectedError);
    }

    const winner = fulfilled[0].value;
    expect(winner.refreshToken).not.toBe(token.token);
    expect(winner.accessToken).toMatch(/^at_/);

    const original = await prisma.refreshToken.findUnique({ where: { token: token.token } });
    expect(original?.retired).toBe(true);

    // The losers presented a token that had just been retired, so each treated
    // it as reuse and revoked the family.
    const familyRow = await prisma.refreshFamily.findUnique({ where: { id: family.id } });
    expect(familyRow?.revokedAt).not.toBeNull();
    const familyTokens = await prisma.refreshToken.findMany({ where: { familyId: family.id } });
    expect(familyTokens).toHaveLength(2); // original + exactly one successor

    // The winner's successor is unusable no matter which side of the
    // revocation it was minted on: presenting it must be rejected.
    await expectRejection(() => service.refresh(winner.refreshToken));

    const causes = (await auditEvents(family.id)).map((e) => e.cause);
    expect(causes.filter((c) => c === 'rotated')).toHaveLength(1);
    expect(causes.filter((c) => c === 'reuse').length).toBeGreaterThanOrEqual(4);
  });

  it('treats a replay of a retired token as compromise and invalidates its sibling', async () => {
    const { family, token } = await seedSession();
    const service = newService();

    const rotated = await service.refresh(token.token);
    await expectRejection(() => service.refresh(token.token)); // replay

    const sibling = await prisma.refreshToken.findUnique({ where: { token: rotated.refreshToken } });
    expect(sibling?.revoked).toBe(true);
    const familyRow = await prisma.refreshFamily.findUnique({ where: { id: family.id } });
    expect(familyRow?.revokedAt).not.toBeNull();

    const reuse = (await auditEvents(family.id)).filter((e) => e.cause === 'reuse');
    expect(reuse).toHaveLength(1);
    expect(reuse[0].familyId).toBe(family.id);
    expect(reuse[0].userId).toBe('user-1');
    expect(reuse[0].detail).toMatchObject({ state: 'retired' });

    // The invalidated sibling no longer works either.
    await expectRejection(() => service.refresh(rotated.refreshToken));
  });

  it('rotates against the absolute deadline fixed at sign-in and never extends it', async () => {
    const service = newService();
    const { family, token } = await seedSession();
    const originalDeadline = family.absoluteExpiryAt;

    let current = token.token;
    for (let i = 0; i < 3; i += 1) {
      current = (await service.refresh(current)).refreshToken;
    }
    const after = await prisma.refreshFamily.findUnique({ where: { id: family.id } });
    expect(after?.absoluteExpiryAt.getTime()).toBe(originalDeadline.getTime());

    // A family whose deadline passes mid-session: rotation succeeds while the
    // deadline is in the future, then a freshly rotated token is rejected as
    // expired — not reuse — once the deadline has passed.
    const near = await seedSession({ familyAgeMs: 2_000 });
    const mid = await service.refresh(near.token.token);
    expect(mid.refreshToken).not.toBe(near.token.token);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await expectRejection(() => service.refresh(mid.refreshToken));

    const causes = (await auditEvents(near.family.id)).map((e) => e.cause);
    expect(causes).toEqual(['rotated', 'expired']);
    const nearFamily = await prisma.refreshFamily.findUnique({ where: { id: near.family.id } });
    expect(nearFamily?.revokedAt).toBeNull(); // expiry does not invalidate the family
  });

  it('returns one indistinguishable rejection for malformed, unknown, expired and retired', async () => {
    const service = newService();
    const expiredSession = await seedSession({ familyAgeMs: -1_000 }); // deadline already passed
    const retiredSession = await seedSession();
    await service.refresh(retiredSession.token.token); // retires that token

    const cases: Array<[string, () => Promise<RefreshResult>]> = [
      ['malformed', () => service.refresh('')],
      ['unknown', () => service.refresh(randomToken())],
      ['expired', () => service.refresh(expiredSession.token.token)],
      ['retired', () => service.refresh(retiredSession.token.token)],
    ];

    const envelopes = await Promise.all(
      cases.map(async ([, call]) => envelopeFor(await expectRejection(call))),
    );

    for (const envelope of envelopes) {
      expect(envelope.status).toBe(401);
      expect(envelope.body).toEqual({
        error: {
          code: 'refresh_rejected',
          message: 'Refresh token is invalid or has expired.',
          details: {},
        },
      });
    }
    expect(new Set(envelopes.map((e) => JSON.stringify(e.body)))).toHaveLength(1);

    // The audit record distinguishes all four causes.
    const causes = (await auditEvents()).map((e) => e.cause);
    for (const cause of ['malformed', 'unknown', 'expired', 'reuse']) {
      expect(causes.filter((c) => c === cause)).toHaveLength(1);
    }
  });

  it('classifies a token that is both retired and expired as reuse, not expiry', async () => {
    const { family, token } = await seedSession();
    const service = newService();

    await service.refresh(token.token); // retires the presented token
    await prisma.refreshFamily.update({
      where: { id: family.id },
      data: { absoluteExpiryAt: new Date(Date.now() - 1_000) },
    }); // ...and the absolute deadline passes

    await expectRejection(() => service.refresh(token.token));

    const causes = (await auditEvents(family.id)).map((e) => e.cause);
    expect(causes).toEqual(['rotated', 'reuse']);
    expect(causes).not.toContain('expired');
  });

  it('accepts the token from the body or the cookie, with the body winning', async () => {
    const service = newService();
    const controller = new AuthController(service);
    const { token } = await seedSession();

    // Precedence: a bogus body token plus a real cookie must reject (the body
    // is presented, the cookie is ignored), and no cookie is set on failure.
    const failedRes = { cookie: vi.fn() };
    await expectRejection(() =>
      controller.refresh(
        { refreshToken: 'bogus' },
        cookieRequest(token.token),
        failedRes as unknown as Response,
      ),
    );
    expect(failedRes.cookie).not.toHaveBeenCalled();

    // No body token: the cookie token rotates, and the response updates the cookie.
    const res = { cookie: vi.fn() };
    const viaCookie = await controller.refresh(
      {},
      cookieRequest(token.token),
      res as unknown as Response,
    );
    expect(viaCookie.refreshToken).not.toBe(token.token);
    expect(viaCookie.accessToken).toMatch(/^at_/);
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      viaCookie.refreshToken,
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
