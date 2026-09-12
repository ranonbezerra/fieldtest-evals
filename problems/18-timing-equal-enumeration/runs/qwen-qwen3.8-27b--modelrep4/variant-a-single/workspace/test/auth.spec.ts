/**
 * Property tests for the anti-enumeration guarantees of /auth/sign-up and
 * /auth/sign-in.
 *
 * Environment requirements:
 *   - DATABASE_URL pointing at a Postgres with prisma/migrations applied
 *   - `supertest` and `argon2` available; the hashing path is never mocked,
 *     because the timing property is only meaningful with real argon2 work
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAILER } from '../src/mail/mail.port';

// Read by the DI container at init time; must be set before the app boots.
process.env.JWT_SECRET ??= 'test-only-secret-not-for-production';

const SIGN_UP = '/auth/sign-up';
const SIGN_IN = '/auth/sign-in';
const TAKEN_EMAIL = 'existing-account@example.com';
const KNOWN_USER_EMAIL = 'known-user@example.com';
const KNOWN_USER_PASSWORD = 'correct-password-0000';
const NEW_PERSON_EMAIL = 'new-person@example.com';

const TIMING_SAMPLES = 12;
// A broken design (skipping the argon2 pass in one branch) shifts the mean
// by roughly a full hash — tens of milliseconds, a relative delta near or
// above 50%. Normal loopback jitter is a small fraction of that. This bound
// sits far below the breakage and far above the noise.
const TIMING_RELATIVE_TOLERANCE = 0.35;
const TIMING_TEST_TIMEOUT_MS = 60_000;

interface Mail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

let app: INestApplication;
let prisma: PrismaService;
let sent: Mail[] = [];

const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

function post(path: string, body: unknown) {
  return request(app.getHttpServer()).post(path).send(body);
}

async function timedPost(path: string, body: unknown): Promise<number> {
  const started = performance.now();
  await request(app.getHttpServer()).post(path).send(body);
  return performance.now() - started;
}

beforeAll(async () => {
  const moduleRef = await Test
    .createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({
      sendEmail: async (to: string, template: string, vars: Record<string, unknown>): Promise<void> => {
        sent.push({ to, template, vars });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init(); // runs onModuleInit hooks, including the dummy-hash build
  prisma = moduleRef.get(PrismaService);
});

beforeEach(async () => {
  sent = [];
  await prisma.user.deleteMany();
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe('POST /auth/sign-up', () => {
  it('answers a taken address and a new address with byte-identical responses', async () => {
    const seed = await post(SIGN_UP, { email: TAKEN_EMAIL, password: 'seeded-password-0000' });
    expect(seed.status).toBe(201);

    const taken = await post(SIGN_UP, { email: TAKEN_EMAIL, password: 'attacker-guess-0001' });
    const fresh = await post(SIGN_UP, { email: NEW_PERSON_EMAIL, password: 'original-password-1' });

    expect(taken.status).toBe(201);
    expect(fresh.status).toBe(taken.status);
    // Byte comparison: the same status, the same payload-carrying headers,
    // and — crucially — the identical body byte sequence. (The transport
    // "date" header is set by the runtime to the wall clock, not the branch.)
    expect(fresh.headers['content-type']).toBe(taken.headers['content-type']);
    expect(fresh.headers['content-length']).toBe(taken.headers['content-length']);
    expect(fresh.text).toBe(taken.text);

    // The real outcome still reaches the owner, out-of-band.
    expect(sent.some((m) => m.to === TAKEN_EMAIL && m.template === 'sign-up-taken')).toBe(true);
    expect(sent.some((m) => m.to === NEW_PERSON_EMAIL && m.template === 'sign-up-verify')).toBe(true);

    // The taken account was not overwritten by the attempt.
    const takenRow = await prisma.user.findUnique({ where: { email: TAKEN_EMAIL } });
    expect(takenRow).not.toBeNull();
    expect(await argon2.verify(takenRow!.passwordHash, 'seeded-password-0000')).toBe(true);
    expect(await argon2.verify(takenRow!.passwordHash, 'attacker-guess-0001')).toBe(false);

    // The new account was really created, with a real argon2id hash.
    const freshRow = await prisma.user.findUnique({ where: { email: NEW_PERSON_EMAIL } });
    expect(freshRow).not.toBeNull();
    expect(freshRow!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(freshRow!.passwordHash, 'original-password-1')).toBe(true);
  });

  it('treats case and whitespace variants as the same address, with the same response', async () => {
    const first = await post(SIGN_UP, { email: '  Mixed.Case@Example.COM ', password: 'first-password-0001' });
    const second = await post(SIGN_UP, { email: 'mixed.case@example.com', password: 'second-password-0002' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(first.status);
    expect(second.text).toBe(first.text);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { email: 'mixed.case@example.com' } })).not.toBeNull();
  });

  it('rejects malformed input with the standard envelope and no side effects', async () => {
    const res = await post(SIGN_UP, { email: 'no-at-sign', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).toEqual(expect.any(Object));
    expect(Array.isArray(res.body.error.details)).toBe(false);
    expect(await prisma.user.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it(`takes the same time for a taken and a new address over ${TIMING_SAMPLES} samples`, async () => {
    await post(SIGN_UP, { email: TAKEN_EMAIL, password: 'seeded-password-0000' });
    // Warm-up: absorb one-off initialisation costs, not branch costs.
    await timedPost(SIGN_UP, { email: TAKEN_EMAIL, password: 'warmup-password-000' });
    await timedPost(SIGN_UP, { email: 'timing-warmup@example.com', password: 'warmup-password-000' });

    const takenMs: number[] = [];
    const freshMs: number[] = [];
    for (let i = 0; i < TIMING_SAMPLES; i += 1) {
      takenMs.push(await timedPost(SIGN_UP, { email: TAKEN_EMAIL, password: `taken-${i}-password-00` }));
      freshMs.push(await timedPost(SIGN_UP, { email: `timing-fresh-${i}@example.com`, password: `fresh-${i}-password-00` }));
    }

    const relDelta = Math.abs(mean(takenMs) - mean(freshMs)) / Math.min(mean(takenMs), mean(freshMs));
    // A branch that skipped the argon2 pass would land far above this bound.
    expect(relDelta).toBeLessThan(TIMING_RELATIVE_TOLERANCE);
  }, TIMING_TEST_TIMEOUT_MS);
});

describe('POST /auth/sign-in', () => {
  it('answers a wrong password and an unknown address with byte-identical 401s', async () => {
    const seed = await post(SIGN_UP, { email: KNOWN_USER_EMAIL, password: KNOWN_USER_PASSWORD });
    expect(seed.status).toBe(201);
    const mailsBefore = sent.length;

    const wrongPassword = await post(SIGN_IN, { email: KNOWN_USER_EMAIL, password: 'wrong-password-00001' });
    const unknownAddress = await post(SIGN_IN, { email: 'no-such-user@example.com', password: 'wrong-password-00001' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(wrongPassword.status);
    expect(unknownAddress.headers['content-type']).toBe(wrongPassword.headers['content-type']);
    expect(unknownAddress.headers['content-length']).toBe(wrongPassword.headers['content-length']);
    expect(unknownAddress.text).toBe(wrongPassword.text);
    expect(JSON.parse(wrongPassword.text)).toEqual({
      error: { code: 'invalid_credentials', message: 'Invalid email or password.', details: {} },
    });
    // Sign-in failure never triggers mail that could flag the branch.
    expect(sent.length).toBe(mailsBefore);
  });

  it('issues a token for correct credentials', async () => {
    await post(SIGN_UP, { email: KNOWN_USER_EMAIL, password: KNOWN_USER_PASSWORD });
    const ok = await post(SIGN_IN, { email: KNOWN_USER_EMAIL, password: KNOWN_USER_PASSWORD });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
    expect(ok.body.token.split('.')).toHaveLength(3);
  });

  it(`takes the same time for a wrong password and an unknown address over ${TIMING_SAMPLES} samples`, async () => {
    await post(SIGN_UP, { email: KNOWN_USER_EMAIL, password: KNOWN_USER_PASSWORD });
    await timedPost(SIGN_IN, { email: KNOWN_USER_EMAIL, password: 'warmup-password-000' });
    await timedPost(SIGN_IN, { email: 'timing-warmup@example.com', password: 'warmup-password-000' });

    const wrongMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < TIMING_SAMPLES; i += 1) {
      wrongMs.push(await timedPost(SIGN_IN, { email: KNOWN_USER_EMAIL, password: `wrong-${i}-password-000` }));
      unknownMs.push(await timedPost(SIGN_IN, { email: `ghost-${i}@example.com`, password: `wrong-${i}-password-000` }));
    }

    const relDelta = Math.abs(mean(wrongMs) - mean(unknownMs)) / Math.min(mean(wrongMs), mean(unknownMs));
    // A branch that skipped argon2.verify on unknown addresses would land
    // far above this bound.
    expect(relDelta).toBeLessThan(TIMING_RELATIVE_TOLERANCE);
  }, TIMING_TEST_TIMEOUT_MS);
});
