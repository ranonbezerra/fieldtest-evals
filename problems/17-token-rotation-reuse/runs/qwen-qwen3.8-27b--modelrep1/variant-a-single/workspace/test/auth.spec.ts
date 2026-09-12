import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuthController } from '../src/auth/auth.controller.js';
import {
  AuthService,
  hashRefreshToken,
  type RefreshOutcome,
} from '../src/auth/auth.service.js';
import {
  type AuthRepositoryPort,
  type AuditEventInput,
  type RotateOutcome,
  type StoredSession,
  type StoredToken,
} from '../src/auth/auth.repository.js';

const BASE = Date.parse('2025-06-01T00:00:00.000Z');
const GRACE_MS = 5_000;
const HOUR = 3_600_000;

interface TokenRow {
  id: string;
  sessionId: string;
  tokenHash: string;
  status: 'active' | 'retired';
  retiredAt: Date | null;
  replacedByTokenId: string | null;
}

/**
 * In-memory stand-in for AuthRepository honouring the documented contract:
 * rotateToken is an atomic compare-and-swap (first caller wins) and
 * invalidateSession sweeps the whole lineage.
 */
class FakeAuthRepository implements AuthRepositoryPort {
  readonly sessions = new Map<string, StoredSession>();
  readonly tokens = new Map<string, TokenRow>();
  readonly events: AuditEventInput[] = [];

  async createSession(userId: string, expiresAt: Date): Promise<StoredSession> {
    const session: StoredSession = { id: randomUUID(), userId, expiresAt, revokedAt: null };
    this.sessions.set(session.id, session);
    return session;
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    for (const row of this.tokens.values()) {
      if (row.tokenHash === tokenHash) return this.viewOf(row);
    }
    return null;
  }

  async rotateToken(args: {
    tokenId: string;
    newTokenHash: string;
    retiredAt: Date;
  }): Promise<RotateOutcome> {
    const row = this.tokens.get(args.tokenId);
    if (!row || row.status !== 'active') {
      const session = row ? this.sessions.get(row.sessionId) : undefined;
      return { rotated: false, sessionRevokedAt: session?.revokedAt ?? null };
    }
    row.status = 'retired';
    row.retiredAt = args.retiredAt;
    const newId = randomUUID();
    this.tokens.set(newId, {
      id: newId,
      sessionId: row.sessionId,
      tokenHash: args.newTokenHash,
      status: 'active',
      retiredAt: null,
      replacedByTokenId: null,
    });
    row.replacedByTokenId = newId;
    return { rotated: true, newTokenId: newId };
  }

  async invalidateSession(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = at;
    for (const token of this.tokens.values()) {
      if (token.sessionId === sessionId && token.status === 'active') {
        token.status = 'retired';
        token.retiredAt = at;
      }
    }
  }

  async recordEvent(event: AuditEventInput): Promise<void> {
    this.events.push({ ...event });
  }

  /** Test fixture: mint an active token belonging to a session. */
  issueToken(sessionId: string): string {
    const value = randomBytes(32).toString('base64url');
    const id = randomUUID();
    this.tokens.set(id, {
      id,
      sessionId,
      tokenHash: hashRefreshToken(value),
      status: 'active',
      retiredAt: null,
      replacedByTokenId: null,
    });
    return value;
  }

  tokensOf(sessionId: string): TokenRow[] {
    return [...this.tokens.values()].filter((t) => t.sessionId === sessionId);
  }

  private viewOf(row: TokenRow): StoredToken {
    const session = this.sessions.get(row.sessionId);
    return {
      id: row.id,
      tokenHash: row.tokenHash,
      status: row.status,
      retiredAt: row.retiredAt,
      session: { ...session! },
    };
  }
}

interface Harness {
  repo: FakeAuthRepository;
  service: AuthService;
  controller: AuthController;
  setClock: (ms: number) => void;
  advance: (ms: number) => void;
}

