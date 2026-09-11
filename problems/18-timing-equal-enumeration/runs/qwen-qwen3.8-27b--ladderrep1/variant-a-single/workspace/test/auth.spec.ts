import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.port.js';

// ---------------------------------------------------------------------------
// In-memory stand-ins for the two ports the app depends on. The HTTP stack,
// the controller, the service, the repository logic, and the argon2 work are
// all real; only the database and the mail transport are faked, so no test
// needs an external Postgres or mail server.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

function createFakePrisma(): { service: unknown } {
  const rows = new Map<string, FakeRow>();
  let nextId = 0;

  const service = {
    user: {
      async findUnique(args: { where: { email: string } }): Promise<FakeRow | null> {
        return rows.get(args.where.email) ?? null;
      },
      async create(args: { data: { email: string; passwordHash: string } }): Promise<FakeRow> {
        const { email, passwordHash } = args.data;
        if (rows.has(email)) {
          throw Object.assign(new Error('Unique constraint failed on users_email_key'), {
            code: 'P2002',
          });
        }
        const row: FakeRow = {
          id: `row-${++nextId}`,
          email,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(email, row);
        return row;
      },
    },
  };

  return { service };
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

function createMailPort(fail: boolean): { port: MailPort; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const port: MailPort = {
    async sendEmail(to, template, vars) {
      if (fail) {
        throw new Error('mail transport unavailable');
      }
      sent.push({ to, template, vars });
    },
  };
  return { port, sent };
}

async function buildApp(
  prisma: unknown,
  mailPort: MailPort,
): Promise<{ app: INestApplication; server: Server }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma as PrismaService)
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, server: app.getHttpServer() };
}

async function signUp(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-up').send({ email, password });
}

async function signIn(server: Server, email: string, password: string) {
  return request(server).post('/auth/sign-in').send({ email, password });
}

/**
 * Every header except `date` must match between two responses; `date` is a
 * wall-clock timestamp and may legitimately differ between requests.
 */
function stripVolatileHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'date' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Mail is fire-and-forget by design, so assertions about it must poll until
 * the (unawaited) send lands.
 */
async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function timedPost(
  server: Server,
  path: string,
  email: string,
  password: string,
  expectedStatus: number,
): Promise<number> {
  const startedAt = process.hrtime.bigint();
  const response = await request(server).post(path).send({ email, password });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  // Guard: if a branch started failing, the test must not silently time a
  // different (fast error) path and pass on the wrong data.
  expect(response.status).toBe(expectedStatus);
  return elapsedMs;
}

const SAMPLES = 10;
// One argon2id pass at the configured cost (32 MiB, 2 passes) takes far
// longer than this on any machine; a request that skips the hashing sits well
// below it. This is what makes "both branches are fast" fail the test.
const MIN_REAL_WORK_MS = 20;
// How far the two branch means may drift apart and still be treated as
// indistinguishable.
const MEAN_TOLERANCE_MS = 25;

