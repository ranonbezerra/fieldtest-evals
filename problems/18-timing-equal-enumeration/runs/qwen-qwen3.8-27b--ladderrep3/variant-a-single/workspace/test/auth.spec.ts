import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthRepository, EmailAlreadyExistsError } from '../src/auth/auth.repository.js';
import { Argon2idHasher, PasswordHasher } from '../src/auth/password-hash.js';
import { MAIL_PORT } from '../src/auth/auth.service.js';

// A real argon2id cost, reduced from production so the suite stays quick.
// The timing assertions are written against this cost: "slow enough" means
// "at least one real hash op at test cost". Deleting the hashing collapses
// every branch to a few milliseconds and these tests fail.
const TEST_HASH_PARAMS = { memoryCost: 8192, timeCost: 2, parallelism: 1 };

const SLOW_MAIL_DELAY_MS = 2000;
const MIN_BRANCH_MS = 10;
const TIMING_SAMPLES = 10;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A fresh, guaranteed-unique address for each test.
let counter = 0;
function freshEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}@example.test`;
}

interface StoredUser {
  email: string;
  passwordHash: string;
}

class FakeAuthRepository {
  private readonly users = new Map<string, StoredUser>();

  seed(email: string, passwordHash: string): void {
    this.users.set(email, { email, passwordHash });
  }

  get(email: string): StoredUser | null {
    return this.users.get(email) ?? null;
  }

  findByEmail(email: string): Promise<StoredUser | null> {
    return Promise.resolve(this.users.get(email) ?? null);
  }

  create(email: string, passwordHash: string): Promise<StoredUser> {
    if (this.users.has(email)) {
      return Promise.reject(new EmailAlreadyExistsError(email));
    }
    const record: StoredUser = { email, passwordHash };
    this.users.set(email, record);
    return Promise.resolve(record);
  }
}

interface MailCall {
  to: string;
  template: string;
  vars: Record<string, string>;
}

class FakeMailPort {
  calls: MailCall[] = [];
  private failing = false;
  private delayMs = 0;

  setFailing(failing: boolean): void {
    this.failing = failing;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
    }
    if (this.failing) {
      throw new Error('mail server unavailable');
    }
    this.calls.push({ to, template, vars });
  }
}

describe('auth endpoints (enumeration resistance)', () => {
  let app: INestApplication;
  const repository = new FakeAuthRepository();
  const mail = new FakeMailPort();
  const hasher = new Argon2idHasher(TEST_HASH_PARAMS);

  const existingEmail = 'existing@example.test';
  const existingPassword = 'existing-secret-1';
  const timingExistingEmail = 'timing-existing@example.test';

  beforeAll(async () => {
    // Seed addresses with real test-cost hashes so every branch that
    // verifies them does a full KDF op.
    repository.seed(existingEmail, await hasher.hash(existingPassword));
    repository.seed(timingExistingEmail, await hasher.hash('timing-seed-password'));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(PasswordHasher)
      .useValue(hasher)
      .overrideProvider(MAIL_PORT)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe('sign-up', () => {
    it('an existing address and a new one produce byte-identical responses', async () => {
      const existing = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password: 'supplied-secret-1' });
      const fresh = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: freshEmail('bytes-fresh'), password: 'supplied-secret-1' });

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      expect(Buffer.from(existing.text, 'utf8')).toEqual(Buffer.from(fresh.text, 'utf8'));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
      expect(existing.headers['content-type']).toBe(fresh.headers['content-type']);
    });

    it('leaves an existing account untouched', async () => {
      const before = repository.get(existingEmail);
      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password: 'other-secret-1' });

      expect(res.status).toBe(202);
      expect(repository.get(existingEmail)).toEqual(before);
    });

    it('stores a new address with a hash that verifies', async () => {
      const email = freshEmail('created');
      const password = 'created-secret-1';
      const res = await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('accepted');
      const record = repository.get(email);
      expect(record).not.toBeNull();
      expect(await hasher.verify(record!.passwordHash, password)).toBe(true);
    });

    it('mails a verification to a new address and an alert to an existing one', async () => {
      mail.calls.length = 0;
      const email = freshEmail('mail');
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password: 'mail-secret-1' });
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: existingEmail, password: 'mail-secret-1' });
      // Mail is fire-and-forget; give the out-of-band promises a tick to land.
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });

      const forNew = mail.calls.find((call) => call.to === email);
      const forExisting = mail.calls.find((call) => call.to === existingEmail);
      expect(forNew?.template).toBe('sign-up-verification');
      expect(forNew?.vars).toEqual({ email });
      expect(forExisting?.template).toBe('sign-up-attempt-alert');
    });

    it('a mail failure changes nothing the caller observes', async () => {
      mail.setFailing(true);
      const email = freshEmail('mail-fail');
      try {
        const existing = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: existingEmail, password: 'fail-secret-1' });
        const fresh = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email, password: 'fail-secret-1' });

        expect(existing.status).toBe(202);
        expect(fresh.status).toBe(202);
        expect(Buffer.from(existing.text, 'utf8')).toEqual(Buffer.from(fresh.text, 'utf8'));

        // Let the rejected deliveries settle; the service catches them.
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
      } finally {
        mail.setFailing(false);
      }
    });

    it('does not wait on the mailer for the response', async () => {
      mail.setDelay(SLOW_MAIL_DELAY_MS);
      const email = freshEmail('slow-mail');
      try {
        const started = performance.now();
        const res = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email, password: 'slow-secret-1' });
        const elapsedMs = performance.now() - started;

        expect(res.status).toBe(202);
        // If the response path awaited mail, this would take >= SLOW_MAIL_DELAY_MS.
        expect(elapsedMs).toBeLessThan(SLOW_MAIL_DELAY_MS / 2);
      } finally {
        mail.setDelay(0);
      }
    });

    it('existing and new branches take statistically indistinguishable time', async () => {
      // Warm-up: absorb one-time costs (first KDF call, socket setup) so the
      // samples measure steady state.
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: timingExistingEmail, password: 'warm-secret-1' });
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: freshEmail('warm'), password: 'warm-secret-1' });

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < TIMING_SAMPLES; i += 1) {
        let started = performance.now();
        const existing = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: timingExistingEmail, password: 'timing-secret-1' });
        existingTimes.push(performance.now() - started);
        expect(existing.status).toBe(202);

        started = performance.now();
        const fresh = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: freshEmail('timing-fresh'), password: 'timing-secret-1' });
        freshTimes.push(performance.now() - started);
        expect(fresh.status).toBe(202);
      }

      const existingMedian = median(existingTimes);
      const freshMedian = median(freshTimes);

      // Both branches must be slow enough to include a real hash op. Without
      // hashing, both medians collapse to a few milliseconds and these fail.
      expect(existingMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);
      expect(freshMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);

      // The medians must agree within a tolerance that scales with the work.
      // Without equalisation, one branch collapses and this line fails.
      const toleranceMs = Math.max(15, 0.3 * Math.min(existingMedian, freshMedian));
      expect(Math.abs(existingMedian - freshMedian)).toBeLessThanOrEqual(toleranceMs);
    }, 60_000);
  });

  describe('sign-in', () => {
    it('a wrong password and an unknown address produce byte-identical responses', async () => {
      const wrong = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: 'definitely-wrong-1' });
      const unknown = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: freshEmail('unknown-in'), password: 'definitely-wrong-1' });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(Buffer.from(wrong.text, 'utf8')).toEqual(Buffer.from(unknown.text, 'utf8'));
      expect(wrong.headers['content-length']).toBe(unknown.headers['content-length']);
      expect(wrong.headers['content-type']).toBe(unknown.headers['content-type']);

      const body = wrong.body as { error?: { code?: string; details?: unknown } };
      expect(body.error?.code).toBe('authentication_failed');
      expect(typeof body.error?.details).toBe('object');
      expect(body.error?.details).not.toBeNull();
    });

    it('authenticates correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: existingPassword });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'authenticated', email: existingEmail });
    });

    it('a wrong password and an unknown address take statistically indistinguishable time', async () => {
      // Warm-up: absorb one-time costs.
      await request(app.getHttpServer()).post('/auth/sign-in').send({ email: existingEmail, password: 'warm-wrong-1' });
      await request(app.getHttpServer()).post('/auth/sign-in').send({ email: freshEmail('warm-in'), password: 'warm-wrong-1' });

      const wrongTimes: number[] = [];
      const unknownTimes: number[] = [];
      for (let i = 0; i < TIMING_SAMPLES; i += 1) {
        let started = performance.now();
        const wrong = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: existingEmail, password: `wrong-${i}-secret-1` });
        wrongTimes.push(performance.now() - started);
        expect(wrong.status).toBe(401);

        started = performance.now();
        const unknown = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: freshEmail('timing-unknown'), password: `wrong-${i}-secret-1` });
        unknownTimes.push(performance.now() - started);
        expect(unknown.status).toBe(401);
      }

      const wrongMedian = median(wrongTimes);
      const unknownMedian = median(unknownTimes);

      // Both branches must be slow enough to include a real hash op.
      expect(wrongMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);
      expect(unknownMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);

      // Without the dummy-hash equalisation the unknown branch collapses.
      const toleranceMs = Math.max(15, 0.3 * Math.min(wrongMedian, unknownMedian));
      expect(Math.abs(wrongMedian - unknownMedian)).toBeLessThanOrEqual(toleranceMs);
    }, 60_000);
  });

  it('rejects malformed input with the standard envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'not-an-address', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(res.body.error.details).toEqual({});
  });
});
