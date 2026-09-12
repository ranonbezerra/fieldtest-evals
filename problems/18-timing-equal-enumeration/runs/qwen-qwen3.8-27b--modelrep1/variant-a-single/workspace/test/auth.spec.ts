import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { INestApplication } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { EMAIL_TEMPLATES } from '../src/auth/auth.service.js';
import { MAIL_PORT } from '../src/auth/mail.port.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

interface HttpResponse {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

interface SentEmail {
  to: string;
  template: string;
  vars: Record<string, string>;
}

const sentEmails: SentEmail[] = [];
const prisma = new PrismaClient();

let app: INestApplication | undefined;
let server: Server;

const randomEmail = (): string => `user-${randomBytes(8).toString('hex')}@example.com`;

async function postSignUp(email: string, password: string): Promise<HttpResponse> {
  return request(server).post('/auth/sign-up').send({ email, password });
}

async function postSignIn(email: string, password: string): Promise<HttpResponse> {
  return request(server).post('/auth/sign-in').send({ email, password });
}

// Wall-clock duration of one request, in milliseconds.
const timed = async (run: () => Promise<HttpResponse>): Promise<number> => {
  const start = process.hrtime.bigint();
  await run();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
};

const median = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const headerFingerprint = (res: HttpResponse): [string, string][] =>
  Object.entries(res.headers)
    .filter(([name, value]) => name.toLowerCase() !== 'date' && value !== undefined)
    .map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(',') : value])
    .sort(([a], [b]) => a.localeCompare(b));

function expectIdenticalResponse(a: HttpResponse, b: HttpResponse): void {
  expect(a.status).toBe(b.status);
  // Byte comparison, not string comparison: the two bodies must be the same
  // exact sequence of bytes.
  expect(Buffer.from(a.text, 'utf8').equals(Buffer.from(b.text, 'utf8'))).toBe(true);
  // Same headers, too ("date" is volatile and excluded).
  expect(headerFingerprint(a)).toEqual(headerFingerprint(b));
}

