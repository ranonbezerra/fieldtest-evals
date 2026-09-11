import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { ACCESS_TOKEN_ISSUER, AuthService, CLOCK } from '../src/auth/auth.service.js';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const junkToken = (): string => randomBytes(32).toString('base64url');

const REJECTION_BODY = {
  error: { code: 'invalid_refresh_token', message: 'The refresh token could not be used.', details: {} },
};

// A clock the tests can advance, so deadline behaviour is deterministic.
function makeClock() {
  let current = new Date();
  return {
    now: (): Date => current,
    advance: (ms: number): void => {
      current = new Date(current.getTime() + ms);
    },
  };
}

interface FakeToken {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

interface FakeFamily {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface FakeEvent {
  id: string;
  kind: string;
  reason: string | null;
  userId: string | null;
  familyId: string | null;
  tokenId: string | null;
  source: string | null;
  details: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * Emulates the AuthRepository contract. rotate() mirrors the real
 * repository's single conditional UPDATE: the check ("still live?") and the
 * set happen in one synchronous step, so two racing callers cannot both
 * observe "still live" — the same serialisation the database row lock
 * provides. The final describe block exercises the real repository against
 * Postgres for the same scenario.
 */
class FakeRefreshRepository {
  readonly tokens = new Map<string, FakeToken>();
  readonly families = new Map<string, FakeFamily>();
  readonly events: FakeEvent[] = [];

  constructor(private readonly now: () => Date) {}

  findByHash(tokenHash: string): Promise<FakeToken | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === tokenHash) return Promise.resolve({ ...token });
    }
    return Promise.resolve(null);
  }

  findById(id: string): Promise<FakeToken | null> {
    const token = this.tokens.get(id);
    return Promise.resolve(token ? { ...token } : null);
  }

  async rotate(input: {
    presentedId: string;
    issued: Omit<FakeToken, 'retiredAt' | 'revokedAt' | 'replacedById'>;
  }): Promise<{ status: 'rotated'; issuedId: string } | { status: 'lost' }> {
    const at = this.now();
    const token = this.tokens.get(input.presentedId);
    if (
      token === undefined ||
      token.retiredAt !== null ||
      token.revokedAt !== null ||
      token.expiresAt.getTime() <= at.getTime()
    ) {
      return { status: 'lost' };
    }
    token.retiredAt = at;
    token.replacedById = input.issued.id;
    const issued: FakeToken = { ...input.issued, retiredAt: null, revokedAt: null, replacedById: null };
    this.tokens.set(issued.id, issued);
    for (const other of this.tokens.values()) {
      if (other.familyId === issued.familyId && other.id !== issued.id && other.retiredAt === null && other.revokedAt === null) {
        other.retiredAt = at;
      }
    }
    return { status: 'rotated', issuedId: issued.id };
  }

  async revokeFamily(familyId: string, at: Date): Promise<{ newlyRevokedTokens: number; familyAlreadyRevoked: boolean }> {
    let newlyRevokedTokens = 0;
    for (const token of this.tokens.values()) {
      if (token.familyId === familyId && token.revokedAt === null) {
        token.revokedAt = at;
        newlyRevokedTokens += 1;
      }
    }
    const family = this.families.get(familyId);
    const familyAlreadyRevoked = family !== undefined && family.revokedAt !== null;
    if (family !== undefined && family.revokedAt === null) family.revokedAt = at;
    return { newlyRevokedTokens, familyAlreadyRevoked };
  }

  async createSession(input: {
    family: Omit<FakeFamily, 'revokedAt'>;
    token: Omit<FakeToken, 'retiredAt' | 'revokedAt' | 'replacedById'>;
  }): Promise<void> {
    this.families.set(input.family.id, { ...input.family, revokedAt: null });
    this.tokens.set(input.token.id, { ...input.token, retiredAt: null, revokedAt: null, replacedById: null });
  }

  async recordEvent(event: FakeEvent): Promise<void> {
    this.events.push(event);
  }

  tokenByHash(plaintext: string): FakeToken | undefined {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === sha256(plaintext)) return token;
    }
    return undefined;
  }
}

