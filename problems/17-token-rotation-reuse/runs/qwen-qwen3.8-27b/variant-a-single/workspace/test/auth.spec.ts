import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';

// Requires a migrated PostgreSQL reachable via DATABASE_URL (see
// prisma/migrations). The concurrency test needs a real database, not a mock.
const prisma = new PrismaClient();

let app: INestApplication;
let auth: AuthService;
let baseUrl = '';

const USER = 'user-under-test';

function wellFormedRandomToken(): string {
  return randomBytes(48).toString('base64url');
}

// The one rejection body every failure mode must produce (error envelope).
const REJECTION_BODY = {
  error: {
    code: 'invalid_refresh_token',
    message: 'The presented refresh token could not be used to refresh the session.',
    details: {},
  },
};

interface RefreshResponse {
  status: number;
  body: unknown;
  setCookie: string | null;
}

async function postRefresh(opts: { bodyToken?: unknown; cookieToken?: string } = {}): Promise<RefreshResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookieToken !== undefined) {
    headers.cookie = `refresh_token=${opts.cookieToken}`;
  }
  const res = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.bodyToken !== undefined ? { refreshToken: opts.bodyToken } : {}),
  });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.tokenAuditEvent.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.refreshFamily.deleteMany({});
});

describe('POST /auth/refresh', () => {
  it('permits exactly one rotation when the same token is presented concurrently', async () => {
    const { refreshToken } = await auth.createSession(USER, 60_000);

    const [first, second] = await Promise.all([
      postRefresh({ bodyToken: refreshToken }),
      postRefresh({ bodyToken: refreshToken }),
    ]);

    const ok = [first, second].filter((r) => r.status === 200);
    const rejected = [first, second].filter((r) => r.status === 401);

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body).toEqual(REJECTION_BODY);

    const winner = ok[0].body as { accessToken: string; refreshToken: string };
    expect(winner.accessToken).toBeTypeOf('string');
    expect(winner.accessToken.length).toBeGreaterThan(0);
    expect(winner.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(winner.refreshToken).not.toBe(refreshToken);

    // The loser presented a token that was already retired, which the
    // design treats as reuse: the whole family is revoked, no exception
    // for races.
    const family = await prisma.refreshFamily.findFirst({ where: { userId: USER } });
    expect(family).not.toBeNull();
    expect(family!.revoked).toBe(true);

    const tokens = await prisma.refreshToken.findMany({ where: { familyId: family!.id } });
    expect(tokens).toHaveLength(2); // exactly one successor was ever issued
    expect(tokens.every((t) => t.retired)).toBe(true);

    const reuseEvents = await prisma.tokenAuditEvent.findMany({ where: { reason: 'rejected_reuse' } });
    expect(reuseEvents).toHaveLength(1);
  });

  it('invalidates the live sibling when a retired token is replayed', async () => {
    const { refreshToken: original } = await auth.createSession(USER, 60_000);

    const rotated = await postRefresh({ bodyToken: original });
    expect(rotated.status).toBe(200);
    const successor = (rotated.body as { refreshToken: string }).refreshToken;
    expect(rotated.setCookie).toContain('refresh_token=');

    const replay = await postRefresh({ bodyToken: original });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION_BODY);

    // The live sibling that the rotation just issued is dead too.
    const sibling = await postRefresh({ bodyToken: successor });
    expect(sibling.status).toBe(401);
    expect(sibling.body).toEqual(REJECTION_BODY);

    const family = await prisma.refreshFamily.findFirst({ where: { userId: USER } });
    expect(family).not.toBeNull();
    expect(family!.revoked).toBe(true);

    const tokens = await prisma.refreshToken.findMany({ where: { familyId: family!.id } });
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.retired)).toBe(true);

    const reuseEvents = await prisma.tokenAuditEvent.findMany({ where: { reason: 'rejected_reuse' } });
    expect(reuseEvents).toHaveLength(1);
  });

  it('copies the absolute deadline into the successor and rejects after it passes', async () => {
    const { refreshToken: original, expiresAt } = await auth.createSession(USER, 3_600_000);

    const rotated = await postRefresh({ bodyToken: original });
    expect(rotated.status).toBe(200);

    const tokens = await prisma.refreshToken.findMany();
    expect(tokens).toHaveLength(2);
    const retiredToken = tokens.find((t) => t.retired);
    const liveToken = tokens.find((t) => !t.retired);
    expect(retiredToken).not.toBeNull();
    expect(liveToken).not.toBeNull();
    expect(retiredToken!.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(liveToken!.expiresAt.getTime()).toBe(expiresAt.getTime()); // not extended
    expect(retiredToken!.replacedBy).toBe(liveToken!.id);

    const { refreshToken: shortLived } = await auth.createSession('user-short-lived', 120);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const late = await postRefresh({ bodyToken: shortLived });
    expect(late.status).toBe(401);
    expect(late.body).toEqual(REJECTION_BODY);

    // Expiry is benign: the family is NOT treated as compromised.
    const shortFamily = await prisma.refreshFamily.findFirst({ where: { userId: 'user-short-lived' } });
    expect(shortFamily).not.toBeNull();
    expect(shortFamily!.revoked).toBe(false);
  });

  it('returns one identical rejection body for every failure mode', async () => {
    const { refreshToken } = await auth.createSession(USER, 60_000);
    const rotated = await postRefresh({ bodyToken: refreshToken });
    expect(rotated.status).toBe(200);

    const { refreshToken: expiring } = await auth.createSession('user-expiring', 120);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const responses = [
      await postRefresh({ bodyToken: 'not-a-valid-token' }), // malformed
      await postRefresh({ bodyToken: wellFormedRandomToken() }), // unknown
      await postRefresh({}), // nothing presented at all
      await postRefresh({ bodyToken: expiring }), // expired
      await postRefresh({ bodyToken: refreshToken }), // retired (replay)
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual(REJECTION_BODY);
    }
    for (let i = 1; i < responses.length; i += 1) {
      expect(JSON.stringify(responses[i].body)).toBe(JSON.stringify(responses[0].body));
    }

    // ...while the audit distinguishes all of them.
    const audits = await prisma.tokenAuditEvent.findMany();
    const rejectionReasons = audits
      .filter((a) => a.reason.startsWith('rejected_'))
      .map((a) => a.reason)
      .sort();
    expect(rejectionReasons).toEqual([
      'rejected_expired',
      'rejected_malformed',
      'rejected_malformed',
      'rejected_reuse',
      'rejected_unknown',
    ]);
  });

  it('prefers the JSON body over the refresh_token cookie when both are present', async () => {
    const { refreshToken } = await auth.createSession(USER, 60_000);

    // A garbage body token and a live cookie must fail: the body wins.
    const clash = await postRefresh({ bodyToken: 'garbage-value', cookieToken: refreshToken });
    expect(clash.status).toBe(401);
    expect(clash.body).toEqual(REJECTION_BODY);

    const malformed = await prisma.tokenAuditEvent.findFirst({ where: { reason: 'rejected_malformed' } });
    expect(malformed).not.toBeNull();
    expect((malformed!.details as unknown as { source: string }).source).toBe('body');

    // The live cookie alone still rotates, and the new token is returned
    // via Set-Cookie as well.
    const cookieOnly = await postRefresh({ cookieToken: refreshToken });
    expect(cookieOnly.status).toBe(200);
    expect(cookieOnly.setCookie).toContain('refresh_token=');
    expect(cookieOnly.setCookie).toContain('HttpOnly');
  });
});
