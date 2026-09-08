import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
import { setTimeout } from 'timers/promises';

describe('Auth endpoints (timing & indistinguishability)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const existingEmail = 'existing@example.com';
  const newEmail = 'new@example.com';
  const password = 'StrongPass123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = moduleRef.get<PrismaClient>(PrismaClient);
    // Ensure a clean state
    await prisma.user.deleteMany();
    // Create an existing user
    const hash = await import('argon2').then(argon2 => argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    }));
    await prisma.user.create({
      data: { email: existingEmail, password_hash: hash },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('sign‑up response identical for existing and new e‑mail', async () => {
    const resExisting = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: existingEmail, password })
      .expect(201);

    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: newEmail, password })
      .expect(201);

    // Compare bodies (JSON stringified)
    expect(JSON.stringify(resExisting.body)).toBe(JSON.stringify(resNew.body));
    // Compare selected headers that are deterministic
    expect(resExisting.headers['content-type']).toBe(resNew.headers['content-type']);
  });

  it('sign‑in response identical for wrong password vs unknown e‑mail', async () => {
    const wrongPassword = 'Incorrect123!';

    const resWrongPwd = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: existingEmail, password: wrongPassword })
      .expect(200);

    const resUnknown = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'unknown@example.com', password: wrongPassword })
      .expect(200);

    expect(JSON.stringify(resWrongPwd.body)).toBe(JSON.stringify(resUnknown.body));
  });

  it('timing test: sign‑up branches take indistinguishable time', async () => {
    const samples = 20;
    const timesExisting: number[] = [];
    const timesNew: number[] = [];

    for (let i = 0; i < samples; i++) {
      const startExisting = process.hrtime.bigint();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(201);
      const endExisting = process.hrtime.bigint();
      timesExisting.push(Number(endExisting - startExisting) / 1e6); // ms

      const startNew = process.hrtime.bigint();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: `new${i}@example.com`, password })
        .expect(201);
      const endNew = process.hrtime.bigint();
      timesNew.push(Number(endNew - startNew) / 1e6);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const diff = Math.abs(avg(timesExisting) - avg(timesNew));

    // Allow a small margin (e.g., 50 ms) – this should be well below any
    // perceptible timing difference.
    expect(diff).toBeLessThan(50);
  });

  it('timing test: sign‑in branches take indistinguishable time', async () => {
    const samples = 20;
    const timesWrongPwd: number[] = [];
    const timesUnknown: number[] = [];

    for (let i = 0; i < samples; i++) {
      const startWrong = process.hrtime.bigint();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: 'BadPass123!' })
        .expect(200);
      const endWrong = process.hrtime.bigint();
      timesWrongPwd.push(Number(endWrong - startWrong) / 1e6);

      const startUnknown = process.hrtime.bigint();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: `unknown${i}@example.com`, password: 'BadPass123!' })
        .expect(200);
      const endUnknown = process.hrtime.bigint();
      timesUnknown.push(Number(endUnknown - startUnknown) / 1e6);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const diff = Math.abs(avg(timesWrongPwd) - avg(timesUnknown));
    expect(diff).toBeLessThan(50);
  });
});
