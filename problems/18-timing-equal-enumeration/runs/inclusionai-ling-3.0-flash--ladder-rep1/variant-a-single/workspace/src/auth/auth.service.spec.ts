import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../app.module.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { AllExceptionsFilter } from '../errors/all-exceptions.filter.ts';
import { ValidationPipe } from '@nestjs/common';
import { MailerService, MailerPort } from '../mailer/mailer.service.ts';
import { MAILER_TOKEN } from '../mailer/mailer.token.ts';
import argon2 from 'argon2';
import { ARGON2_CONFIG } from './argon2.config.ts';
import { AuthService } from './auth.service.ts';

const SAMPLE_SIZE = 30;
const TIME_THRESHOLD_MS = 50;
const TIME_TOLERANCE_RATIO = 2.0;

let server: any;

describe('Auth (security)', () => {
  let app: any;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER_TOKEN)
      .useValue({
        sendEmail: async () => {
          /* no-op */
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = moduleRef.get(PrismaService);

    await prisma.$connect();
    await prisma.user.deleteMany();

    const existingHash = await argon2.hash('correct-password-123', ARGON2_CONFIG);
    await prisma.user.create({
      data: { email: 'existing@example.com', passwordHash: existingHash },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('Sign-up byte comparison', () => {
    it('returns byte-identical responses for new and existing emails', async () => {
      const newRes = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'brandnew@example.com', password: 'somepassword123' })
        .expect(201);

      const existingRes = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'existing@example.com', password: 'somepassword123' })
        .expect(201);

      expect(newRes.status).toBe(existingRes.status);
      expect(newRes.text).toBe(existingRes.text);
      expect(newRes.headers['content-type']).toBe(existingRes.headers['content-type']);
      expect(newRes.headers['content-length']).toBe(existingRes.headers['content-length']);
    });
  });

  describe('Sign-in byte comparison', () => {
    it('returns byte-identical responses for wrong password and unknown email', async () => {
      const wrongRes = await request(server)
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'wrongpassword' })
        .expect(401);

      const unknownRes = await request(server)
        .post('/auth/sign-in')
        .send({ email: 'nobody@example.com', password: 'wrongpassword' })
        .expect(401);

      expect(wrongRes.status).toBe(unknownRes.status);
      expect(wrongRes.text).toBe(unknownRes.text);
      expect(wrongRes.headers['content-type']).toBe(unknownRes.headers['content-type']);
      expect(wrongRes.headers['content-length']).toBe(unknownRes.headers['content-length']);
    });
  });

  describe('Sign-up timing equalisation', () => {
    it('is statistically indistinguishable over multiple samples', async () => {
      const newTimings = await collectTimings('new', SAMPLE_SIZE);
      const existingTimings = await collectTimings('existing', SAMPLE_SIZE);

      compareDistributions('new', newTimings, 'existing', existingTimings);
    });

    it('fails (detects) when hashing is removed from both branches', async () => {
      const newTimings = await collectTimings('new', SAMPLE_SIZE);
      const existingTimings = await collectTimings('existing', SAMPLE_SIZE);
      const allTimings = [...newTimings, ...existingTimings];
      const mean = allTimings.reduce((a, b) => a + b, 0) / allTimings.length;
      expect(mean).toBeGreaterThan(TIME_THRESHOLD_MS);
    });
  });

  describe('Sign-in timing equalisation', () => {
    it('is statistically indistinguishable over multiple samples', async () => {
      const wrongTimings = await collectSignInTimings('wrong-password', SAMPLE_SIZE);
      const unknownTimings = await collectSignInTimings('unknown-email', SAMPLE_SIZE);

      compareDistributions('wrong-password', wrongTimings, 'unknown-email', unknownTimings);
    });
  });

  describe('Out-of-band email', () => {
    it('delivers email without affecting the response', async () => {
      const res = await request(server)
        .post('/auth/sign-up')
        .send({ email: 'independent@example.com', password: 'somepassword123' })
        .expect(201);

      expect(res.body).toEqual({
        status: 'created',
        message: 'If this address is registered you will receive a notification.',
      });
    });
  });
});

async function collectTimings(label: string, samples: number): Promise<number[]> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const email = `${label}-${Date.now()}-${i}@example.com`;
    const start = process.hrtime.bigint();
    await request(server as any)
      .post('/auth/sign-up')
      .send({ email, password: 'somepassword123' })
      .expect(201);
    const elapsed = Number((process.hrtime.bigint() - start) / BigInt(1e6));
    timings.push(elapsed);
  }
  return timings;
}

async function collectSignInTimings(label: string, samples: number): Promise<number[]> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const email = label === 'wrong-password' ? 'existing@example.com' : 'unknown@example.com';
    const start = process.hrtime.bigint();
    await request(server as any)
      .post('/auth/sign-in')
      .send({ email, password: 'wrongpassword' })
      .expect(401);
    const elapsed = Number((process.hrtime.bigint() - start) / BigInt(1e6));
    timings.push(elapsed);
  }
  return timings;
}

function compareDistributions(labelA: string, timingsA: number[], labelB: string, timingsB: number[]) {
  const meanA = timingsA.reduce((a, b) => a + b, 0) / timingsA.length;
  const meanB = timingsB.reduce((a, b) => a + b, 0) / timingsB.length;
  const maxMean = Math.max(meanA, meanB);
  const minMean = Math.min(meanA, meanB);
  const ratio = maxMean / (minMean || 1);

  expect(minMean).toBeGreaterThan(TIME_THRESHOLD_MS);
  expect(ratio).toBeLessThan(TIME_TOLERANCE_RATIO);

  const medianA = median(timingsA);
  const medianB = median(timingsB);
  const medianRatio = Math.max(medianA, medianB) / (Math.min(medianA, medianB) || 1);
  expect(medianRatio).toBeLessThan(TIME_TOLERANCE_RATIO);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
