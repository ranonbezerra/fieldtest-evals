import { beforeEach, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { HttpException } from '@nestjs/common';
import type { AccessTokenIssuer } from '../src/auth/access-token-issuer.js';
import type { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService, type Clock, type RefreshOutcome } from '../src/auth/auth.service.js';

const GRACE_MS = 5_000;

/**
 * In-memory stand-in for AuthRepository. It emulates the one behaviour the
 * database provides — the atomic conditional claim in `claimActiveToken` —
 * and keeps the state the service's decisions must produce.
 */
class FakeRepository {
  readonly sessions: Array<{
    id: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  }> = [];
  readonly tokens: Array<{
    id: string;
    sessionId: string;
    userId: string;
    tokenHash: string;
    status: 'ACTIVE' | 'RETIRED';
    createdAt: Date;
    retiredAt: Date | null;
    expiresAt: Date;
  }> = [];
  readonly audits: Array<{
    event: string;
    userId?: string;
    sessionId?: string;
    tokenId?: string;
    details: Record<string, unknown>;
  }> = [];
  private counter = 0;

  async createSessionWithInitialToken(input: { userId: string; expiresAt: Date; tokenHash: string }) {
    const session = {
      id: `session-${++this.counter}`,
      userId: input.userId,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null as Date | null,
    };
    this.sessions.push(session);
    this.tokens.push({
      id: `token-${++this.counter}`,
      sessionId: session.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      status: 'ACTIVE',
      createdAt: new Date(),
      retiredAt: null,
      expiresAt: input.expiresAt,
    });
    return session;
  }

  async findTokenByHash(tokenHash: string) {
    const token = this.tokens.find((t) => t.tokenHash === tokenHash);
    return token ? { ...token } : null;
  }

  /** The atomic claim: check-and-set, so exactly one caller can win. */
  async claimActiveToken(tokenId: string, now: Date): Promise<boolean> {
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token || token.status !== 'ACTIVE' || token.expiresAt.getTime() <= now.getTime()) {
      return false;
    }
    token.status = 'RETIRED';
    token.retiredAt = now;
    return true;
  }

  async invalidateSession(sessionId: string, now: Date): Promise<number> {
    let count = 0;
    for (const token of this.tokens) {
      if (token.sessionId === sessionId && token.status === 'ACTIVE') {
        token.status = 'RETIRED';
        token.retiredAt = now;
        count += 1;
      }
    }
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session && session.revokedAt === null) {
      session.revokedAt = now;
    }
    return count;
  }

  async createRotatedToken(input: { sessionId: string; userId: string; expiresAt: Date; tokenHash: string }) {
    const token = {
      id: `token-${++this.counter}`,
      sessionId: input.sessionId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      status: 'ACTIVE' as const,
      createdAt: new Date(),
      retiredAt: null as Date | null,
      expiresAt: input.expiresAt,
    };
    this.tokens.push(token);
    return token;
  }

  async recordAudit(input: {
    event: string;
    userId?: string;
    sessionId?: string;
    tokenId?: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    this.audits.push({ ...input });
  }
}

function buildHarness() {
  const repository = new FakeRepository();
  const issuer: AccessTokenIssuer = {
    issueAccessToken: (userId: string) => `access-token-${userId}`,
  };
  let current = new Date('2025-06-01T00:00:00Z');
  const clock: Clock = () => current;
  const service = new AuthService(repository as unknown as AuthRepository, issuer, clock);
  return {
    repository,
    service,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

function requireSuccess(outcome: RefreshOutcome): Extract<RefreshOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error('expected the refresh to succeed');
  }
  return outcome;
}

function fakeResponse() {
  const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>): void {
      calls.push({ name, value, options });
    },
  } as unknown as Response;
  return { calls, response };
}

function cookieRequest(value: string): Request {
  return { headers: { cookie: `refresh_token=${encodeURIComponent(value)}` } } as unknown as Request;
}

function emptyRequest(): Request {
  return { headers: {} } as unknown as Request;
}

beforeEach(() => {
  process.env.REFRESH_REUSE_GRACE_MS = String(GRACE_MS);
});

