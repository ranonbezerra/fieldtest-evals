import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

const T0 = new Date('2025-01-01T00:00:00.000Z').getTime();
const HOUR = 3_600_000;

// The single envelope every rejection must produce — the contract under test.
const REJECTION = {
  error: {
    code: 'invalid_refresh_token',
    message: 'The refresh token was not accepted.',
    details: {},
  },
};

interface SuccessBody {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ResponseLike {
  status: number;
  json: Record<string, unknown>;
  setCookie: string | null;
}

function makeToken(tag: string): string {
  return (tag + 'y'.repeat(64)).slice(0, 43);
}

interface TokenRow {
  id: string;
  token: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface AuditRow {
  reason: string;
  familyId?: string;
  tokenId?: string;
  userId?: string;
  providedText?: string | null;
}

/**
 * In-memory stand-in for AuthRepository that honors the Postgres contract the
 * service relies on: findByToken returns a snapshot (a stale committed read),
 * and rotate performs the same conditional check-then-act as
 * `UPDATE refresh_tokens SET revoked_at = now() WHERE token = ? AND revoked_at IS NULL`
 * followed by the successor insert. JavaScript is single-threaded, so rotate's
 * check-then-act is atomic here exactly as the row lock makes it atomic there,
 * and two in-flight service calls interleave the way two transactions would.
 */
function createMockRepository() {
  const state = {
    tokens: new Map<string, TokenRow>(),
    families: new Map<string, { revokedAt: Date | null }>(),
    audit: [] as AuditRow[],
  };
  let ids = 0;

  const repo = {
    state,
    async createSession(userId: string, token: string, expiresAt: Date): Promise<string> {
      const familyId = `family-${++ids}`;
      state.families.set(familyId, { revokedAt: null });
      state.tokens.set(token, { id: `row-${++ids}`, token, familyId, userId, expiresAt, revokedAt: null });
      return familyId;
    },
    async findByToken(token: string): Promise<TokenRow | null> {
      const row = state.tokens.get(token);
      return row ? { ...row } : null;
    },
    async rotate(
      presented: string,
      successor: string,
      familyId: string,
      userId: string,
      expiresAt: Date,
    ): Promise<boolean> {
      const row = state.tokens.get(presented);
      if (!row || row.revokedAt !== null) {
        return false; // WHERE token = ? AND revoked_at IS NULL matched nothing
      }
      row.revokedAt = new Date();
      state.tokens.set(successor, {
        id: `row-${++ids}`,
        token: successor,
        familyId,
        userId,
        expiresAt,
        revokedAt: null,
      });
      return true;
    },
    async revokeFamily(familyId: string): Promise<void> {
      const now = new Date();
      const family = state.families.get(familyId);
      if (family) {
        family.revokedAt = family.revokedAt ?? now;
      }
      for (const row of state.tokens.values()) {
        if (row.familyId === familyId) {
          row.revokedAt = row.revokedAt ?? now;
        }
      }
    },
    async recordAudit(entry: AuditRow): Promise<AuditRow> {
      state.audit.push({ ...entry });
      return entry;
    },
  };
  return repo;
}

let app: INestApplication;
let port: number;
let repo: ReturnType<typeof createMockRepository>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);

  repo = createMockRepository();

  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AuthModule] })
    .overrideProvider(AuthRepository)
    .useValue(repo)
    .overrideProvider(AccessTokenService)
    .useValue({ issueAccessToken: (userId: string) => `access:${userId}` })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  port = (app.getHttpServer().address() as AddressInfo).port;
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

