# repair2-set

## reasoning

```
Let me analyze the two errors:

1. `src/auth/auth.repository.ts(118,9)`: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue | undefined'. This is the `details` field in `recordAudit`. The `details` is typed as `Json` in Prisma, which expects `InputJsonValue`. I need to cast it to `Prisma.InputJsonValue`.

2. `test/auth.spec.ts(129,35)`: Argument of type 'FakeRepository' is not assignable to parameter of type 'AuthRepository'. The `FakeRepository` doesn't have a `prisma` property. The issue is that `AuthService` constructor likely expects `AuthRepository` type, but the test passes a `FakeRepository`. 

Let me look at the test more carefully. The test creates `new AuthService(repository, issuer, clock)` where `repository` is a `FakeRepository`. The `AuthService` constructor must be typed to accept `AuthRepository` specifically.

The fix for the test: I need to either:
- Change `AuthService` to accept an interface that `FakeRepository` satisfies, OR
- Cast the `FakeRepository` in the test

Wait, the instructions say "Change exactly what the compiler requires" and "Change the caller unless the definition is the thing the errors say is wrong."

The error says `FakeRepository` is not assignable to `AuthRepository`. The `AuthService` constructor takes `AuthRepository` as a parameter type. The `FakeRepository` in the test doesn't extend `AuthRepository` and doesn't have the `prisma` property.

The cleanest fix that doesn't change the architecture: In the test, I can cast `repository` to `AuthRepository` when passing it to `AuthService`. But wait, let me look at what `AuthService` expects.

Looking at the test:
```ts
const service = new AuthService(repository, issuer, clock);
```

The `AuthService` constructor signature likely is:
```ts
constructor(private readonly repository: AuthRepository, private readonly issuer: AccessTokenIssuer, private readonly clock: Clock)
```

The fix options:
1. Make `AuthService` accept a structural interface (the methods it actually calls) rather than the concrete `AuthRepository` class.
2. Cast in the test: `new AuthService(repository as unknown as AuthRepository, issuer, clock)`

Option 2 is the minimal fix that doesn't change the source code structure. But it's a bit ugly.

Option 1 would mean extracting an interface from `AuthRepository` that `FakeRepository` satisfies. But the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise."

Actually, let me re-read: "Change the caller unless the definition is the thing the errors say is wrong."

The definition here is `AuthRepository` (the class). The error says `FakeRepository` is not assignable to it. The "caller" is the test. So I should change the test to cast.

But wait - if I look at what methods `AuthService` actually calls on the repository, it uses: `createSessionWithInitialToken`, `findTokenByHash`, `claimActiveToken`, `invalidateSession`, `createRotatedToken`, `recordAudit`. The `FakeRepository` has all of these. The only issue is that `AuthRepository` has a `private readonly prisma: PrismaService` constructor property.

The minimal fix: In the test, cast `repository` when passing to `AuthService`.

Actually, let me think about this differently. The cleanest approach that's minimal:

For error 1: Cast `input.details` to `Prisma.InputJsonValue` in the repository's `recordAudit` method.

For error 2: In the test, cast `repository` to `AuthRepository` when constructing `AuthService`.

Let me write the fixes:

**src/auth/auth.repository.ts** - line 118 is in `recordAudit`:
```ts
details: input.details,
```
needs to become:
```ts
details: input.details as Prisma.InputJsonValue,
```

**test/auth.spec.ts** - line 129 is where `new AuthService(repository, issuer, clock)` is called:
```ts
const service = new AuthService(repository, issuer, clock);
```
needs to become:
```ts
const service = new AuthService(repository as unknown as AuthRepository, issuer, clock);
```

But I need to import `AuthRepository` in the test file. Let me check the test imports... Currently it imports:
```ts
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService, type Clock, type RefreshOutcome } from '../src/auth/auth.service.js';
```

I'd need to add `AuthRepository` to the imports. Let me add it.

Wait, actually I could also just do `repository as any` but that's worse. Let me use `as unknown as AuthRepository`.

Let me write out the complete files.

For `src/auth/auth.repository.ts`, I just need to change line 118 from:
```ts
details: input.details,
```
to:
```ts
details: input.details as Prisma.InputJsonValue,
```

For `test/auth.spec.ts`, I need to:
1. Add `AuthRepository` to the imports
2. Change line 129 to cast

Let me write the complete files now.
```

## reply

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, TokenStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

/** A refresh token row as the rest of the app consumes it. */
export interface StoredToken {
  id: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: Date;
  retiredAt: Date | null;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuditInput {
  event: string;
  userId?: string;
  sessionId?: string;
  tokenId?: string;
  details: Record<string, unknown>;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the session and its first (initial) refresh token atomically. */
  async createSessionWithInitialToken(input: {
    userId: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<SessionRecord> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.refreshSession.create({
        data: { userId: input.userId, expiresAt: input.expiresAt },
      });
      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      return session;
    });
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Atomically retires `tokenId` if — and only if — it is still active and its
   * absolute deadline has not passed. A single conditional UPDATE: Postgres
   * row locking guarantees that exactly one concurrent caller can win.
   */
  async claimActiveToken(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, status: TokenStatus.ACTIVE, expiresAt: { gt: now } },
      data: { status: TokenStatus.RETIRED, retiredAt: now },
    });
    return result.count > 0;
  }

  /**
   * Compromise handling: retires every active token in the session and marks
   * the session revoked. Returns how many tokens were invalidated.
   */
  async invalidateSession(sessionId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.refreshToken.updateMany({
        where: { sessionId, status: TokenStatus.ACTIVE },
        data: { status: TokenStatus.RETIRED, retiredAt: now },
      });
      await tx.refreshSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      return result.count;
    });
  }

  /** Mints the next token in the session's chain, inheriting the absolute deadline. */
  async createRotatedToken(input: {
    sessionId: string;
    userId: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<StoredToken> {
    return this.prisma.refreshToken.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.prisma.authAuditEvent.create({
      data: {
        event: input.event,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        tokenId: input.tokenId ?? null,
        details: input.details as Prisma.InputJsonValue,
      },
    });
  }
}
```

### test/auth.spec.ts
```ts
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
```
