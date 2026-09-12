import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaService } from '../src/prisma.service.js';
import * as argon2 from 'argon2';

describe('Auth E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const strongPassword = 'StrongPass123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up the users table before each test.
    await prisma.user.deleteMany();
  });

  async function measureSignUp(email: string, password: string) {
    const start = process.hrtime.bigint();
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password });
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    return { response, durationMs };
  }

  async function measureSignIn(email: string, password: string) {
    const start = process.hrtime.bigint();
    const response = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password });
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    return { response, durationMs };
  }

  function average(arr: number[]): number {
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  it('sign-up returns identical responses for new and existing e‑mails', async () => {
    const existingEmail = 'existing@example.com';
    const passwordHash = await argon2.hash(strongPassword);
    await prisma.user.create({
      data: { email: existingEmail, password: passwordHash },
    });

    const newEmail = 'new@example.com';

    const newRes = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: newEmail, password: strongPassword })
      .expect(HttpStatus.OK);

    const existingRes = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: existingEmail, password: strongPassword })
      .expect(HttpStatus.OK);

    // Status codes must match.
    expect(newRes.status).toBe(existingRes.status);

    // Body must be byte‑identical.
    expect(JSON.stringify(newRes.body)).toBe(JSON.stringify(existingRes.body));

    // Headers that could leak length must match.
    expect(newRes.headers['content-type']).toBe(existingRes.headers['content-type']);
    if (newRes.headers['content-length'] && existingRes.headers['content-length']) {
      expect(newRes.headers['content-length']).toBe(existingRes.headers['content-length']);
    }
  });

  it('sign-in returns identical error responses for wrong password and unknown e‑mail', async () => {
    const userEmail = 'user@example.com';
    const passwordHash = await argon2.hash(strongPassword);
    await prisma.user.create({
      data: { email: userEmail, password: passwordHash },
    });

    const wrongPasswordRes = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: userEmail, password: 'WrongPassword123!' })
      .expect(HttpStatus.UNAUTHORIZED);

    const unknownEmailRes = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'unknown@example.com', password: 'Anything123!' })
      .expect(HttpStatus.UNAUTHORIZED);

    // Body must be byte‑identical.
    expect(JSON.stringify(wrongPasswordRes.body)).toBe(
      JSON.stringify(unknownEmailRes.body),
    );
    expect(wrongPasswordRes.headers['content-type']).toBe(
      unknownEmailRes.headers['content-type'],
    );
  });

  it('sign-up timing is indistinguishable between new and existing e‑mails', async () => {
    const existingEmail = 'existing@example.com';
    const passwordHash = await argon2.hash(strongPassword);
    await prisma.user.create({
      data: { email: existingEmail, password: passwordHash },
    });

    const iterations = 15;
    const newDurations: number[] = [];
    const existingDurations: number[] = [];

    // New‑email branch.
    for (let i = 0; i < iterations; i++) {
      const email = `new${i}@example.com`;
      const { durationMs } = await measureSignUp(email, strongPassword);
      newDurations.push(durationMs);
    }

    // Existing‑email branch.
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await measureSignUp(existingEmail, strongPassword);
      existingDurations.push(durationMs);
    }

    const avgNew = average(newDurations);
    const avgExisting = average(existingDurations);
    const diff = Math.abs(avgNew - avgExisting);
    const toleranceMs = 50; // acceptable mean difference.
    const minimumMs = 100; // ensure real work was performed.

    expect(diff).toBeLessThanOrEqual(toleranceMs);
    expect(avgNew).toBeGreaterThan(minimumMs);
    expect(avgExisting).toBeGreaterThan(minimumMs);
  });

  it('sign-in timing is indistinguishable between wrong password and unknown e‑mail', async () => {
    const userEmail = 'user@example.com';
    const passwordHash = await argon2.hash(strongPassword);
    await prisma.user.create({
      data: { email: userEmail, password: passwordHash },
    });

    const iterations = 15;
    const wrongPwdDurations: number[] = [];
    const unknownEmailDurations: number[] = [];

    // Wrong password (existing user).
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await measureSignIn(userEmail, `Wrong${i}Pass!`);
      wrongPwdDurations.push(durationMs);
    }

    // Unknown e‑mail.
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await measureSignIn(`unknown${i}@example.com`, 'AnyPass123!');
      unknownEmailDurations.push(durationMs);
    }

    const avgWrong = average(wrongPwdDurations);
    const avgUnknown = average(unknownEmailDurations);
    const diff = Math.abs(avgWrong - avgUnknown);
    const toleranceMs = 50;
    const minimumMs = 100;

    expect(diff).toBeLessThanOrEqual(toleranceMs);
    expect(avgWrong).toBeGreaterThan(minimumMs);
    expect(avgUnknown).toBeGreaterThan(minimumMs);
  });
});
