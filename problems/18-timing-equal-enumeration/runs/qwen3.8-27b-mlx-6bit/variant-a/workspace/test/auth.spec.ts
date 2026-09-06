import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthFailureError } from '../src/auth/auth.service';
// ASSUMPTION: MAIL_PORT is a DI token constant (string or Symbol) exported from
// auth.service.ts. The plan references "a token-level provider" for the mail port;
// without seeing the source we assume a named constant rather than the interface
// being used directly as a runtime token.
import { MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ─── Types & helpers ───────────────────────────────────────────────────────────

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

interface MailCall {
  to: string;
  template: string;
  vars: Record<string, string>;
}

function buildPrismaMock(users: Map<string, StoredUser>) {
  return {
    user: {
      findUnique: async (args: { where: Record<string, string> }) => {
        if (args.where.email !== undefined) {
          return users.get(args.where.email) ?? null;
        }
        if (args.where.id !== undefined) {
          for (const u of users.values()) {
            if (u.id === args.where.id) return u;
          }
          return null;
        }
        return null;
      },
      create: async (args: { data: { email: string; passwordHash: string } }) => {
        const id = crypto.randomUUID();
        const record: StoredUser = {
          id,
          email: args.data.email,
          passwordHash: args.data.passwordHash,
          createdAt: new Date(),
        };
        users.set(args.data.email, record);
        return { id };
      },
      update: async () => ({}),
    },
  };
}

async function createApp(
  users: Map<string, StoredUser>,
  mailCalls: MailCall[],
): Promise<INestApplication> {
  const prismaMock = buildPrismaMock(users);
  const mailMock = {
    sendEmail: async (to: string, template: string, vars: Record<string, string>) => {
      mailCalls.push({ to, template, vars });
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .overrideProvider(MAIL_PORT)
    .useValue(mailMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  return app;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  // Test 1: sign-up new email → 200, correct body
  it('sign-up with a new email returns 200 and the standard message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'new@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 2: sign-up existing email → 200, correct body
  it('sign-up with an existing email returns 200 and the same message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password456' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 3: sign-up byte-equality of response (new vs existing)
  it('sign-up responses are byte-identical for new and existing emails', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Pre-create so we have an "existing" case
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password123' })
      .expect(200);

    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'brandnew@example.com', password: 'password123' });

    const resExisting = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password456' });

    expect(resNew.status).toBe(resExisting.status);
    expect(resNew.body).toEqual(resExisting.body);
    expect(resNew.headers['content-type']).toBe(resExisting.headers['content-type']);

    await app.close();
  });

  // Test 4: sign-up timing (N=30 samples each branch)
  it('sign-up timing: new and existing branches are indistinguishable', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'timing-existing@example.com', password: 'password123' })
      .expect(200);

    const N = 30;
    const newTimes: number[] = [];
    const existingTimes: number[] = [];

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: `timing-new-${i}@example.com`, password: 'password123' });
      newTimes.push(performance.now() - t0);
    }

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'timing-existing@example.com', password: 'password123' });
      existingTimes.push(performance.now() - t0);
    }

    const newMedian = median(newTimes);
    const existingMedian = median(existingTimes);
    const newP95 = p95(newTimes);
    const existingP95 = p95(existingTimes);

    expect(Math.abs(newMedian - existingMedian)).toBeLessThan(50);
    expect(Math.abs(newP95 - existingP95)).toBeLessThan(100);

    await app.close();
  });

  // Test 5: sign-up sends verification email for new address
  it('sign-up sends a verification email for a new address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'verify-me@example.com', password: 'password123' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('verify-me@example.com');
    expect(mailCalls[0].template).toBe('verification');

    await app.close();
  });

  // Test 6: sign-up sends "sign-up-attempt" email for existing address
  it('sign-up sends a sign-up-attempt email for an existing address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password123' })
      .expect(200);

    mailCalls.length = 0;

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password456' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('dup@example.com');
    expect(mailCalls[0].template).toBe('sign-up-attempt');

    await app.close();
  });

  // Test 8: sign-in correct credentials → 200 + token
  it('sign-in with correct credentials returns 200 and a token', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    await app.close();
  });

  // Test 9: sign-in wrong password (known email) → 401 envelope
  it('sign-in with wrong password returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'wrongpw@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'wrongpw@example.com', password: 'wrongpassword' })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.details).toEqual({});

    await app.close();
  });

  // Test 10: sign-in unknown email → 401 envelope
  it('sign-in with unknown email returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'ghost@example.com', password: 'password123' })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.details).toEqual({});

    await app.close();
  });

  // Test 11: sign-in byte-equality (wrong-password vs unknown-email)
  it('sign-in failure responses are byte-identical for wrong-password and unknown-email', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'bytecmp@example.com', password: 'password123' })
      .expect(200);

    const resWrongPw = await request(app