async function buildApp(fake: FakeRefreshRepository, now: () => Date): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      { provide: AuthRepository, useValue: fake },
      { provide: ACCESS_TOKEN_ISSUER, useValue: { issueAccessToken: (userId: string): string => `access:${userId}` } },
      { provide: CLOCK, useValue: now },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const header = res.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? (header as string[]) : [String(header)];
}

describe('POST /auth/refresh', () => {
  let app: INestApplication;
  let fake: FakeRefreshRepository;
  let clock: ReturnType<typeof makeClock>;
  let service: AuthService;

  beforeEach(async () => {
    clock = makeClock();
    fake = new FakeRefreshRepository(clock.now);
    app = await buildApp(fake, clock.now);
    service = app.get(AuthService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rotates a presented token: retires it and issues a new pair with the same absolute deadline', async () => {
    const session = await service.startSession('user-1', 3_600_000);
    const res = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'refreshToken']);
    expect(res.body.accessToken).toBe('access:user-1');
    expect(res.body.refreshToken).not.toBe(session.refreshToken);

    expect(fake.tokenByHash(session.refreshToken)?.retiredAt).not.toBeNull();
    const fresh = fake.tokenByHash(res.body.refreshToken);
    expect(fresh).toBeDefined();
    expect(fresh?.expiresAt.getTime()).toBe(session.sessionExpiresAt.getTime());
    expect(fake.events.some((e) => e.kind === 'refresh_success')).toBe(true);
  });

  it('accepts the token from the refresh_token cookie and refreshes the cookie in the response', async () => {
    const session = await service.startSession('user-2', 3_600_000);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${session.refreshToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
  });

  it('lets the body win over the cookie when both are present, and clears a stale cookie', async () => {
    const a = await service.startSession('user-a', 3_600_000);
    const b = await service.startSession('user-b', 3_600_000);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${b.refreshToken}`)
      .send({ refreshToken: a.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access:user-a'); // the body's session rotated
    expect(fake.tokenByHash(a.refreshToken)?.retiredAt).not.toBeNull();
    expect(fake.tokenByHash(b.refreshToken)?.retiredAt).toBeNull(); // other family untouched

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.includes('refresh_token=;') || c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => c.includes(`refresh_token=${b.refreshToken}`))).toBe(false);
  });

  it('lets exactly one of two concurrent refreshes of one token rotate; the loser is a reuse that kills the family', async () => {
    const session = await service.startSession('user-race', 3_600_000);
    // Genuinely concurrent: both requests are in flight before either settles.
    const [first, second] = await Promise.allSettled([
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken }),
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken }),
    ]);

    const statuses = [first, second].map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 401]);

    const rejected = [first, second].find((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.status === 401)!;
    expect(rejected.value.body).toEqual(REJECTION_BODY);

    const original = fake.tokenByHash(session.refreshToken)!;
    const familyRows = [...fake.tokens.values()].filter((t) => t.familyId === original.familyId);
    expect(familyRows.length).toBe(2); // the original and the winner's successor
    expect(original.retiredAt).not.toBeNull();
    const successor = familyRows.find((t) => t.id !== original.id)!;
    expect(successor.revokedAt).not.toBeNull(); // the winner's new token was invalidated
    expect(fake.families.get(original.familyId)?.revokedAt).not.toBeNull();

    const reuse = fake.events.find((e) => e.kind === 'refresh_rejected' && e.reason === 'reuse');
    expect(reuse).toBeDefined();
    expect(reuse!.details.context).toBe('race');
    expect(fake.events.filter((e) => e.kind === 'refresh_success').length).toBe(1);
  });

  it('replaying a retired token invalidates every descendant of the family', async () => {
    const s0 = await service.startSession('user-replay', 3_600_000);
    const s1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    const s2 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s1.body.refreshToken });
    expect([s1.status, s2.status]).toEqual([200, 200]);

    const replay = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION_BODY);

    const familyId = fake.tokenByHash(s0.refreshToken)!.familyId;
    expect(fake.tokenByHash(s2.body.refreshToken)!.revokedAt).not.toBeNull(); // the live descendant died
    expect(fake.families.get(familyId)?.revokedAt).not.toBeNull();

    // Presenting the (now revoked) descendant is another reuse event.
    const again = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s2.body.refreshToken });
    expect(again.status).toBe(401);
    const reuseEvents = fake.events.filter((e) => e.kind === 'refresh_rejected' && e.reason === 'reuse');
    expect(reuseEvents.length).toBe(2);
    expect(reuseEvents[1].details.tokenState).toBe('revoked');
  });

  it('never extends the absolute deadline fixed at sign-in', async () => {
    const session = await service.startSession('user-deadline', 1000);
    const r1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(r1.status).toBe(200);
    expect(fake.tokenByHash(r1.body.refreshToken)!.expiresAt.getTime()).toBe(session.sessionExpiresAt.getTime());

    clock.advance(999);
    const r2 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(200); // 1ms before the deadline: still valid

    clock.advance(1); // exactly at the deadline: the session is over
    const r3 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: r2.body.refreshToken });
    expect(r3.status).toBe(401);
    expect(fake.events.some((e) => e.kind === 'refresh_rejected' && e.reason === 'expired')).toBe(true);
  });

  it('returns a byte-identical 401 envelope for malformed, unknown, expired and retired tokens; only the audit log differs', async () => {
    const s0 = await service.startSession('user-401', 1000);
    const s1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(s1.status).toBe(200);
    clock.advance(1000); // the absolute deadline has now passed

    const malformed = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: 'too-short' });
    const missing = await request(app.getHttpServer()).post('/auth/refresh').send({});
    const unknown = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: junkToken() });
    const expired = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s1.body.refreshToken });
    const retired = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });

    for (const res of [malformed, missing, unknown, expired, retired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION_BODY);
      expect(JSON.stringify(res.body)).toBe(JSON.stringify(REJECTION_BODY));
    }

    // The audit record distinguishes all of them.
    const reasons = fake.events.filter((e) => e.kind === 'refresh_rejected').map((e) => e.reason);
    expect(reasons).toEqual(['malformed', 'malformed', 'unknown', 'expired', 'reuse']);
  });

  it('records a token that is both retired and expired as reuse, not as expiry', async () => {
    const s0 = await service.startSession('user-both', 1000);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    clock.advance(1000);

    const res = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(res.status).toBe(401);

    const rejected = fake.events.filter((e) => e.kind === 'refresh_rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('reuse');
    expect(rejected[0].details.context).toBe('replay');
    expect(fake.families.get(fake.tokenByHash(s0.refreshToken)!.familyId)?.revokedAt).not.toBeNull();
  });
});

describe.runIf(!!process.env.DATABASE_URL)('rotation against real Postgres (requires DATABASE_URL)', () => {
  const MIGRATION_SQL_PATH = 'prisma/migrations/20250612000000_init_refresh_rotation/migration.sql';
  let prisma: PrismaClient;
  let service: AuthService;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS "refresh_tokens", "refresh_token_families", "security_events" CASCADE`,
    );
    const migration = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const statement of migration.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
      await prisma.$executeRawUnsafe(`${statement};`);
    }
    const clock = makeClock();
    const repository = new AuthRepository(prisma);
    service = new AuthService(repository, { issueAccessToken: (userId: string): string => `access:${userId}` }, clock.now);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('serialises two truly concurrent rotations of one token; the loser is reuse and the family is invalidated', async () => {
    const session = await service.startSession('user-db', 3_600_000);
    const [first, second] = await Promise.allSettled([
      service.refresh(session.refreshToken, 'body'),
      service.refresh(session.refreshToken, 'body'),
    ]);
    expect([first, second].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect([first, second].filter((r) => r.status === 'rejected').length).toBe(1);

    const original = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(session.refreshToken) } });
    expect(original).not.toBeNull();

    const rows = await prisma.refreshToken.findMany({ where: { familyId: original!.familyId } });
    expect(rows.length).toBe(2);
    expect(rows.filter((t) => t.retiredAt !== null).length).toBe(1);
    expect(rows.filter((t) => t.revokedAt !== null).length).toBe(2); // the winner's new token died too

    const family = await prisma.refreshTokenFamily.findUnique({ where: { id: original!.familyId } });
    expect(family?.revokedAt).not.toBeNull();

    const reuse = await prisma.securityEvent.findFirst({ where: { kind: 'refresh_rejected', reason: 'reuse' } });
    expect(reuse).not.toBeNull();
    expect(reuse?.details).toMatchObject({ context: 'race', tokenState: 'retired' });
  });
});
