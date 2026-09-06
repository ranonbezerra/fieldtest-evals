import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';

@Catch(AuthFailureError)
class AuthFailureFilter implements ExceptionFilter {
  catch(exception: AuthFailureError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(401).json({
      error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
    });
  }
}

@Catch(BadRequestException)
class ValidationFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(400).json({
      error: { code: 'validation_failed', message: exception.message, details: {} },
    });
  }
}

describe('Auth', () => {
  let app: INestApplication;
  let existingUser: { id: string; email: string; passwordHash: string };

  const mockRepo = {
    findByEmail: vi.fn(),
    createUser: vi.fn(),
    touchUser: vi.fn(),
  };

  const mockMail: MailPort = {
    sendEmail: vi.fn(),
  };

  beforeAll(async () => {
    const realPassword = 'correct-password-123';
    const realHash = await argon2.hash(realPassword, { type: argon2.argon2id });
    existingUser = {
      id: 'test-uuid-1234',
      email: 'existing@example.com',
      passwordHash: realHash,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
      overrides: [
        { token: AuthRepository, useValue: mockRepo },
        { token: MailPort, useValue: mockMail },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AuthFailureFilter(), new ValidationFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMail.sendEmail.mockResolvedValue(undefined);
  });

  // --- Sign-up ---

  describe('POST /auth/sign-up', () => {
    it('creates a new account and returns 200 with expected body', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.createUser.mockResolvedValue({ id: 'new-uuid' });

      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'new@example.com', password: 'password123' })
        .expect(200);

      expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    });

    it('returns the same 200 response for an existing email', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);
      mockRepo.touchUser.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'existing@example.com', password: 'password123' })
        .expect(200);

      expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    });

    it('produces byte-identical responses for new and existing emails', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.createUser.mockResolvedValue({ id: 'new-uuid' });

      const resNew = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'byte-new@example.com', password: 'password123' });

      mockRepo.findByEmail.mockResolvedValue(existingUser);
      mockRepo.touchUser.mockResolvedValue(undefined);

      const resExisting = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'existing@example.com', password: 'password123' });

      expect(resNew.status).toBe(resExisting.status);
      expect(Buffer.from(resNew.text, 'utf-8')).toEqual(Buffer.from(resExisting.text, 'utf-8'));
      expect(resNew.headers['content-type']).toBe(resExisting.headers['content-type']);
    });

    it('sends a verification email for a new address', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.createUser.mockResolvedValue({ id: 'new-uuid' });

      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'verify@example.com', password: 'password123' })
        .expect(200);

      expect(mockMail.sendEmail).toHaveBeenCalledWith(
        'verify@example.com',
        'verification',
        { email: 'verify@example.com' },
      );
    });

    it('sends a sign-up-attempt email for an existing address', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);
      mockRepo.touchUser.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'existing@example.com', password: 'password123' })
        .expect(200);

      expect(mockMail.sendEmail).toHaveBeenCalledWith(
        'existing@example.com',
        'sign-up-attempt',
        { email: 'existing@example.com' },
      );
    });

    it('stores the password as an argon2id hash', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'hash-check@example.com', password: 'password123' })
        .expect(200);

      expect(mockRepo.createUser).toHaveBeenCalledTimes(1);
      const [email, passwordHash] = mockRepo.createUser.mock.calls[0];
      expect(email).toBe('hash-check@example.com');
      expect(passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('returns 400 validation_failed for missing fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'no-password@example.com' })
        .expect(400);

      expect(res.body.error.code).toBe('validation_failed');
    });

    it('does not reveal branch via timing (new vs existing)', async () => {
      const N = 30;
      const newTimes: number[] = [];
      const existingTimes: number[] = [];

      for (let i = 0; i < N; i++) {
        mockRepo.findByEmail.mockResolvedValue(null);
        mockRepo.createUser.mockResolvedValue({ id: 'timing-uuid' });

        const t0 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: 'timing-new@example.com', password: 'password123' });
        newTimes.push(performance.now() - t0);

        mockRepo.findByEmail.mockResolvedValue(existingUser);
        mockRepo.touchUser.mockResolvedValue(undefined);

        const t1 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: 'existing@example.com', password: 'password123' });
        existingTimes.push(performance.now() - t1);
      }

      const median = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      const p95 = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1)];
      };

      const medDiff = Math.abs(median(newTimes) - median(existingTimes));
      const p95Diff = Math.abs(p95(newTimes) - p95(existingTimes));

      expect(medDiff).toBeLessThan(50);
      expect(p95Diff).toBeLessThan(100);
    });
  });

  // --- Sign-in ---

  describe('POST /auth/sign-in', () => {
    it('returns 200 with a token for correct credentials', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);

      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'correct-password-123' })
        .expect(200);

      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
    });

    it('returns 401 invalid_credentials for wrong password', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);

      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'wrong-password' })
        .expect(401);

      expect(res.body.error.code).toBe('invalid_credentials');
    });

    it('returns 401 invalid_credentials for unknown email', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'unknown@example.com', password: 'some-password' })
        .expect(401);

      expect(res.body.error.code).toBe('invalid_credentials');
    });

    it('produces byte-identical responses for wrong-password and unknown-email', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);

      const resWrong = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'wrong-password' });

      mockRepo.findByEmail.mockResolvedValue(null);

      const resUnknown = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'unknown@example.com', password: 'wrong-password' });

      expect(resWrong.status).toBe(resUnknown.status);
      expect(Buffer.from(resWrong.text, 'utf-8')).toEqual(Buffer.from(resUnknown.text, 'utf-8'));
      expect(resWrong.headers['content-type']).toBe(resUnknown.headers['content-type']);
    });

    it('returns 400 validation_failed for missing fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'no-password@example.com' })
        .expect(400);

      expect(res.body.error.code).toBe('validation_failed');
    });

    it('does not reveal branch via timing (wrong-password vs unknown-email)', async () => {
      const N = 30;
      const wrongPasswordTimes: number[] = [];
      const unknownEmailTimes: number[] = [];

      for (let i = 0; i < N; i++) {
        mockRepo.findByEmail.mockResolvedValue(existingUser);

        const t0 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: 'existing@example.com', password: 'wrong-password' });
        wrongPasswordTimes.push(performance.now() - t0);

        mockRepo.findByEmail.mockResolvedValue(null);

        const t1 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: 'unknown@example.com', password: 'wrong-password' });
        unknownEmailTimes.push(performance.now() - t1);
      }

      const median = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      const p95 = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1)];
      };

      const medDiff = Math.abs(median(wrongPasswordTimes) - median(unknownEmailTimes));
      const p95Diff = Math.abs(p95(wrongPasswordTimes) - p95(unknownEmailTimes));

      expect(medDiff).toBeLessThan(50);
      expect(p95Diff).toBeLessThan(100);
    });
  });
});
