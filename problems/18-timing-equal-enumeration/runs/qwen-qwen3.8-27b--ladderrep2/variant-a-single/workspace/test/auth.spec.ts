import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { MAIL_PORT, MailPort } from '../src/mail/mail.port.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

// Test-only value; production reads JWT_SECRET from the environment.
process.env.JWT_SECRET ??= 'test-only-jwt-secret';

// ---------------------------------------------------------------------------
// Fakes. The equalisation property lives in the hashing work inside the service,
// so an in-memory repository isolates exactly that: no Postgres needed to break
// or prove the property.
// ---------------------------------------------------------------------------

class InMemoryAuthRepository {
  private readonly users = new Map<string, { id: string; email: string; passwordHash: string }>();

  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null> {
    const row = this.users.get(email);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  create(email: string, passwordHash: string): Promise<boolean> {
    if (this.users.has(email)) return Promise.resolve(false);
    this.users.set(email, { id: randomUUID(), email, passwordHash });
    return Promise.resolve(true);
  }
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, string>;
}

const repo = new InMemoryAuthRepository();
const sent: SentMail[] = [];
let mailFails = false;

const mailPort: MailPort = {
  sendEmail(to, template, vars): Promise<void> {
    if (mailFails) return Promise.reject(new Error('smtp down'));
    sent.push({ to, template, vars });
    return Promise.resolve();
  },
};

// ---------------------------------------------------------------------------
// App and helpers
// ---------------------------------------------------------------------------

let app: INestApplication;
let server: unknown;

interface WireResponse {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

const uid = (): string => randomUUID().replace(/-/g, '').slice(0, 12);

const post = (path: string, body: unknown): Promise<WireResponse> =>
  (request(server).post(path).send(body) as unknown) as Promise<WireResponse>;

// Mail is fired out of band; give the fake a moment to record deliveries.
const flushMail = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

const bytesOf = (res: WireResponse): Buffer => Buffer.from(res.text, 'utf8');

const headersOf = (res: WireResponse): Record<string, string | string[] | undefined> => {
  const headers = { ...res.headers };
  delete headers.date; // wall-clock header, not part of the response contract
  return headers;
};

const timed = async (call: () => Promise<unknown>): Promise<number> => {
  const start = process.hrtime.bigint();
  await call();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
};

const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Below this floor a branch cannot have run a real derivation.
const FLOOR_MS = 20;
// With equalisation broken (one branch skipping the hash), the means differ by
// 10x more than this; with it working, noise is a fraction of it.
const tolerance = (a: number, b: number): number => Math.max(15, 0.25 * Math.max(a, b));
const SAMPLES = 7;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
    .overrideProvider(AuthRepository)
    .useValue(repo)
    .overrideProvider(MAIL_PORT)
    .useValue(mailPort)
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter()); // same wiring as src/main.ts
  await app.init();
  server = app.getHttpServer();
}, 60_000);

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Identical responses, compared byte for byte
// ---------------------------------------------------------------------------

it('sign-up answers byte-identical responses for new and existing addresses', async () => {
  const email = `dupe-${uid()}@example.test`;
  const password = 'correct-horse-battery';
  const fresh = await post('/auth/sign-up', { email, password });
  const existing = await post('/auth/sign-up', { email, password });

  expect(fresh.status).toBe(200);
  expect(existing.status).toBe(200);
  expect(bytesOf(fresh).equals(bytesOf(existing))).toBe(true);
  expect(headersOf(fresh)).toEqual(headersOf(existing));
}, 30_000);

it('sign-in answers byte-identical responses for wrong password and unknown address', async () => {
  const email = `login-${uid()}@example.test`;
  await post('/auth/sign-up', { email, password: 'right-password-9' });

  const wrongPassword = await post('/auth/sign-in', { email, password: 'wrong-password-1' });
  const unknownAddress = await post('/auth/sign-in', {
    email: `ghost-${uid()}@example.test`,
    password: 'wrong-password-1',
  });

  expect(wrongPassword.status).toBe(401);
  expect(unknownAddress.status).toBe(401);
  expect(bytesOf(wrongPassword).equals(bytesOf(unknownAddress))).toBe(true);
  expect(headersOf(wrongPassword)).toEqual(headersOf(unknownAddress));
}, 30_000);

it('sign-in with the right password still succeeds and issues a token', async () => {
  const email = `ok-${uid()}@example.test`;
  const password = 'right-password-9';
  await post('/auth/sign-up', { email, password });

  const res = await post('/auth/sign-in', { email, password });
  expect(res.status).toBe(200);
  const body = JSON.parse(res.text) as { token?: unknown };
  expect(typeof body.token).toBe('string');
  expect((body.token as string).length).toBeGreaterThan(0);
}, 30_000);

// ---------------------------------------------------------------------------
// Timing: distributions over repeated samples; both branches must pay real work
// ---------------------------------------------------------------------------

