import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthService, hashRefreshToken } from '../src/auth/auth.service.js';
import type { RefreshOutcome } from '../src/auth/auth.service.js';

/**
 * Integration tests against a real PostgreSQL. Point DATABASE_URL at a
 * scratch database and apply the initial migration first:
 *   pnpm prisma migrate deploy
 */

// Short per-token TTL so the absolute-deadline test can prove that rotation
// never extends the sign-in deadline.
process.env.REFRESH_TOKEN_TTL_SECONDS = '100';

const prisma = new PrismaClient();

let app: INestApplication;
let service: AuthService;

beforeAll(async () => {
  await prisma.$connect();
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  service = moduleRef.get(AuthService);
});

beforeEach(async () => {
  await prisma.refreshAuditEvent.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.tokenFamily.deleteMany();
});

afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

async function seedSession(userId: string, sessionMs: number): Promise<{ raw: string; familyId: string }> {
  const raw = await service.issueInitialRefreshToken(userId, new Date(Date.now() + sessionMs));
  const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(raw) } });
  return { raw, familyId: row.familyId };
}

function rotatedToken(outcome: RefreshOutcome): string {
  if (!outcome.ok) throw new Error('expected a successful rotation');
  return outcome.refreshToken;
}

describe('refresh rotation with reuse detection', () => {
  it('lets exactly one of two concurrent rotations of the same token win, records the loser as reuse and kills the family', async () => {
    const { raw, familyId } = await seedSession('user_race', 60_000);

    // Genuinely concurrent: both promises are in flight before either completes.
    const [a, b] = await Promise.all([service.refresh(raw, null), service.refresh(raw, null)]);
    const winners = [a, b].filter((r): r is Extract<RefreshOutcome, { ok: true }> => r.ok);
    expect(winners).toHaveLength(1);

    const winner = winners[0];
    expect(winner.accessToken.length).toBeGreaterThan(0);
    expect(winner.refreshToken).not.toBe(raw);

    const audits = await prisma.refreshAuditEvent.findMany();
    expect(audits.filter((e) => e.reason === 'REJECTED_REUSED')).toHaveLength(1);

    const family = await prisma.tokenFamily.findUniqueOrThrow({ where: { id: familyId } });
    expect(family.revoked).toBe(true);

    // The winner's successor token is descended from the same sign-in, so the
    // reuse event killed it too.
    expect((await service.refresh(winner.refreshToken, null)).ok).toBe(false);
  });

  it('treats a replay of a retired token as reuse and revokes every descendant', async () => {
    const { raw: original, familyId } = await seedSession('user_replay', 60_000);

    const first = await service.refresh(original, null);
    expect(first.ok).toBe(true);
    const second = rotatedToken(first);

    const secondRotation = await service.refresh(second, null);
    expect(secondRotation.ok).toBe(true);
    const third = rotatedToken(secondRotation);

    // Replay the original token: it has been retired, so this is reuse, and
    // every token descended from the same sign-in must be revoked — not just
    // its direct child.
    const replay = await service.refresh(original, null);
    expect(replay.ok).toBe(false);

    const tokens = await prisma.refreshToken.findMany({ where: { familyId } });
    expect(tokens).toHaveLength(3);
    const grandchild = tokens.find((t) => t.tokenHash === hashRefreshToken(third));
    expect(grandchild?.status).toBe('REVOKED');

    const family = await prisma.tokenFamily.findUniqueOrThrow({ where: { id: familyId } });
    expect(family.revoked).toBe(true);

    const reuseAudit = (await prisma.refreshAuditEvent.findMany()).find((e) => e.reason === 'REJECTED_REUSED');
    expect(reuseAudit?.tokensRevoked).toBeGreaterThanOrEqual(1);
    expect(reuseAudit?.familyId).toBe(familyId);
  });

  it('caps rotated tokens at the absolute sign-in deadline and never extends it', async () => {
    const deadline = new Date(Date.now() + 20_000); // far shorter than the 100s token TTL
    const raw = await service.issueInitialRefreshToken('user_deadline', deadline);

    const first = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(raw) } });
    expect(first.expiresAt.getTime()).toBe(deadline.getTime());

    const rotated = await service.refresh(raw, null);
    expect(rotated.ok).toBe(true);
    const second = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(rotatedToken(rotated)) },
    });

    // The successor cannot outlive the sign-in deadline, even though the
    // token TTL is far longer than the remaining session life.
    expect(second.expiresAt.getTime()).toBe(deadline.getTime());

    const family = await prisma.tokenFamily.findUniqueOrThrow({ where: { id: first.familyId } });
    expect(family.expiresAt.getTime()).toBe(deadline.getTime());
  });

  it('rejects a refresh once the absolute deadline has passed', async () => {
    const raw = await service.issueInitialRefreshToken('user_expired', new Date(Date.now() - 1_000));
    expect((await service.refresh(raw, null)).ok).toBe(false);

    const audit = (await prisma.refreshAuditEvent.findMany())[0];
    expect(audit?.reason).toBe('REJECTED_EXPIRED');
  });

  it('handles a token that is both retired and expired as reuse, not expiry', async () => {
    const family = await prisma.tokenFamily.create({
      data: { userId: 'user_both', expiresAt: new Date(Date.now() - 1_000) },
    });
    const raw = 'rt_reused_and_expired_00000000000000000000000001';
    const token = await prisma.refreshToken.create({
      data: {
        familyId: family.id,
        tokenHash: hashRefreshToken(raw),
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 500),
      },
    });
    // Retire it so it is both retired and expired.
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { status: 'RETIRED', retiredAt: new Date() },
    });

    expect((await service.refresh(raw, null)).ok).toBe(false);

    const audit = (await prisma.refreshAuditEvent.findMany())[0];
    expect(audit?.reason).toBe('REJECTED_REUSED');
    expect(audit?.tokensRevoked).toBe(0); // nothing was left alive to revoke

    const fam = await prisma.tokenFamily.findUniqueOrThrow({ where: { id: family.id } });
    expect(fam.revoked).toBe(true);
  });

  it('returns one identical 401 body for expired, retired, unknown and malformed, while the audit distinguishes all four', async () => {
    const server = app.getHttpServer();

    const malformed = await request(server).post('/auth/refresh').send({});

    const unknown = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: 'rt_never_issued_000000000000000000000000000001' });

    const expiredRaw = await service.issueInitialRefreshToken('user_http_expired', new Date(Date.now() - 1_000));
    const expired = await request(server).post('/auth/refresh').send({ refreshToken: expiredRaw });

    const { raw } = await seedSession('user_http_reused', 60_000);
    expect((await service.refresh(raw, null)).ok).toBe(true); // rotate it away first
    const retired = await request(server).post('/auth/refresh').send({ refreshToken: raw });

    for (const res of [malformed, unknown, expired, retired]) {
      expect(res.status).toBe(401);
    }

    const expectedBody = {
      error: { code: 'refresh_token_invalid', message: 'The refresh token is not valid.', details: {} },
    };
    for (const res of [malformed, unknown, expired, retired]) {
      expect(res.body).toEqual(expectedBody);
    }

    const reasons = (await prisma.refreshAuditEvent.findMany()).map((e) => e.reason).sort();
    expect(reasons).toEqual(['REJECTED_EXPIRED', 'REJECTED_MALFORMED', 'REJECTED_REUSED', 'REJECTED_UNKNOWN']);
  });

  it('accepts the token from the body, from the cookie, and lets the body win when both are present', async () => {
    const server = app.getHttpServer();

    const bodySession = await seedSession('user_body', 60_000);
    const cookieSession = await seedSession('user_cookie', 60_000);

    // Both channels present: the body token is rotated; the cookie token must
    // be left untouched.
    const both = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: bodySession.raw })
      .set('cookie', `refresh_token=${cookieSession.raw}`)
      .expect(200);
    expect(both.body.accessToken.length).toBeGreaterThan(0);
    expect(both.body.refreshToken).not.toBe(bodySession.raw);

    const bodyRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(bodySession.raw) },
    });
    expect(bodyRow.status).toBe('RETIRED');
    const cookieRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(cookieSession.raw) },
    });
    expect(cookieRow.status).toBe('ACTIVE');

    // The successor is echoed back as an HttpOnly cookie.
    const rawHeader = both.headers['set-cookie'] as string | string[] | undefined;
    const setCookie = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader ?? '';
    expect(setCookie).toContain('refresh_token=');
    expect(setCookie).toContain('HttpOnly');

    // Cookie alone is also accepted.
    const cookieOnly = await seedSession('user_cookie_only', 60_000);
    await request(server).post('/auth/refresh').set('cookie', `refresh_token=${cookieOnly.raw}`).expect(200);
    const cookieOnlyRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(cookieOnly.raw) },
    });
    expect(cookieOnlyRow.status).toBe('RETIRED');
  });
});
