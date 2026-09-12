import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import type { CreateResult, StoredUser } from '../src/auth/auth.repository.js';
import { MAIL_PORT } from '../src/mail/mail.port.js';
import type { MailPort } from '../src/mail/mail.port.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

// Real argon2id at a low-but-real cost so the suite stays fast. The cost is
// identical for both branches, which is exactly what the suite verifies.
process.env.PASSWORD_HASH_MEMORY_KB = '32768';
process.env.PASSWORD_HASH_TIME_COST = '1';
process.env.PASSWORD_HASH_PARALLELISM = '1';

const SIGN_UP_BODY = { message: 'If this is your address, we just sent you an email.' };
const SIGN_IN_OK_BODY = { message: 'ok' };
const SIGN_IN_ERROR_BODY = {
  error: { code: 'invalid_credentials', message: 'Invalid email or password.', details: {} },
};

interface HttpObservation {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface SentMail {
  to: string;
  template: string;
  vars: Record<string, string>;
  done: Promise<void>;
}

class InMemoryAuthRepository {
  private readonly users = new Map<string, StoredUser>();

  findByEmail(email: string): Promise<StoredUser | null> {
    return Promise.resolve(this.users.get(email) ?? null);
  }

  createOrReturnExisting(email: string, passwordHash: string): Promise<CreateResult> {
    const existing = this.users.get(email);
    if (existing) {
      return Promise.resolve({ user: existing, created: false });
    }
    const user: StoredUser = {
      id: `id-${this.users.size + 1}`,
      email,
      passwordHash,
      createdAt: new Date(),
    };
    this.users.set(email, user);
    return Promise.resolve({ user, created: true });
  }

  count(): number {
    return this.users.size;
  }
}

class FakeMailPort implements MailPort {
  sent: SentMail[] = [];
  failNext = false;

  async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
    const done = new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
    this.sent.push({ to, template, vars, done });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mailer down');
    }
    await done;
  }

  async flush(): Promise<void> {
    await Promise.all(this.sent.map((item) => item.done));
  }

  clear(): void {
    this.sent = [];
  }
}

let app: INestApplication;
let repository: InMemoryAuthRepository;
let mail: FakeMailPort;

beforeAll(async () => {
  repository = new InMemoryAuthRepository();
  mail = new FakeMailPort();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .overrideProvider(MAIL_PORT)
    .useValue(mail)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

beforeEach(() => {
  mail.clear();
});

afterAll(async () => {
  await app.close();
});

const post = (path: string, body: object): Promise<HttpObservation> =>
  request(app.getHttpServer()).post(path).send(body);
const signUp = (email: string, password: string): Promise<HttpObservation> =>
  post('/auth/sign-up', { email, password });
const signIn = (email: string, password: string): Promise<HttpObservation> =>
  post('/auth/sign-in', { email, password });

let seq = 0;
const uniqueEmail = (label: string): string => {
  seq += 1;
  return `${label}-${seq}-${Math.random().toString(36).slice(2)}@site.test`;
};

// Headers that legitimately differ between two requests; everything else must match.
function nonVolatileHeaders(res: HttpObservation): Record<string, string> {
  const volatile = new Set(['date', 'connection', 'keep-alive']);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (value !== undefined && !volatile.has(name)) {
      headers[name] = Array.isArray(value) ? value.join(',') : value;
    }
  }
  return headers;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function timedPost(path: string, body: object): Promise<number> {
  const started = process.hrtime.bigint();
  const res = await post(path, body);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  expect(res.status).toBeLessThan(500);
  return elapsedMs;
}

describe('POST /auth/sign-up', () => {
  it('creates the account and mails a verification email for a new address', async () => {
    const email = uniqueEmail('fresh');

    const res = await signUp(email, 'fresh-password-000001');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);

    const stored = await repository.findByEmail(email);
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);

    await mail.flush();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(email);
    expect(mail.sent[0].template).toBe('sign-up-verification');
    expect(mail.sent[0].vars).toEqual({ email });
  });

  it('creates no account and mails the taken-notice for a taken address', async () => {
    const email = uniqueEmail('taken');
    await signUp(email, 'taken-seed-password-001');
    mail.clear();
    const accountsBefore = repository.count();

    const res = await signUp(email, 'attacker-guess-password');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);
    expect(repository.count()).toBe(accountsBefore);

    await mail.flush();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(email);
    expect(mail.sent[0].template).toBe('sign-up-taken');
  });

  it('answers a new address and a taken address with byte-identical responses', async () => {
    const taken = uniqueEmail('cmp-taken');
    await signUp(taken, 'cmp-taken-seed-passw1');

    const resFresh = await signUp(uniqueEmail('cmp-fresh'), 'cmp-fresh-password-001');
    const resTaken = await signUp(taken, 'cmp-attacker-guess-001');

    expect(resFresh.status).toBe(202);
    expect(resFresh.status).toBe(resTaken.status);
    expect(Buffer.from(resFresh.text, 'utf8').equals(Buffer.from(resTaken.text, 'utf8'))).toBe(true);
    expect(nonVolatileHeaders(resFresh)).toEqual(nonVolatileHeaders(resTaken));
  });

  it('keeps the response unchanged when the mail port fails', async () => {
    mail.failNext = true;
    const res = await signUp(uniqueEmail('maildown'), 'maildown-password-0001');
    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGN_UP_BODY);
    await mail.flush();
  });

  it('answers 400 with the error envelope for an invalid body', async () => {
    const res = await signUp('not-an-email', 'short');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'invalid_request', message: expect.any(String), details: {} },
    });
  });
});