function buildHarness(): Harness {
  let now = BASE;
  const repo = new FakeAuthRepository();
  const service = new AuthService(
    repo,
    (userId) => `access-for-${userId}`,
    () => new Date(now),
    { reuseGraceMs: GRACE_MS },
  );
  const controller = new AuthController(service);
  return {
    repo,
    service,
    controller,
    setClock: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

let h: Harness;
beforeEach(() => {
  h = buildHarness();
});

function eventKinds(): string[] {
  return h.repo.events.map((e) => e.eventType).sort();
}

function ok(outcome: RefreshOutcome): Extract<RefreshOutcome, { ok: true }> {
  expect(outcome.ok).toBe(true);
  return outcome as Extract<RefreshOutcome, { ok: true }>;
}

function rejected(outcome: RefreshOutcome): void {
  expect(outcome.ok).toBe(false);
}

function reqWith(cookie: string | undefined) {
  return { headers: { cookie } };
}

function fakeRes() {
  return {
    code: 200,
    body: undefined as unknown,
    cookieCalls: [] as Array<[string, string, Record<string, unknown>]>,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      this.cookieCalls.push([name, value, options ?? {}]);
      return this;
    },
  };
}

describe('refresh token rotation', () => {
  it('rotates a concurrently presented token exactly once', async () => {
    const session = await h.repo.createSession('u-race', new Date(BASE + HOUR));
    const token = h.repo.issueToken(session.id);

    // Hold both presentations at the lookup so each reads the token as still
    // active, then let them race the compare-and-swap.
    let reads = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const find = h.repo.findTokenByHash.bind(h.repo);
    h.repo.findTokenByHash = async (hash: string) => {
      const view = await find(hash); // captured before the gate
      reads += 1;
      if (reads === 2) release();
      await gate;
      return view;
    };

    const [first, second] = await Promise.all([
      h.service.refresh(token, false),
      h.service.refresh(token, false),
    ]);

    const winners = [first, second].filter((o) => o.ok);
    expect(winners).toHaveLength(1);
    const winner = winners[0] as Extract<RefreshOutcome, { ok: true }>;
    expect(winner.sessionExpiresAt.getTime()).toBe(session.expiresAt.getTime());

    // The session survived the race: the successor rotates normally.
    ok(await h.service.refresh(winner.refreshToken, false));
    expect(h.repo.sessions.get(session.id)?.revokedAt).toBeNull();

    // The loser was rejected as a benign duplicate, not a compromise.
    expect(eventKinds()).toEqual(['concurrent_duplicate', 'rotation', 'rotation']);
  });

  it('treats a replay of a retired token as compromise and kills the lineage', async () => {
    const session = await h.repo.createSession('u-replay', new Date(BASE + HOUR));
    const original = h.repo.issueToken(session.id);

    const rotated = ok(await h.service.refresh(original, false));
    const sibling = rotated.refreshToken;

    h.advance(GRACE_MS + 1_000); // well past the retry grace window
    rejected(await h.service.refresh(original, false));

    // The session is revoked and no token in the lineage survives.
    expect(h.repo.sessions.get(session.id)?.revokedAt).toBeInstanceOf(Date);
    expect(h.repo.tokensOf(session.id).every((t) => t.status === 'retired')).toBe(true);

    // The sibling token the rotation just issued is dead too.
    rejected(await h.service.refresh(sibling, false));

    expect(eventKinds()).toEqual(['concurrent_duplicate', 'reuse_detected', 'rotation']);
  });

  it('enforces the absolute deadline and never extends it by rotating', async () => {
    const deadline = BASE + HOUR;
    const session = await h.repo.createSession('u-deadline', new Date(deadline));
    const token = h.repo.issueToken(session.id);

    h.setClock(BASE + HOUR / 2);
    const first = ok(await h.service.refresh(token, false));
    expect(h.repo.sessions.get(session.id)?.expiresAt.getTime()).toBe(deadline);

    const second = ok(await h.service.refresh(first.refreshToken, false));
    expect(h.repo.sessions.get(session.id)?.expiresAt.getTime()).toBe(deadline);

    h.setClock(deadline + 1_000);
    rejected(await h.service.refresh(second.refreshToken, false));
    expect(eventKinds()).toEqual(['expired', 'rotation', 'rotation']);

    // Expiry denies rotation but does not retire the token itself, nor revoke.
    const active = h.repo.tokensOf(session.id).filter((t) => t.status === 'active');
    expect(active).toHaveLength(1);
    expect(h.repo.sessions.get(session.id)?.revokedAt).toBeNull();
  });

  it('answers every rejection with one identical 401 while auditing each differently', async () => {
    const expiredSession = await h.repo.createSession('u-expired', new Date(BASE + 1_000));
    const expiredToken = h.repo.issueToken(expiredSession.id);

    const retiredSession = await h.repo.createSession('u-retired', new Date(BASE + HOUR));
    const oldToken = h.repo.issueToken(retiredSession.id);
    ok(await h.service.refresh(oldToken, false)); // retires oldToken at BASE

    const unknownToken = randomBytes(32).toString('base64url');
    h.setClock(BASE + 10_000); // expired session lapsed; oldToken past the grace

    const present = async (body: unknown) => {
      const res = fakeRes();
      const returned = await h.controller.refresh(body, reqWith(undefined), res);
      return { code: res.code, body: res.body, returned };
    };

    const results = [
      await present({ refreshToken: 'not-a-token' }),
      await present({ refreshToken: unknownToken }),
      await present({ refreshToken: expiredToken }),
      await present({ refreshToken: oldToken }),
      await present({}),
    ];

    for (const r of results) {
      expect(r.returned).toBeUndefined();
      expect(r.code).toBe(401);
    }
    expect(results[1].body).toEqual(results[0].body);
    expect(results[2].body).toEqual(results[0].body);
    expect(results[3].body).toEqual(results[0].body);
    expect(results[4].body).toEqual(results[0].body);
    expect(results[0].body).toEqual({
      error: { code: 'invalid_refresh_token', message: 'The refresh token is invalid.', details: {} },
    });

    // The audit record distinguishes all rejection classes.
    const kinds = eventKinds();
    expect(kinds).toContain('malformed');
    expect(kinds).toContain('unknown');
    expect(kinds).toContain('expired');
    expect(kinds).toContain('reuse_detected');
  });

  it('retires the presented token and links its successor in the same call', async () => {
    const session = await h.repo.createSession('u-basic', new Date(BASE + HOUR));
    const original = h.repo.issueToken(session.id);

    const rotated = ok(await h.service.refresh(original, false));
    expect(rotated.accessToken).toBe('access-for-u-basic');
    expect(rotated.refreshToken).not.toBe(original);

    const rows = h.repo.tokensOf(session.id);
    expect(rows).toHaveLength(2);
    const oldRow = rows.find((t) => t.tokenHash === hashRefreshToken(original));
    const newRow = rows.find((t) => t.tokenHash === hashRefreshToken(rotated.refreshToken));
    expect(oldRow?.status).toBe('retired');
    expect(newRow?.status).toBe('active');
    expect(oldRow?.replacedByTokenId).toBe(newRow?.id);
  });

  it('lets the body token win over the cookie, and echoes the cookie only when used', async () => {
    const session = await h.repo.createSession('u-channel', new Date(BASE + HOUR));
    const bodyToken = h.repo.issueToken(session.id);
    const decoy = randomBytes(32).toString('base64url');

    const viaBody = fakeRes();
    const out = await h.controller.refresh(
      { refreshToken: bodyToken },
      reqWith(`refresh_token=${decoy}`),
      viaBody,
    );
    expect(out).toMatchObject({ accessToken: 'access-for-u-channel', refreshToken: expect.any(String) });
    expect(viaBody.cookieCalls).toHaveLength(0);
    // The decoy cookie was never even looked up: the body won.
    expect(h.repo.events.some((e) => e.tokenHash === hashRefreshToken(decoy))).toBe(false);
    expect(
      h.repo.events.some((e) => e.eventType === 'rotation' && e.sessionId === session.id),
    ).toBe(true);

    const cookieSession = await h.repo.createSession('u-channel-2', new Date(BASE + HOUR));
    const cookieToken = h.repo.issueToken(cookieSession.id);
    const viaCookie = fakeRes();
    const out2 = await h.controller.refresh(
      undefined,
      reqWith(`refresh_token=${cookieToken}`),
      viaCookie,
    );
    expect(out2).toMatchObject({ accessToken: 'access-for-u-channel-2' });
    expect(viaCookie.cookieCalls).toHaveLength(1);
    const [name, value, options] = viaCookie.cookieCalls[0];
    expect(name).toBe('refresh_token');
    expect(value).toBe((out2 as { refreshToken: string }).refreshToken);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  });
});