describe('concurrent presentation of the same token', () => {
  it('lets exactly one request rotate, rejects the other, and keeps the session alive', async () => {
    const { repository, service } = buildHarness();
    const deadline = new Date('2025-06-01T01:00:00Z');
    const { refreshToken } = await service.createSession('user-1', deadline);

    const [first, second] = await Promise.all([service.refresh(refreshToken), service.refresh(refreshToken)]);
    const successes = [first, second].filter((o): o is Extract<RefreshOutcome, { ok: true }> => o.ok);

    expect(successes).toHaveLength(1);
    expect([first, second].filter((o) => !o.ok)).toHaveLength(1);

    const winner = successes[0];
    expect(winner.accessToken).toBe('access-token-user-1');
    expect(winner.expiresAt.toISOString()).toBe(deadline.toISOString());

    const session = repository.sessions[0];
    const active = repository.tokens.filter((t) => t.sessionId === session.id && t.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].expiresAt.toISOString()).toBe(deadline.toISOString());

    // the loser was audited as a benign in-flight duplicate, not as a compromise
    expect(repository.audits.some((a) => a.event === 'rejected_duplicate_retry')).toBe(true);
    expect(repository.audits.some((a) => a.event === 'rejected_reuse_detected')).toBe(false);
    expect(session.revokedAt).toBeNull();

    // the surviving token still rotates
    expect((await service.refresh(winner.refreshToken)).ok).toBe(true);
    expect(session.revokedAt).toBeNull();
  });
});

describe('reuse of a retired token', () => {
  it('invalidates the sibling token when a replay lands outside the grace window', async () => {
    const { repository, service, advance } = buildHarness();
    const deadline = new Date('2025-06-01T01:00:00Z');
    const { refreshToken: t0 } = await service.createSession('user-2', deadline);

    const r1 = requireSuccess(await service.refresh(t0));
    const t1 = r1.refreshToken;

    advance(GRACE_MS + 1_000);
    const replay = await service.refresh(t0);
    expect(replay.ok).toBe(false);

    const session = repository.sessions[0];
    expect(session.revokedAt).not.toBeNull();

    const [t0Record, t1Record] = repository.tokens;
    expect(t0Record.status).toBe('RETIRED');
    expect(t1Record.status).toBe('RETIRED'); // the sibling was invalidated

    const reuseEvent = repository.audits.find((a) => a.event === 'rejected_reuse_detected');
    expect(reuseEvent).toMatchObject({
      userId: 'user-2',
      sessionId: session.id,
      tokenId: t0Record.id,
      details: { invalidated_token_count: 1 },
    });

    // the invalidated sibling is dead for good
    advance(GRACE_MS + 1_000);
    const sibling = await service.refresh(t1);
    expect(sibling.ok).toBe(false);
    expect(repository.audits[repository.audits.length - 1].event).toBe('rejected_reuse_detected');
  });

  it('treats a replay inside the grace window as a benign retry, not a compromise', async () => {
    const { repository, service, advance } = buildHarness();
    const { refreshToken: t0 } = await service.createSession('user-3', new Date('2025-06-01T01:00:00Z'));
    const r1 = requireSuccess(await service.refresh(t0));

    advance(1_000);
    const replay = await service.refresh(t0);
    expect(replay.ok).toBe(false);
    expect(repository.audits.some((a) => a.event === 'rejected_duplicate_retry')).toBe(true);
    expect(repository.audits.some((a) => a.event === 'rejected_reuse_detected')).toBe(false);
    expect(repository.sessions[0].revokedAt).toBeNull();

    // the session still rotates normally
    expect((await service.refresh(r1.refreshToken)).ok).toBe(true);
  });
});

describe('absolute session deadline', () => {
  it('rotation never extends the deadline fixed at sign-in', async () => {
    const { repository, service, advance } = buildHarness();
    const deadline = new Date('2025-06-01T01:00:00Z');
    const created = await service.createSession('user-4', deadline);
    expect(created.expiresAt.toISOString()).toBe(deadline.toISOString());

    advance(1_700_000);
    const r1 = requireSuccess(await service.refresh(created.refreshToken));
    expect(r1.expiresAt.toISOString()).toBe(deadline.toISOString());

    advance(1_700_000);
    const r2 = requireSuccess(await service.refresh(r1.refreshToken));
    expect(r2.expiresAt.toISOString()).toBe(deadline.toISOString());

    for (const token of repository.tokens) {
      expect(token.expiresAt.toISOString()).toBe(deadline.toISOString());
    }

    // past the deadline: rejected as expired, and expiry is not a compromise
    advance(310_000);
    const past = await service.refresh(r2.refreshToken);
    expect(past.ok).toBe(false);
    expect(repository.audits.some((a) => a.event === 'rejected_expired_token')).toBe(true);
    expect(repository.sessions[0].revokedAt).toBeNull();
  });

  it('keeps rejecting an expired token as expired, never as reuse', async () => {
    const { repository, service, advance } = buildHarness();
    const { refreshToken } = await service.createSession('user-5', new Date('2025-06-01T00:30:00Z'));

    advance(3_600_000);
    const a = await service.refresh(refreshToken);
    const b = await service.refresh(refreshToken);

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(repository.audits.filter((e) => e.event === 'rejected_expired_token')).toHaveLength(2);
    expect(repository.audits.some((e) => e.event === 'rejected_reuse_detected')).toBe(false);
    expect(repository.sessions[0].revokedAt).toBeNull();
  });
});

