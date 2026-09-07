import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DUPLICATE_SIGN_UP_TEMPLATE, VERIFICATION_TEMPLATE } from '../src/auth/auth.service.js';
import { MAIL_PORT, type MailPort } from '../src/mail/mail.module.js';

const SIGN_UP = '/auth/sign-up';
const SIGN_IN = '/auth/sign-in';

type MailRecord = { to: string; template: string; vars: Record<string, string> };

const mails: MailRecord[] = [];

const mailPort: MailPort = {
  sendEmail: async (to, template, vars) => {
    mails.push({ to, template, vars });
  },
};

let app: INestApplication;
let server: Server;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await app.close();
});

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await run();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The core property of this API: responses for the two branches an attacker
 * cares about must be indistinguishable by status, by raw body bytes, and by
 * the headers a caller can read.
 */
function expectIndistinguishable(a: request.Response, b: request.Response): void {
  expect(a.status, 'status codes must match').toBe(b.status);
  const bytesA = Buffer.from(a.text, 'utf8');
  const bytesB = Buffer.from(b.text, 'utf8');
  expect(Buffer.compare(bytesA, bytesB), 'body bytes must be identical').toBe(0);
  for (const header of ['content-type', 'content-length', 'x-powered-by']) {
    expect(a.headers[header], `header ${header} must match`).toBe(b.headers[header]);
  }
}

describe('POST /auth/sign-up', () => {
  it('answers a new address and a taken address with byte-identical responses', async () => {
    const taken = `taken-${randomUUID()}@example.com`;
    const fresh = `fresh-${randomUUID()}@example.com`;

    const seed = await request(server).post(SIGN_UP).send({ email: taken, password: 'taken-pw-12345' });
    expect(seed.status).toBe(202);

    const firstAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const secondAttempt = await request(server).post(SIGN_UP).send({ email: taken, password: 'other-pw-12345' });
    const freshAttempt = await request(server).post(SIGN_UP).send({ email: fresh, password: 'other-pw-12345' });

    expect(firstAttempt.status).toBe(202);
    expect(secondAttempt.status).toBe(202);
    expect(freshAttempt.status).toBe(202);

    expectIndistinguishable(firstAttempt, secondAttempt);
    expectIndistinguishable(firstAttempt, freshAttempt);
    expect(typeof firstAttempt.body?.message).toBe('string');
  });

  it('delivers the real outcome through mail while the caller sees the same thing', async () => {
    const owner = `owner-${randomUUID()}@example.com`;
    const newbie = `newbie-${randomUUID()}@example.com`;

    const first = await request(server).post(SIGN_UP).send({ email: owner, password: 'owner-pw-12345' });
    const retry = await request(server).post(SIGN_UP).send({ email: owner, password: 'intruder-pw-12345' });
    const signup = await request(server).post(SIGN_UP).send({ email: newbie, password: 'newbie-pw-12345' });

    expect(first.status).toBe(202);
    expectIndistinguishable(retry, signup);

    const toOwner = mails.filter((mail) => mail.to === owner);
    const toNewbie = mails.filter((mail) => mail.to === newbie);

    expect(toOwner.some((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toOwner.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(true);

    expect(toNewbie.length).toBeGreaterThan(0);
    expect(toNewbie.every((mail) => mail.template === VERIFICATION_TEMPLATE)).toBe(true);
    expect(toNewbie.some((mail) => mail.template === DUPLICATE_SIGN_UP_TEMPLATE)).toBe(false);
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 20;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const takenTimes: number[] = [];
    const freshTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      takenTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_UP).send({ email: victim, password: `taken-sample-${i}-pw` }),
        ),
      );
      freshTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_UP).send({
            email: `fresh-timing-${randomUUID()}@example.com`,
            password: `fresh-sample-${i}-pw`,
          }),
        ),
      );
    }

    const takenMean = mean(takenTimes);
    const freshMean = mean(freshTimes);

    expect(takenMean, `taken-address mean ${takenMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(freshMean, `new-address mean ${freshMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(takenMean - freshMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (taken=${takenMean.toFixed(1)} ms, fresh=${freshMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('POST /auth/sign-in', () => {
  it('answers a wrong password and an unknown address with byte-identical 401s', async () => {
    const known = `known-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'known-pw-12345' });

    const wrongPassword = await request(server).post(SIGN_IN).send({ email: known, password: 'wrong-pw-12345' });
    const unknownAddress = await request(server).post(SIGN_IN).send({
      email: `unknown-${randomUUID()}@example.com`,
      password: 'wrong-pw-12345',
    });

    expect(wrongPassword.status).toBe(401);
    expectIndistinguishable(wrongPassword, unknownAddress);
    expect(wrongPassword.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', details: {} },
    });
  });

  it('still lets the legitimate owner in', async () => {
    const known = `legit-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: known, password: 'legit-pw-12345' });

    const ok = await request(server).post(SIGN_IN).send({ email: known, password: 'legit-pw-12345' });
    expect(ok.status).toBe(200);
    expect(typeof ok.body?.message).toBe('string');
  });

  it('takes statistically the same time on both branches across repeated samples', async () => {
    const SAMPLES = 15;
    const TOLERANCE_MS = 50;
    const MIN_PLAUSIBLE_MS = 100;

    const victim = `signin-victim-${randomUUID()}@example.com`;
    await request(server).post(SIGN_UP).send({ email: victim, password: 'victim-pw-12345' });

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_IN).send({ email: victim, password: `wrong-sample-${i}-pw` }),
        ),
      );
      unknownTimes.push(
        await elapsedMs(() =>
          request(server).post(SIGN_IN).send({
            email: `no-account-${randomUUID()}@example.com`,
            password: `wrong-sample-${i}-pw`,
          }),
        ),
      );
    }

    const wrongMean = mean(wrongTimes);
    const unknownMean = mean(unknownTimes);

    expect(wrongMean, `wrong-password mean ${wrongMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(unknownMean, `unknown-address mean ${unknownMean.toFixed(1)} ms must involve real work`).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_MS);
    expect(
      Math.abs(wrongMean - unknownMean),
      `branch means must be within ${TOLERANCE_MS} ms of each other (wrong=${wrongMean.toFixed(1)} ms, unknown=${unknownMean.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });
});

describe('request validation', () => {
  it('rejects malformed bodies with the standard error envelope', async () => {
    const bad = await request(server).post(SIGN_UP).send({ email: 'not-an-email', password: 'short' });

    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
    expect(typeof bad.body.error.message).toBe('string');
    expect(bad.body.error.details).toEqual({});
  });
});
