// Integration tests for POST /auth/refresh.
// Requires a PostgreSQL reachable via DATABASE_URL with the Prisma migrations
// applied (pnpm db:migrate).
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { RefreshModule } from '../src/refresh/refresh.module';
import { REFRESH_CLOCK, RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';

const SESSION_TTL_MS = 60_000;

// The one envelope every rejection must produce (expired, retired, unknown,
// malformed): same status (asserted per case), same body, same Set-Cookie.
const REJECTION = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh', () => {
  let prisma: PrismaClient;
  let repository: RefreshTokenRepository;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    process.env.REFRESH_SESSION_TTL_SECONDS = String(SESSION_TTL_MS / 1000);

    prisma = new PrismaClient();
    repository = new RefreshTokenRepository();
    nowMs = Date.now();

    const moduleRef = await Test.createTestingModule({
      imports: [RefreshModule],
    })
      .overrideProvider(REFRESH_CLOCK)
      .useValue(() => new Date(nowMs))
      .overrideProvider(RefreshTokenRepository)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RefreshService);
  });

  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await repository.onModuleDestroy();
    await prisma.$disconnect();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/refresh').send(body);

  const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', `refresh_token=${cookieToken}`)
      .send(body);

  it('rotates a valid token: fresh pair returned, presented token retired', async () => {
    const session = await service.issueSession('user-rotate');

    const res = await post({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect((res.headers['set-cookie'] ?? []).join()).toContain('refresh_token=rt_');

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);
  });

  it('rotates exactly once when one valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [first, second] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 401]);

    const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(ok.body.refreshToken).toEqual(expect.any(String));
    expect(ok.body.refreshToken).not.toBe(session.refreshToken);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual(REJECTION);

    // The losing presentation landed on an already-retired token, so the whole
    // family from this sign-in is quarantined: nothing can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const kinds = (
      await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId } })
    ).map((event) => event.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('invalidates the live sibling when a retired token is replayed', async () => {
    const session = await service.issueSession('user-replay');

    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const sibling = rotated.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);

    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(REJECTION);
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' },
    });
    expect(reuse).not.toBeNull();
    expect((reuse?.details ?? {}) as { detectedVia?: string }).toHaveProperty('detectedVia', 'presented_retired');
  });

  it('rotates up to the absolute deadline fixed at sign-in, and never extends it', async () => {
    const session = await service.issueSession('user-deadline');
    const deadline = session.expiresAt.getTime();
    expect(deadline).toBe(nowMs + SESSION_TTL_MS);

    nowMs += SESSION_TTL_MS - 1_000;
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    // Rotation did not move the deadline.
    const stored = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(stored?.expiresAt.getTime()).toBe(deadline);

    // A token issued 1s before the deadline still dies at the deadline.
    nowMs += 2_000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(REJECTION);

    const expired = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' },
    });
    expect(expired).not.toBeNull();
  });

  it('answers malformed, unknown, retired and expired with the identical 401', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const liveToken = rotated.body.refreshToken as string;

    const malformed = await post({ refreshToken: 'nope' });
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    const retired = await post({ refreshToken: session.refreshToken });

    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: liveToken });

    for (const res of [malformed, unknown, retired, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION);
      expect(res.headers['set-cookie']).toBeDefined();
    }
    expect(new Set([malformed, unknown, retired, expired].map((res) => JSON.stringify(res.body))).size).toBe(1);

    // The audit log, in contrast, tells the four apart.
    const kinds = (await prisma.securityEvent.findMany()).map((event) => event.kind);
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');

    const res = await postWithCookie(session.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
  });

  it('prefers the body token over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-precedence-body');
    const cookieSession = await service.issueSession('user-precedence-cookie');

    const res = await postWithCookie(cookieSession.refreshToken, { refreshToken: bodySession.refreshToken });
    expect(res.status).toBe(200);

    // The body token was the one rotated, so it is now retired...
    expect((await post({ refreshToken: bodySession.refreshToken })).status).toBe(401);
    // ...and the cookie token was left untouched.
    expect((await post({ refreshToken: cookieSession.refreshToken })).status).toBe(200);
  });

  it('treats an invalid body token as authoritative, even with a valid cookie', async () => {
    const session = await service.issueSession('user-precedence-invalid');

    const res = await postWithCookie(session.refreshToken, { refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);

    // A malformed presentation quarantines nothing: the cookie token is alive.
    expect((await post({ refreshToken: session.refreshToken })).status).toBe(200);
  });

  it('rejects a request that carries no token at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
  });
});