describe('rejection responses', () => {
  it('returns the identical 401 envelope for malformed, unknown, expired and retired tokens', async () => {
    const { repository, service, advance } = buildHarness();
    const controller = new AuthController(service);
    const { response } = fakeResponse();

    const { refreshToken: expiredToken } = await service.createSession('user-6', new Date('2025-06-01T00:00:05Z'));
    const { refreshToken: t0 } = await service.createSession('user-7', new Date('2025-06-01T01:00:00Z'));
    requireSuccess(await service.refresh(t0));
    advance(10_000); // expiredToken is past its deadline; t0 is retired beyond the grace window

    const attempts: Array<() => Promise<unknown>> = [
      () => controller.refresh({ refreshToken: 'nope' }, emptyRequest(), response),
      () => controller.refresh({ refreshToken: 'f'.repeat(64) }, emptyRequest(), response),
      () => controller.refresh({ refreshToken: expiredToken }, emptyRequest(), response),
      () => controller.refresh({ refreshToken: t0 }, emptyRequest(), response),
      () => controller.refresh({}, emptyRequest(), response),
    ];

    const errors = await Promise.all(
      attempts.map((attempt) => attempt().then(() => null, (error: unknown) => error)),
    );

    expect(errors).toHaveLength(5);
    for (const error of errors) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toEqual({
        error: { code: 'refresh_rejected', message: expect.any(String), details: {} },
      });
    }
    const bodies = (errors as HttpException[]).map((e) => e.getResponse());
    for (const body of bodies.slice(1)) {
      expect(body).toEqual(bodies[0]);
    }

    // while the responses are identical, the audit trail distinguishes all of them
    const rejectionEvents = repository.audits.filter((a) => a.event.startsWith('rejected_')).map((a) => a.event);
    expect(rejectionEvents).toHaveLength(5);
    expect(rejectionEvents).toEqual(
      expect.arrayContaining([
        'rejected_malformed_token',
        'rejected_unknown_token',
        'rejected_expired_token',
        'rejected_reuse_detected',
      ]),
    );
  });

  it('prefers the body refreshToken over the refresh_token cookie when both are present', async () => {
    const { repository, service, advance } = buildHarness();
    const controller = new AuthController(service);
    const { calls, response } = fakeResponse();

    const { refreshToken: t0 } = await service.createSession('user-8', new Date('2025-06-01T01:00:00Z'));
    const r1 = requireSuccess(await service.refresh(t0));
    advance(GRACE_MS + 1_000); // the cookie's token is now retired beyond the grace window

    const outcome = await controller.refresh({ refreshToken: r1.refreshToken }, cookieRequest(t0), response);

    // success proves the body token was used; had the cookie won, the family would be invalidated
    expect(outcome.accessToken).toBe('access-token-user-8');
    expect(outcome.expiresAt).toBe('2025-06-01T01:00:00.000Z');
    expect(repository.sessions[0].revokedAt).toBeNull();
    expect(repository.audits.some((a) => a.event === 'rejected_reuse_detected')).toBe(false);

    // the cookie is re-issued with the fresh token, httpOnly and path-scoped
    const lastCookie = calls[calls.length - 1];
    expect(lastCookie).toMatchObject({
      name: 'refresh_token',
      value: outcome.refreshToken,
      options: { httpOnly: true, sameSite: 'strict', secure: true, path: '/auth' },
    });
  });

  it('treats a stale body token as authoritative even when a valid cookie is present', async () => {
    const { repository, service, advance } = buildHarness();
    const controller = new AuthController(service);
    const { response } = fakeResponse();

    const { refreshToken: t0 } = await service.createSession('user-9', new Date('2025-06-01T01:00:00Z'));
    const r1 = requireSuccess(await service.refresh(t0));
    advance(GRACE_MS + 1_000);

    await expect(controller.refresh({ refreshToken: t0 }, cookieRequest(r1.refreshToken), response)).rejects.toBeInstanceOf(HttpException);

    // body-wins: the stale body token is presented, so the whole family is invalidated
    expect(repository.sessions[0].revokedAt).not.toBeNull();
    expect(repository.audits.some((a) => a.event === 'rejected_reuse_detected')).toBe(true);
    const sibling = await service.refresh(r1.refreshToken);
    expect(sibling.ok).toBe(false);
  });
});