it('sign-up: new and existing branches are statistically indistinguishable over repeated samples', async () => {
  const password = 'timing-password-1';

  // Warm-up: resolves the dummy hash and warms argon2 before any measurement.
  const warm = `warm-${uid()}@example.test`;
  await post('/auth/sign-up', { email: warm, password });
  await post('/auth/sign-up', { email: warm, password });

  const fresh: number[] = [];
  const existing: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const email = `timing-${uid()}@example.test`;
    fresh.push(await timed(() => post('/auth/sign-up', { email, password })));
    existing.push(await timed(() => post('/auth/sign-up', { email, password })));
  }

  const freshMean = mean(fresh);
  const existingMean = mean(existing);
  // Both branches must be slow enough to have actually run a derivation:
  // deleting the hashing must fail this test.
  expect(freshMean).toBeGreaterThanOrEqual(FLOOR_MS);
  expect(existingMean).toBeGreaterThanOrEqual(FLOOR_MS);
  // Removing the dummy verify on the existing branch must fail this test.
  expect(Math.abs(freshMean - existingMean)).toBeLessThanOrEqual(tolerance(freshMean, existingMean));
  expect(Math.abs(median(fresh) - median(existing))).toBeLessThanOrEqual(tolerance(median(fresh), median(existing)));
}, 90_000);

it('sign-in: unknown address and wrong password are statistically indistinguishable over repeated samples', async () => {
  const email = `timing-login-${uid()}@example.test`;
  await post('/auth/sign-up', { email, password: 'right-password-9' });

  // Warm-up on both branches.
  await post('/auth/sign-in', { email: `ghost-warm-${uid()}@example.test`, password: 'wrong-password-1' });
  await post('/auth/sign-in', { email, password: 'wrong-password-1' });

  const unknown: number[] = [];
  const wrong: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    unknown.push(
      await timed(() => post('/auth/sign-in', { email: `ghost-${uid()}@example.test`, password: 'wrong-password-1' })),
    );
    wrong.push(await timed(() => post('/auth/sign-in', { email, password: `wrong-${i}-password` })));
  }

  const unknownMean = mean(unknown);
  const wrongMean = mean(wrong);
  expect(unknownMean).toBeGreaterThanOrEqual(FLOOR_MS);
  expect(wrongMean).toBeGreaterThanOrEqual(FLOOR_MS);
  expect(Math.abs(unknownMean - wrongMean)).toBeLessThanOrEqual(tolerance(unknownMean, wrongMean));
  expect(Math.abs(median(unknown) - median(wrong))).toBeLessThanOrEqual(tolerance(median(unknown), median(wrong)));
}, 90_000);

// ---------------------------------------------------------------------------
// Out-of-band mail: the owner is reached, the caller is not affected
// ---------------------------------------------------------------------------

it('sends a verification mail for a new address and an attempt notice for an existing one, without changing the response', async () => {
  sent.length = 0;
  const email = `mail-${uid()}@example.test`;
  const password = 'mail-password-1';

  const fresh = await post('/auth/sign-up', { email, password });
  const existing = await post('/auth/sign-up', { email, password });

  expect(fresh.status).toBe(200);
  expect(existing.status).toBe(200);
  expect(bytesOf(fresh).equals(bytesOf(existing))).toBe(true);

  await flushMail();
  expect(sent).toEqual([
    { to: email, template: 'verification_email', vars: { email } },
    { to: email, template: 'sign_up_attempt', vars: { email } },
  ]);
}, 30_000);

it('a mail failure changes nothing the caller observes', async () => {
  const email = `fail-${uid()}@example.test`;
  const password = 'fail-password-1';
  await post('/auth/sign-up', { email, password });
  await flushMail();
  sent.length = 0;

  mailFails = true;
  const whileFailing = await post('/auth/sign-up', { email, password });
  mailFails = false;
  const control = await post('/auth/sign-up', { email: `control-${uid()}@example.test`, password });

  await flushMail();
  expect(whileFailing.status).toBe(200);
  expect(whileFailing.text).toBe(control.text);
  expect(headersOf(whileFailing)).toEqual(headersOf(control));
  expect(sent).toHaveLength(1); // only the control's verification mail went out
}, 30_000);

// ---------------------------------------------------------------------------
// Error envelope and the no-random-padding rule
// ---------------------------------------------------------------------------

it('errors use the single envelope with an object details', async () => {
  const bad = await post('/auth/sign-up', { email: 'not-an-email', password: 'short' });
  expect(bad.status).toBe(400);
  const badBody = JSON.parse(bad.text) as { error: { code: string; message: string; details: unknown } };
  expect(badBody.error.code).toBe('invalid_input');
  expect(typeof badBody.error.message).toBe('string');
  expect(badBody.error.details).toBeTypeOf('object');
  expect(badBody.error.details).not.toBeNull();

  const denied = await post('/auth/sign-in', { email: `ghost-${uid()}@example.test`, password: 'wrong-password-1' });
  expect(denied.status).toBe(401);
  const deniedBody = JSON.parse(denied.text) as { error: { code: string; details: unknown } };
  expect(deniedBody.error.code).toBe('invalid_credentials');
  expect(deniedBody.error.details).toBeTypeOf('object');
}, 30_000);

it('the response path contains no random padding', () => {
  for (const file of ['auth.service.ts', 'auth.controller.ts', 'auth.repository.ts']) {
    const source = readFileSync(new URL(`../src/auth/${file}`, import.meta.url), 'utf8');
    expect(source).not.toContain('Math.random');
  }
});
