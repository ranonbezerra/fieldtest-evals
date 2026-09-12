import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AllExceptionsFilter } from '../src/all-exceptions.filter.js';
import { AppModule } from '../src/app.module.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.port.js';

// The property under test: an outside observer must not be able to tell the
// two branches of each endpoint apart, neither byte-for-byte nor by timing.
//
// With the implementation intact, both branches of each endpoint perform the
// same expensive work (one argon2id operation at m=64MiB/t=3/p=4, one
// database write and one email per request), so the gap between the branch
// timings is noise only. If the equalizing work were removed, the gap would
// be the full hash/verify cost (tens to hundreds of ms), which the tolerance
// below rejects.

const PASSWORD = 's3cure-p@ssw0rd-0123';
const WARMUP_SAMPLES = 2;
const SAMPLES = 12;
const TOLERANCE_MS = 30;

interface SentEmail {
  to: string;
  template: string;
  vars: Record<string, unknown>;
}

let app: INestApplication;
let db: PrismaClient;
let sentEmails: SentEmail[] = [];
let createdEmails: string[] = [];

function freshEmail(prefix: string): string {
  const email = `${prefix}-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return email;
}

function postSignUp(email: string, password: string) {
  return request(app.getHttpServer()).post('/auth/sign-up').send({ email, password });
}

function postSignIn(email: string, password: string) {
  return request(app.getHttpServer()).post('/auth/sign-in').send({ email, password });
}

function headersIgnoringDate(res: { headers: IncomingHttpHeaders }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (name.toLowerCase() === 'date') continue; // wall-clock header, inherently different
    out[name] = String(value);
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must point at a PostgreSQL database (run prisma migrate deploy first)',
    );
  }

  sentEmails = [];
  createdEmails = [];
  db = new PrismaClient();

  const mail: MailPort = {
    sendEmail: async (to, template, vars) => {
      sentEmails.push({ to, template, vars });
    },
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mail)
    .compile();

  app = moduleRef.createNestApplication();
  app.disable('x-powered-by');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
}, 60_000);

afterAll(async () => {
  try {
    if (db) {
      if (createdEmails.length > 0) {
        await db.user.deleteMany({ where: { email: { in: createdEmails } } });
      }
      await db.$disconnect();
    }
  } finally {
    if (app) await app.close();
  }
}, 60_000);

describe('POST /auth/sign-up', () => {
  it('creates the account and emails a verification notice for a new address', async () => {
    const email = freshEmail('sign-up-new');
    const res = await postSignUp(email, PASSWORD);

    expect(res.status).toBe(202);
    expect(res.text).toBe('{"status":"accepted"}');

    const account = await db.user.findUnique({ where: { email } });
    expect(account).not.toBeNull();
    expect(account?.passwordHash).toMatch(/^\$argon2id\$/);

    expect(sentEmails).toEqual([{ to: email, template: 'verify_email', vars: { email } }]);
  });

  it('answers byte-identically for an existing address, leaves the account untouched and alerts the owner', async () => {
    const email = freshEmail('sign-up-dup');
    const first = await postSignUp(email, PASSWORD);
    expect(first.status).toBe(202);

    const accountBefore = await db.user.findUnique({ where: { email } });
    const emailsBefore = sentEmails.length;

    const second = await postSignUp(email, 'an0ther-p@ssw0rd-4567');

    expect(second.status).toBe(first.status);
    expect(second.text).toBe(first.text); // byte comparison
    expect(headersIgnoringDate(second)).toEqual(headersIgnoringDate(first));

    const accountAfter = await db.user.findUnique({ where: { email } });
    expect(accountAfter?.id).toBe(accountBefore?.id);
    expect(accountAfter?.passwordHash).toBe(accountBefore?.passwordHash);
    expect(await db.user.count({ where: { email } })).toBe(1);

    expect(sentEmails.slice(emailsBefore)).toEqual([
      { to: email, template: 'sign_up_attempt', vars: { email } },
    ]);
  });

  it('answers identically when two sign-ups for the same new address race', async () => {
    const email = freshEmail('sign-up-race');
    const [first, second] = await Promise.all([
      postSignUp(email, PASSWORD),
      postSignUp(email, PASSWORD),
    ]);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.text).toBe(second.text);
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(sentEmails.filter((mail) => mail.to === email)).toHaveLength(2);
  });

  it('takes indistinguishably long for existing and new addresses over many samples', { timeout: 180_000 }, async () => {
    const existingEmail = freshEmail('timing-existing');
    expect((await postSignUp(existingEmail, PASSWORD)).status).toBe(202);

    const existingMs: number[] = [];
    const freshMs: number[] = [];

    for (let i = 0; i < WARMUP_SAMPLES + SAMPLES; i += 1) {
      const newEmail = freshEmail(`timing-fresh-${i}`);

      const existingStart = performance.now();
      const existingRes = await postSignUp(existingEmail, PASSWORD);
      existingMs.push(performance.now() - existingStart);
      expect(existingRes.status).toBe(202);

      const freshStart = performance.now();
      const freshRes = await postSignUp(newEmail, PASSWORD);
      freshMs.push(performance.now() - freshStart);
      expect(freshRes.status).toBe(202);
    }

    const measuredExisting = existingMs.slice(WARMUP_SAMPLES);
    const measuredFresh = freshMs.slice(WARMUP_SAMPLES);

    const meanGapMs = Math.abs(mean(measuredExisting) - mean(measuredFresh));
    const medianGapMs = Math.abs(median(measuredExisting) - median(measuredFresh));

    // A branch that skips the argon2 hash is faster by the full hash cost,
    // far above TOLERANCE_MS; an intact implementation differs only by noise.
    expect(meanGapMs).toBeLessThanOrEqual(TOLERANCE_MS);
    expect(medianGapMs).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('POST /auth/sign-in', () => {
  it('accepts the correct password', async () => {
    const email = freshEmail('sign-in-ok');
    await postSignUp(email, PASSWORD);

    const res = await postSignIn(email, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"status":"authenticated"}');
  });

  it('answers byte-identically for a wrong password and an unknown address', async () => {
    const email = freshEmail('sign-in-wrong');
    await postSignUp(email, PASSWORD);
    const wrongPassword = 'definitely-not-the-password';
    const emailsBefore = sentEmails.length;

    const wrong = await postSignIn(email, wrongPassword);
    const unknown = await postSignIn(freshEmail('sign-in-ghost'), wrongPassword);

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.text).toBe(unknown.text); // byte comparison
    expect(JSON.parse(wrong.text)).toEqual({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid email or password.',
        details: {},
      },
    });
    expect(headersIgnoringDate(wrong)).toEqual(headersIgnoringDate(unknown));
    expect(sentEmails.length).toBe(emailsBefore); // failure must not emit mail either
  });

  it('takes indistinguishably long for a wrong password and an unknown address over many samples', { timeout: 180_000 }, async () => {
    const email = freshEmail('timing-sign-in');
    await postSignUp(email, PASSWORD);

    const wrongMs: number[] = [];
    const unknownMs: number[] = [];

    for (let i = 0; i < WARMUP_SAMPLES + SAMPLES; i += 1) {
      const password = `wrong-password-${i}-equal-length`;

      const wrongStart = performance.now();
      const wrong = await postSignIn(email, password);
      wrongMs.push(performance.now() - wrongStart);
      expect(wrong.status).toBe(401);

      const unknownStart = performance.now();
      const unknown = await postSignIn(freshEmail(`timing-ghost-${i}`), password);
      unknownMs.push(performance.now() - unknownStart);
      expect(unknown.status).toBe(401);
    }

    const measuredWrong = wrongMs.slice(WARMUP_SAMPLES);
    const measuredUnknown = unknownMs.slice(WARMUP_SAMPLES);

    // A branch that skips the dummy verify is faster by the full verify
    // cost, far above TOLERANCE_MS; an intact implementation differs only
    // by noise.
    expect(Math.abs(mean(measuredWrong) - mean(measuredUnknown))).toBeLessThanOrEqual(TOLERANCE_MS);
    expect(Math.abs(median(measuredWrong) - median(measuredUnknown))).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('error envelope', () => {
  it('wraps rejected input in the standard envelope', async () => {
    const res = await postSignUp('not-an-email', 'short');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).toEqual({});
  });
});
