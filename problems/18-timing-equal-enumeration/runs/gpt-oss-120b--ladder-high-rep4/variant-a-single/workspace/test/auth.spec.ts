import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { performance } from 'perf_hooks';

describe('AuthController (Timing Equal Enumeration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    // Ensure a clean slate.
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sign‑up responses are byte‑identical for new and existing email', async () => {
    const email = `signup-${Date.now()}@example.com`;
    const password = 'StrongPass!123';

    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password })
      .expect(HttpStatus.OK);

    const resExist = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password })
      .expect(HttpStatus.OK);

    expect(resNew.text).toBe(resExist.text);
    expect(resNew.body).toEqual(resExist.body);
  });

  it('sign‑in error responses are byte‑identical for wrong password and unknown email', async () => {
    const email = `signin-${Date.now()}@example.com`;
    const password = 'CorrectPass!123';

    // Create a legitimate account.
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, password })
      .expect(HttpStatus.OK);

    const resWrong = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password: 'WrongPass!123' })
      .expect(HttpStatus.UNAUTHORIZED);

    const unknownEmail = `unknown-${Date.now()}@example.com`;
    const resUnknown = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: unknownEmail, password: 'Anything!123' })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(resWrong.text).toBe(resUnknown.text);
    expect(resWrong.body).toEqual(resUnknown.body);
  });

  it('sign‑up timing is indistinguishable between branches', async () => {
    const existingEmail = `existing-${Date.now()}@example.com`;
    const password = 'TimingPass!123';

    // Ensure the address exists.
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: existingEmail, password })
      .expect(HttpStatus.OK);

    const samples = 10;
    const newTimes: number[] = [];
    const existingTimes: number[] = [];

    // New‑address requests.
    for (let i = 0; i < samples; i++) {
      const email = `new-${i}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)}@example.com`;
      const start = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email, password })
        .expect(HttpStatus.OK);
      const end = performance.now();
      newTimes.push(end - start);
    }

    // Existing‑address requests.
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);
      const end = performance.now();
      existingTimes.push(end - start);
    }

    const avg = (arr: number[]) =>
      arr.reduce((sum, cur) => sum + cur, 0) / arr.length;

    const avgNew = avg(newTimes);
    const avgExisting = avg(existingTimes);
    const diff = Math.abs(avgNew - avgExisting);
    const toleranceMs = 30; // acceptable deviation

    // 1️⃣ Responses must be within the tolerance.
    expect(diff).toBeLessThanOrEqual(toleranceMs);
    // 2️⃣ Both paths must have performed real work (i.e., hashing).
    expect(avgNew).toBeGreaterThan(50);
    expect(avgExisting).toBeGreaterThan(50);
  });
});