describe('POST /auth/sign-in', () => {
  it('accepts the correct credentials', async () => {
    const email = uniqueEmail('known');
    await signUp(email, 'known-password-000001');

    const res = await signIn(email, 'known-password-000001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SIGN_IN_OK_BODY);
  });

  it('rejects a wrong password with the 401 error envelope', async () => {
    const email = uniqueEmail('known');
    await signUp(email, 'known-password-000001');

    const res = await signIn(email, 'wrong-password-000001');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(SIGN_IN_ERROR_BODY);
  });

  it('answers an unknown address with a byte-identical 401', async () => {
    const known = uniqueEmail('known');
    await signUp(known, 'known-password-000001');

    const resWrong = await signIn(known, 'wrong-password-000001');
    const resUnknown = await signIn(uniqueEmail('ghost'), 'wrong-password-000001');

    expect(resWrong.status).toBe(401);
    expect(resUnknown.status).toBe(resWrong.status);
    expect(Buffer.from(resWrong.text, 'utf8').equals(Buffer.from(resUnknown.text, 'utf8'))).toBe(true);
    expect(nonVolatileHeaders(resWrong)).toEqual(nonVolatileHeaders(resUnknown));
  });
});

describe('timing equality', () => {
  const SAMPLES = 30;

  it('sign-up: a new address and a taken address take statistically the same time', async () => {
    const taken = uniqueEmail('timing-taken');
    await signUp(taken, 'timing-seed-password-01');
    // Warm up the connection and both code paths before measuring.
    for (let i = 0; i < 3; i += 1) {
      await signUp(uniqueEmail('timing-warm'), 'timing-warmup-pass-00001');
      await signIn(taken, 'timing-warmup-pass-00001');
    }

    const freshTimes: number[] = [];
    const takenTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      freshTimes.push(
        await timedPost('/auth/sign-up', {
          email: uniqueEmail('timing-fresh'),
          password: 'timing-fresh-pass-00001',
        }),
      );
      takenTimes.push(
        await timedPost('/auth/sign-up', { email: taken, password: 'timing-guess-pass-00001' }),
      );
    }

    const freshMedian = median(freshTimes);
    const takenMedian = median(takenTimes);
    const ratio = Math.max(freshMedian, takenMedian) / Math.min(freshMedian, takenMedian);
    expect(
      ratio,
      `fresh=${freshMedian.toFixed(2)}ms taken=${takenMedian.toFixed(2)}ms ratio=${ratio.toFixed(2)}`,
    ).toBeLessThan(1.75);
  }, 30000);

  it('sign-in: a wrong password and an unknown address take statistically the same time', async () => {
    const known = uniqueEmail('timing-known');
    await signUp(known, 'timing-known-pass-00001');
    for (let i = 0; i < 3; i += 1) {
      await signIn(known, 'timing-warmup-pass-00001');
      await signIn(uniqueEmail('timing-warm-ghost'), 'timing-warmup-pass-00001');
    }

    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      wrongTimes.push(
        await timedPost('/auth/sign-in', { email: known, password: `timing-wrong-pass-${i}-0000` }),
      );
      unknownTimes.push(
        await timedPost('/auth/sign-in', {
          email: uniqueEmail('timing-ghost'),
          password: `timing-unknown-pass-${i}-0000`,
        }),
      );
    }

    const wrongMedian = median(wrongTimes);
    const unknownMedian = median(unknownTimes);
    const ratio = Math.max(wrongMedian, unknownMedian) / Math.min(wrongMedian, unknownMedian);
    expect(
      ratio,
      `wrong=${wrongMedian.toFixed(2)}ms unknown=${unknownMedian.toFixed(2)}ms ratio=${ratio.toFixed(2)}`,
    ).toBeLessThan(1.75);
  }, 30000);
});
