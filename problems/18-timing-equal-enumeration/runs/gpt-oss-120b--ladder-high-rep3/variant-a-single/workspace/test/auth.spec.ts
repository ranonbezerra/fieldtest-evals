import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { performance } from 'perf_hooks';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { InvalidCredentialsException } from '../src/auth/invalid-credentials.exception.js';
import * as argon2 from 'argon2';

interface MockUser {
  email: string;
  passwordHash: string;
}

/**
 * A lightweight in‑memory mock used to replace the real repository in tests.
 */
class MockAuthRepository {
  private users = new Map<string, MockUser>();

  async findByEmail(email: string): Promise<any> {
    const user = this.users.get(email);
    return user ? { email: user.email, passwordHash: user.passwordHash } : null;
  }

  async createUser(email: string, passwordHash: string): Promise<any> {
    const user: MockUser = { email, passwordHash };
    this.users.set(email, user);
    return user;
  }

  async seedUser(email: string, password: string) {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await this.createUser(email, hash);
  }
}

/**
 * Simple average helper.
 */
function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

describe('Auth – timing equalisation and response indistinguishability', () => {
  let app: INestApplication;
  let mockRepo: MockAuthRepository;

  beforeAll(async () => {
    mockRepo = new MockAuthRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: mockRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    // Seed a known user for the “existing address” cases.
    await mockRepo.seedUser('existing@example.com', 'ExistingPass123');
  });

  afterAll(async () => {
    await app.close();
  });

  test('sign‑up returns byte‑identical responses for new and existing emails', async () => {
    const newPayload = { email: 'new@example.com', password: 'Password123' };
    const existingPayload = {
      email: 'existing@example.com',
      password: 'AnyPassword',
    };

    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send(newPayload)
      .expect(200);
    const resExisting = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send(existingPayload)
      .expect(200);

    expect(resNew.body).toEqual(resExisting.body);
    expect(resNew.text).toBe(resExisting.text);
    expect(resNew.headers['content-type']).toBe(
      resExisting.headers['content-type'],
    );
  });

  test('sign‑in returns byte‑identical responses for wrong password and unknown email', async () => {
    const wrongPasswordPayload = {
      email: 'existing@example.com',
      password: 'WrongPass123',
    };
    const unknownEmailPayload = {
      email: 'unknown@example.com',
      password: 'AnyPass123',
    };

    const resWrong = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send(wrongPasswordPayload)
      .expect(401);
    const resUnknown = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send(unknownEmailPayload)
      .expect(401);

    expect(resWrong.body).toEqual(resUnknown.body);
    expect(resWrong.text).toBe(resUnknown.text);
    expect(resWrong.headers['content-type']).toBe(
      resUnknown.headers['content-type'],
    );
  });

  test('sign‑up timing is statistically indistinguishable between branches', async () => {
    const samples = 10;
    const password = 'Password123';
    const newEmail = 'timing-new@example.com';
    const existingEmail = 'existing@example.com';

    const timingsNew: number[] = [];
    const timingsExisting: number[] = [];

    for (let i = 0; i < samples; i++) {
      const startNew = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: newEmail, password })
        .expect(200);
      const endNew = performance.now();
      timingsNew.push(endNew - startNew);

      const startExist = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password })
        .expect(200);
      const endExist = performance.now();
      timingsExisting.push(endExist - startExist);
    }

    const avgNew = avg(timingsNew);
    const avgExist = avg(timingsExisting);
    const diff = Math.abs(avgNew - avgExist);

    // Allow a 50 ms tolerance on the mean difference.
    expect(diff).toBeLessThanOrEqual(50);
    // Both branches must be “slow enough” to indicate real work.
    expect(avgNew).toBeGreaterThan(50);
    expect(avgExist).toBeGreaterThan(50);
  });

  test('sign‑in timing is statistically indistinguishable between branches', async () => {
    const samples = 10;
    const wrongPassword = 'WrongPass123';
    const unknownEmail = 'unknown-timing@example.com';
    const existingEmail = 'existing@example.com';

    const timingsWrong: number[] = [];
    const timingsUnknown: number[] = [];

    for (let i = 0; i < samples; i++) {
      const startWrong = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: wrongPassword })
        .expect(401);
      const endWrong = performance.now();
      timingsWrong.push(endWrong - startWrong);

      const startUnknown = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: unknownEmail, password: 'AnyPass123' })
        .expect(401);
      const endUnknown = performance.now();
      timingsUnknown.push(endUnknown - startUnknown);
    }

    const avgWrong = avg(timingsWrong);
    const avgUnknown = avg(timingsUnknown);
    const diff = Math.abs(avgWrong - avgUnknown);

    expect(diff).toBeLessThanOrEqual(50);
    expect(avgWrong).toBeGreaterThan(50);
    expect(avgUnknown).toBeGreaterThan(50);
  });
});