function ensureSchemaMigrated(): void {
  const bin = path.join(projectRoot, 'node_modules', '.bin');
  try {
    execSync('prisma migrate deploy', {
      cwd: projectRoot,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch {
    // If the CLI is unavailable the harness is expected to have provisioned
    // the schema already; failing database assertions will surface that.
  }
}

beforeAll(async () => {
  ensureSchemaMigrated();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue({
      sendEmail: async (to: string, template: string, vars: Record<string, string>): Promise<void> => {
        sentEmails.push({ to, template, vars });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer();
}, 120_000);

afterAll(async () => {
  if (app !== undefined) {
    await app.close();
  }
  await prisma.$disconnect();
}, 30_000);

describe('POST /auth/sign-up', () => {
  it('returns byte-identical responses for a new and an existing address', async () => {
    const taken = randomEmail();
    const created = await postSignUp(taken, 'initial-password-one');
    expect(created.status).toBe(201);

    const repeat = await postSignUp(taken, 'attacker-password-two');
    const fresh = await postSignUp(randomEmail(), 'attacker-password-two');

    expectIdenticalResponse(repeat, fresh);
    expect(repeat.status).toBe(201);
    const body = JSON.parse(repeat.text) as { message?: unknown };
    expect(typeof body.message).toBe('string');
  }, 60_000);

  it('emails the owner the truth without changing the response', async () => {
    const owner = randomEmail();
    const realPassword = 'owner-real-password';

    sentEmails.length = 0;
    const created = await postSignUp(owner, realPassword);
    expect(created.status).toBe(201);
    const verifyEmail = sentEmails.find((m) => m.template === EMAIL_TEMPLATES.verify);
    expect(verifyEmail?.to).toBe(owner);
    expect(typeof verifyEmail?.vars.token).toBe('string');

    sentEmails.length = 0;
    const repeat = await postSignUp(owner, 'not-the-real-password');
    expect(repeat.status).toBe(201);
    expect(sentEmails.map((m) => [m.to, m.template])).toEqual([[owner, EMAIL_TEMPLATES.signupAttempt]]);
  }, 60_000);

  it('does not modify the account when an existing address signs up again', async () => {
    const owner = randomEmail();
    const realPassword = 'owner-real-password';
    await postSignUp(owner, realPassword);

    const repeat = await postSignUp(owner, 'attacker-tries-to-change-the-password');
    expect(repeat.status).toBe(201);

    expect((await postSignIn(owner, realPassword)).status).toBe(200);
    expect((await postSignIn(owner, 'attacker-tries-to-change-the-password')).status).toBe(401);
  }, 60_000);

  it('stores an argon2id hash at a real cost factor', async () => {
    const owner = randomEmail();
    await postSignUp(owner, 'owner-real-password');

    const row = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const match = row.passwordHash.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(19456); // OWASP minimum memory cost
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(1);
    expect(Number(match?.[3])).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('keeps sign-up latency indistinguishable between the two branches', async () => {
    const taken = randomEmail();
    await postSignUp(taken, 'seed-password'); // also warms the connection pool

    const SAMPLES = 9;
    const repeatMs: number[] = [];
    const freshMs: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      // Interleave so drift and load affect both branches equally.
      repeatMs.push(await timed(() => postSignUp(taken, `repeat-${i}-password`)));
      freshMs.push(await timed(() => postSignUp(randomEmail(), `fresh-${i}-password`)));
    }

    const repeatMedian = median(repeatMs);
    const freshMedian = median(freshMs);
    // The KDF must dominate both branches; otherwise the measurement is
    // noise and the property cannot be verified.
    expect(repeatMedian).toBeGreaterThan(20);
    expect(freshMedian).toBeGreaterThan(20);
    // A branch that skips the KDF (or fakes it with a cheap stand-in) shifts
    // the median far beyond this margin; the equal design stays within it.
    expect(Math.abs(repeatMedian - freshMedian)).toBeLessThan(0.25 * Math.min(repeatMedian, freshMedian));
  }, 300_000);
});

describe('POST /auth/sign-in', () => {
  it('returns byte-identical 401s for a wrong password and an unknown address', async () => {
    const known = randomEmail();
    await postSignUp(known, 'owner-real-password');

    const wrongPassword = await postSignIn(known, 'wrong-1');
    const unknownAddress = await postSignIn(randomEmail(), 'wrong-1-but-longer-padding-here');

    expectIdenticalResponse(wrongPassword, unknownAddress);
    expect(wrongPassword.status).toBe(401);
    const body = JSON.parse(wrongPassword.text) as { error: { code: string; message: string; details: unknown } };
    expect(body.error.code).toBe('invalid_credentials');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual({});
  }, 60_000);

  it('accepts the correct password', async () => {
    const known = randomEmail();
    const realPassword = 'owner-real-password';
    await postSignUp(known, realPassword);

    const ok = await postSignIn(known, realPassword);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ authenticated: true });
  }, 60_000);

  it('sends no email on sign-in failure', async () => {
    const known = randomEmail();
    await postSignUp(known, 'owner-real-password');

    sentEmails.length = 0;
    await postSignIn(known, 'wrong-password');
    await postSignIn(randomEmail(), 'wrong-password');
    expect(sentEmails).toEqual([]);
  }, 60_000);

  it('keeps sign-in latency indistinguishable between the two failure modes', async () => {
    const known = randomEmail();
    await postSignUp(known, 'owner-real-password'); // also warms the pool

    const SAMPLES = 9;
    const wrongMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongMs.push(await timed(() => postSignIn(known, `wrong-${i}`)));
      unknownMs.push(await timed(() => postSignIn(randomEmail(), `wrong-${i}`)));
    }

    const wrongMedian = median(wrongMs);
    const unknownMedian = median(unknownMs);
    expect(wrongMedian).toBeGreaterThan(20);
    expect(unknownMedian).toBeGreaterThan(20);
    expect(Math.abs(wrongMedian - unknownMedian)).toBeLessThan(0.25 * Math.min(wrongMedian, unknownMedian));
  }, 300_000);
});

describe('input validation', () => {
  it('rejects malformed bodies with the standard error envelope', async () => {
    const badEmail = await request(server).post('/auth/sign-up').send({ email: 'no-at-sign', password: 'password-123' });
    const badPassword = await request(server).post('/auth/sign-in').send({ email: randomEmail(), password: '' });

    for (const res of [badEmail, badPassword]) {
      expect(res.status).toBe(400);
      const body = JSON.parse(res.text) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('invalid_input');
      expect(typeof body.error.details).toBe('object');
      expect(body.error.details).not.toBeNull();
    }
  }, 30_000);
});
