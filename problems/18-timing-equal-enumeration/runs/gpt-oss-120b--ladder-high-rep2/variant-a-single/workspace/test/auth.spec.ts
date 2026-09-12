import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { randomBytes } from 'crypto';

// Helper to generate a random e‑mail address.
function randomEmail(): string {
  return `${randomBytes(4).toString('hex')}@example.com`;
}

// Perform a timed HTTP request.
async function timedRequest(
  app: INestApplication,
  method: 'post',
  path: string,
  payload: any,
) {
  const start = process.hrtime.bigint();
  const response = await request(app.getHttpServer())[method](path).send(payload);
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1e6;
  return { response, durationMs };
}

describe('Auth (timing and response equality)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean the user table before each test.
    await prisma.user.deleteMany({});
  });

  describe('POST /auth/sign-up', () => {
    it('returns identical responses for new and existing e‑mails', async () => {
      const existingEmail = randomEmail();
      const password = 'StrongPass!1';

      // Create the existing account.
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);

      const newEmail = randomEmail();

      const newRes = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: newEmail, password })
        .expect(HttpStatus.OK);

      const existingRes = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);

      // Compare status, content‑type and body.
      expect(newRes.status).toBe(existingRes.status);
      expect(newRes.headers['content-type']).toContain('application/json');
      expect(existingRes.headers['content-type']).toContain('application/json');
      expect(newRes.body).toEqual(existingRes.body);
    });

    it('has statistically indistinguishable timing between branches', async () => {
      const existingEmail = randomEmail();
      const password = 'StrongPass!1';

      // Seed the existing account.
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);

      const iterations = 30;
      const toleranceMs = 40; // Acceptable mean difference.
      const minMeanMs = 80;   // Ensure real work (hashing) took place.

      const existingTimes: number[] = [];
      const newTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        // Existing‑email branch.
        const { durationMs: existingDuration } = await timedRequest(
          app,
          'post',
          '/auth/sign-up',
          { email: existingEmail, password },
        );
        existingTimes.push(existingDuration);

        // New‑email branch – fresh address each iteration.
        const freshEmail = randomEmail();
        const { durationMs: newDuration } = await timedRequest(
          app,
          'post',
          '/auth/sign-up',
          { email: freshEmail, password },
        );
        newTimes.push(newDuration);
      }

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

      const existingMean = avg(existingTimes);
      const newMean = avg(newTimes);
      const diff = Math.abs(existingMean - newMean);

      expect(existingMean).toBeGreaterThan(minMeanMs);
      expect(newMean).toBeGreaterThan(minMeanMs);
      expect(diff).toBeLessThanOrEqual(toleranceMs);
    });
  });

  describe('POST /auth/sign-in', () => {
    it('returns identical error responses for wrong password and unknown e‑mail', async () => {
      const existingEmail = randomEmail();
      const password = 'StrongPass!1';
      const wrongPassword = 'WrongPass!2';

      // Create a user.
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);

      const wrongPassRes = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: wrongPassword })
        .expect(HttpStatus.UNAUTHORIZED);

      const unknownEmail = randomEmail();
      const unknownRes = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: unknownEmail, password })
        .expect(HttpStatus.UNAUTHORIZED);

      // Compare status, content‑type and body.
      expect(wrongPassRes.status).toBe(unknownRes.status);
      expect(wrongPassRes.headers['content-type']).toContain('application/json');
      expect(unknownRes.headers['content-type']).toContain('application/json');
      expect(wrongPassRes.body).toEqual(unknownRes.body);
    });

    it('has statistically indistinguishable timing between wrong password and unknown e‑mail', async () => {
      const existingEmail = randomEmail();
      const password = 'StrongPass!1';
      const wrongPassword = 'WrongPass!2';

      // Create a user.
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(HttpStatus.OK);

      const iterations = 30;
      const toleranceMs = 30;
      const minMeanMs = 80;

      const wrongPassTimes: number[] = [];
      const unknownTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const { durationMs: wpDuration } = await timedRequest(
          app,
          'post',
          '/auth/sign-in',
          { email: existingEmail, password: wrongPassword },
        );
        wrongPassTimes.push(wpDuration);

        const unknownEmail = randomEmail();
        const { durationMs: unkDuration } = await timedRequest(
          app,
          'post',
          '/auth/sign-in',
          { email: unknownEmail, password },
        );
        unknownTimes.push(unkDuration);
      }

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

      const wpMean = avg(wrongPassTimes);
      const unkMean = avg(unknownTimes);
      const diff = Math.abs(wpMean - unkMean);

      expect(wpMean).toBeGreaterThan(minMeanMs);
      expect(unkMean).toBeGreaterThan(minMeanMs);
      expect(diff).toBeLessThanOrEqual(toleranceMs);
    });
  });
});