describe('POST /auth/sign-up', () => {
  it('returns byte-identical responses for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const seed = await signUp(server, 'seeded@example.test', 'seeded-password-1');
      expect(seed.status).toBe(202);

      const existing = await signUp(server, 'seeded@example.test', 'rival-password-9');
      const fresh = await signUp(server, 'brand-new@example.test', 'brand-new-pass-1');

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      // Body, byte for byte.
      expect(Buffer.from(existing.text)).toEqual(Buffer.from(fresh.text));
      // Headers, including content-length and etag, which would both change
      // if the bodies differed in length or content.
      expect(stripVolatileHeaders(existing.headers)).toEqual(stripVolatileHeaders(fresh.headers));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
    } finally {
      await app.close();
    }
  });

  it('creates the account once and a second sign-up never overwrites it', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const first = await signUp(server, 'owner@example.test', 'original-password-1');
      expect(first.status).toBe(202);
      const again = await signUp(server, 'owner@example.test', 'rival-password-99');
      expect(again.status).toBe(202);

      // The original password still works...
      expect((await signIn(server, 'owner@example.test', 'original-password-1')).status).toBe(200);
      // ...and the rival password from the second sign-up does not, i.e. the
      // stored hash was not replaced.
      expect((await signIn(server, 'owner@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('treats case variants of the same address as the same address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'Mixed.Case@Example.test', 'original-password-1')).status).toBe(202);
      expect((await signUp(server, 'mixed.case@example.test', 'rival-password-99')).status).toBe(202);

      expect((await signIn(server, 'MIXED.CASE@example.test', 'original-password-1')).status).toBe(200);
      expect((await signIn(server, 'MIXED.CASE@example.test', 'rival-password-99')).status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('sends exactly one verification email for a new address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'newbie@example.test', 'newbie-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the verification email');
      expect(sent).toEqual([
        { to: 'newbie@example.test', template: 'verify-account', vars: { email: 'newbie@example.test' } },
      ]);
    } finally {
      await app.close();
    }
  });

  it('sends a "someone tried to sign up" email for an existing address', async () => {
    const { service } = createFakePrisma();
    const { port, sent } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'seeded@example.test', 'seeded-password-1')).status).toBe(202);
      await waitUntil(() => sent.length === 1, 'the first email');

      expect((await signUp(server, 'seeded@example.test', 'rival-password-9')).status).toBe(202);
      await waitUntil(
        () => sent.filter((mail) => mail.template === 'signup-attempted').length === 1,
        'the attempted email',
      );

      expect(sent.find((mail) => mail.template === 'signup-attempted')).toEqual({
        to: 'seeded@example.test',
        template: 'signup-attempted',
        vars: { email: 'seeded@example.test' },
      });
      expect(sent.some((mail) => mail.template === 'verify-account')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('changes nothing the caller observes when mail delivery fails', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(true);
    const { app, server } = await buildApp(service, port);
    try {
      const fresh = await signUp(server, 'no-mail@example.test', 'no-mail-password-1');
      const existing = await signUp(server, 'no-mail@example.test', 'no-mail-password-2');

      expect(fresh.status).toBe(202);
      expect(existing.status).toBe(202);
      expect(Buffer.from(fresh.text)).toEqual(Buffer.from(existing.text));
      expect(stripVolatileHeaders(fresh.headers)).toEqual(stripVolatileHeaders(existing.headers));
    } finally {
      await app.close();
    }
  });

  it('rejects malformed input with the error envelope', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const response = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'not-an-email', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: 'validation_failed', details: { fields: ['email', 'password'] } },
      });
      expect(typeof response.body.error.message).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a new and an existing address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const existingEmail = 'timing-existing@example.test';
      // Warm-up: sockets, argon2 native init, JIT — outside the measurement.
      await signUp(server, existingEmail, 'warm-up-password-1');
      await signUp(server, 'warm-up-new@example.test', 'warm-up-password-1');

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        existingTimes.push(
          await timedPost(server, '/auth/sign-up', existingEmail, `existing-sample-${i}-pass`, 202),
        );
        freshTimes.push(
          await timedPost(
            server,
            '/auth/sign-up',
            `timing-fresh-${i}@example.test`,
            `fresh-sample-${i}-pass`,
            202,
          ),
        );
      }

      const existingMean = average(existingTimes);
      const freshMean = average(freshTimes);
      const toleranceMs = Math.max(MEAN_TOLERANCE_MS, 0.3 * Math.min(existingMean, freshMean));

      // (1) The two distributions must not be separable. Fails if the
      // existing-address branch skips the hashing.
      expect(Math.abs(existingMean - freshMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...existingTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...freshTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe('POST /auth/sign-in', () => {
  it('returns byte-identical responses for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);

      const wrongPassword = await signIn(server, 'known@example.test', 'wrong-password-123');
      const unknownAddress = await signIn(server, 'ghost@example.test', 'ghost-password-123');

      expect(wrongPassword.status).toBe(401);
      expect(unknownAddress.status).toBe(401);
      expect(Buffer.from(wrongPassword.text)).toEqual(Buffer.from(unknownAddress.text));
      expect(stripVolatileHeaders(wrongPassword.headers)).toEqual(
        stripVolatileHeaders(unknownAddress.headers),
      );
      expect(wrongPassword.body).toEqual({
        error: {
          code: 'invalid_credentials',
          message: 'Email or password is incorrect.',
          details: {},
        },
      });
    } finally {
      await app.close();
    }
  });

  it('accepts the correct credentials', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      expect((await signUp(server, 'known@example.test', 'known-password-123')).status).toBe(202);
      const response = await signIn(server, 'known@example.test', 'known-password-123');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Signed in.' });
    } finally {
      await app.close();
    }
  });

  it('takes statistically the same time for a wrong password and an unknown address', async () => {
    const { service } = createFakePrisma();
    const { port } = createMailPort(false);
    const { app, server } = await buildApp(service, port);
    try {
      const knownEmail = 'timing-known@example.test';
      expect((await signUp(server, knownEmail, 'timing-known-pass-1')).status).toBe(202);
      // Warm-up: sockets, dummy-hash generation, argon2 native init.
      await signIn(server, knownEmail, 'warm-up-wrong-1');
      await signIn(server, 'warm-up-ghost@example.test', 'warm-up-pass-1');

      const wrongPasswordTimes: number[] = [];
      const unknownAddressTimes: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        wrongPasswordTimes.push(
          await timedPost(server, '/auth/sign-in', knownEmail, `wrong-sample-${i}-pass`, 401),
        );
        unknownAddressTimes.push(
          await timedPost(
            server,
            '/auth/sign-in',
            `timing-ghost-${i}@example.test`,
            `ghost-sample-${i}-pass`,
            401,
          ),
        );
      }

      const wrongPasswordMean = average(wrongPasswordTimes);
      const unknownAddressMean = average(unknownAddressTimes);
      const toleranceMs = Math.max(
        MEAN_TOLERANCE_MS,
        0.3 * Math.min(wrongPasswordMean, unknownAddressMean),
      );

      // (1) The two distributions must not be separable. Fails if the
      // unknown-address branch skips the dummy verification.
      expect(Math.abs(wrongPasswordMean - unknownAddressMean)).toBeLessThanOrEqual(toleranceMs);
      // (2) Both branches must actually be paying for real hashing. Fails if
      // the hashing is removed and both branches become fast.
      expect(Math.min(...wrongPasswordTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
      expect(Math.min(...unknownAddressTimes)).toBeGreaterThanOrEqual(MIN_REAL_WORK_MS);
    } finally {
      await app.close();
    }
  }, 60_000);
});