async function postRefresh(body: Record<string, unknown> | undefined, cookie?: string): Promise<ResponseLike> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
  }
  const res = await fetch(`http://127.0.0.1:${port}/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
    setCookie: res.headers.get('set-cookie'),
  };
}

async function seedSession(
  userId: string,
  expiresAt: Date,
  tag: string,
): Promise<{ token: string; familyId: string }> {
  const token = makeToken(tag);
  const familyId = await repo.createSession(userId, token, expiresAt);
  return { token, familyId };
}

const auditReasons = (): string[] => repo.state.audit.map((entry) => entry.reason);

describe('POST /auth/refresh', () => {
  it('rotates exactly one of two concurrent presentations of the same token and treats the loser as reuse', async () => {
    const { token } = await seedSession('user-1', new Date(T0 + HOUR), 'a1');

    const [viaBody, viaCookie] = await Promise.all([
      postRefresh({ refreshToken: token }),
      postRefresh(undefined, `refresh_token=${token}`),
    ]);

    expect([viaBody.status, viaCookie.status].sort((x, y) => x - y)).toEqual([201, 401]);

    const winner = viaBody.status === 201 ? viaBody : viaCookie;
    const loser = viaBody.status === 201 ? viaCookie : viaBody;
    const won = winner.json as unknown as SuccessBody;

    expect(won.accessToken).toBe('access:user-1');
    expect(won.refreshToken).not.toBe(token);
    expect(winner.setCookie).toContain(`refresh_token=${won.refreshToken}`);
    expect(winner.setCookie).toContain('HttpOnly');
    expect(loser.json).toEqual(REJECTION);

    // The loser's reuse detection revokes the whole family, including the
    // winner's just-issued successor.
    expect((await postRefresh({ refreshToken: won.refreshToken })).status).toBe(401);

    expect(auditReasons().filter((r) => r === 'refresh_rotated')).toHaveLength(1);
    expect(auditReasons().filter((r) => r === 'refresh_reused')).toHaveLength(2);
  });

  it('invalidates every descendant of the family when a retired token is replayed', async () => {
    const { token: t1, familyId } = await seedSession('user-2', new Date(T0 + HOUR), 'b1');

    const rotated = await postRefresh({ refreshToken: t1 });
    expect(rotated.status).toBe(201);
    const t2 = (rotated.json as unknown as SuccessBody).refreshToken;

    expect((await postRefresh({ refreshToken: t1 })).status).toBe(401); // replay
    expect((await postRefresh({ refreshToken: t2 })).status).toBe(401); // live successor, now dead

    expect(repo.state.families.get(familyId)?.revokedAt).toBeInstanceOf(Date);
    expect(auditReasons().filter((r) => r === 'refresh_reused')).toHaveLength(2);
  });

  it('inherits the absolute deadline across rotations and enforces it afterwards', async () => {
    const deadline = new Date(T0 + HOUR);
    const { token: t1 } = await seedSession('user-3', deadline, 'c1');

    vi.setSystemTime(T0 + HOUR / 2);
    const rotated = await postRefresh({ refreshToken: t1 });
    expect(rotated.status).toBe(201);
    const won = rotated.json as unknown as SuccessBody;
    expect(new Date(won.expiresAt).getTime()).toBe(deadline.getTime());
    expect(repo.state.tokens.get(won.refreshToken)?.expiresAt.getTime()).toBe(deadline.getTime());

    vi.setSystemTime(deadline.getTime() + 1000);
    const after = await postRefresh({ refreshToken: won.refreshToken });
    expect(after.status).toBe(401);
    expect(after.json).toEqual(REJECTION);
    expect(auditReasons().at(-1)).toBe('refresh_expired');
  });

  it('returns one identical response for all four rejection causes and distinguishes them only in the audit', async () => {
    const live = await seedSession('user-4', new Date(T0 + HOUR), 'd1');
    const expired = await seedSession('user-4', new Date(T0 - 1000), 'd2');
    await postRefresh({ refreshToken: live.token }); // retire live.token

    const cases = [
      await postRefresh({ refreshToken: 'x'.repeat(3) }), // malformed
      await postRefresh({ refreshToken: 'z'.repeat(43) }), // unknown
      await postRefresh({ refreshToken: expired.token }), // expired
      await postRefresh({ refreshToken: live.token }), // retired -> reuse
    ];

    for (const response of cases) {
      expect(response.status).toBe(401);
      expect(response.json).toEqual(REJECTION);
    }
    for (let i = 1; i < cases.length; i += 1) {
      expect(cases[i].status).toBe(cases[0].status);
      expect(cases[i].json).toEqual(cases[0].json);
    }
    for (const reason of ['refresh_malformed', 'refresh_unknown', 'refresh_expired', 'refresh_reused']) {
      expect(auditReasons()).toContain(reason);
    }
  });

  it('classifies a token that is both retired and expired as reuse, not expiry', async () => {
    const deadline = new Date(T0 + 60_000);
    const { token } = await seedSession('user-5', deadline, 'e1');

    expect((await postRefresh({ refreshToken: token })).status).toBe(201);
    vi.setSystemTime(deadline.getTime() + 1000); // now retired AND expired

    expect((await postRefresh({ refreshToken: token })).status).toBe(401);
    expect(auditReasons().at(-1)).toBe('refresh_reused');
    expect(auditReasons()).not.toContain('refresh_expired');
  });

  it('prefers the body token over the cookie when both are present, and accepts the cookie alone', async () => {
    const deadline = new Date(T0 + HOUR);
    const bodyTok = await seedSession('user-6', deadline, 'f1');
    const cookieTok = await seedSession('user-6', deadline, 'f2');

    const both = await postRefresh({ refreshToken: bodyTok.token }, `refresh_token=${cookieTok.token}`);
    expect(both.status).toBe(201);

    expect((await postRefresh({ refreshToken: bodyTok.token })).status).toBe(401); // body token was rotated
    const viaCookie = await postRefresh(undefined, `refresh_token=${cookieTok.token}`);
    expect(viaCookie.status).toBe(201); // cookie token untouched, and works alone
  });
});
