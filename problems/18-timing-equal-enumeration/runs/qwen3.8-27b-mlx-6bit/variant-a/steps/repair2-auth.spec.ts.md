# repair2-auth.spec.ts

## reasoning

```
The compiler error is:
```
test/auth.spec.ts(324,1): error TS1005: ')' expected.
```

This means there's a missing closing parenthesis at line 324, column 1. I need to rewrite the complete `test/auth.spec.ts` file that satisfies all the test requirements from the PLAN.md.

Let me think about what the test file needs to contain based on the plan:

1. Test sign-up new email → 200, correct body
2. Test sign-up existing email → 200, correct body
3. Test sign-up byte-equality of response (new vs existing)
4. Test sign-up timing (N=30 samples each branch)
5. Test sign-up sends verification email for new address
6. Test sign-up sends "sign-up-attempt" email for existing address
7. Test sign-in correct credentials → 200 + token
8. Test sign-in wrong password (known email) → 401 envelope
9. Test sign-in unknown email → 401 envelope
10. Test sign-in byte-equality (wrong-password vs unknown-email)
11. Test sign-in timing (N=30 samples each branch)
12. Test sign-up / sign-in missing fields → 400 `validation_failed`
13. Test password stored as argon2id hash (inspect DB after sign-up)

The error at line 324, column 1 is a missing `)`. This likely means somewhere in the original file there was a function call or expression that wasn't properly closed. Since I need to rewrite the complete file, I'll make sure all parentheses are balanced.

Let me write a complete, well-structured test file. I need to be careful about:
- Using Vitest (not Jest)
- The plan specifies the module structure
- The MailPort interface
- The timing tests comparing two branches
- Byte comparison of responses

Let me think about how to structure this with NestJS testing utilities. I'll use `Test.createTestingModule` from `@nestjs/testing`.

For the timing tests, I need to be careful - they compare two branches over multiple samples. The key is that the service always performs an argon2 verify regardless of branch, so timing should be similar.

For byte comparison, I need to serialize the response body and compare bytes.

Let me think about the test structure:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { MailPort } from '../src/auth/auth.service';
// ... etc
```

Actually, let me think more carefully. The test needs to:
1. Set up the NestJS app with AuthModule
2. Mock or use a real repository (for tests that check DB, we might need real; for most tests, mock)
3. Mock the MailPort

Wait, looking at the plan more carefully:

- The repository uses Prisma
- The service depends on repository and MailPort
- For most tests, I should mock the repository and MailPort
- For the "password stored as argon2id hash" test, I might need to check what was passed to `createUser`

Let me think about this differently. I'll mock the repository and MailPort for most tests, and for the argon2id test, I'll check the argument passed to `createUser`.

For timing tests, I need to actually call the service (or controller) with real argon2 hashing. But if I mock the repository, the argon2 verify will still run (it's in the service). So timing tests should work with a mocked repository since the dominant cost is argon2.

Actually wait - for timing tests to be meaningful, I need the argon2 verify to actually run. If I mock the repository's `findByEmail`, the service will still call `argon2.verify` with either the real hash or the DUMMY_HASH. So the timing should be similar.

But wait - if I mock `findByEmail` to return a user with a specific passwordHash, then `argon2.verify` will run against that hash. For the "new" branch, it will verify against DUMMY_HASH. Both should take similar time.

Let me structure the tests:

1. Unit/integration tests with mocked repo and mail
2. Timing tests that actually exercise the argon2 path

For the timing tests, I think the best approach is to use the service directly (not HTTP) to avoid network overhead, and measure the time of `signUp` calls.

Actually, re-reading the plan: "Tests that fail if the property is broken — including a timing test that compares the two branches over multiple samples, and a byte comparison of the two responses"

So I need:
- A timing test for sign-up (new vs existing)
- A byte comparison test for sign-up responses
- A timing test for sign-in (wrong password vs unknown email)
- A byte comparison test for sign-in failure responses

Let me write this out. I'll use a hybrid approach:
- For most tests: mock repo, use service directly or via HTTP
- For timing tests: use service directly with mocked repo (so argon2 is the dominant cost)
- For byte comparison: use HTTP to get actual response bodies

Actually, for byte comparison, I should use supertest to get the actual HTTP responses. Let me use a full app for those.

Let me reconsider. The simplest approach that works:

1. Create a testing module with the real service and controller
2. Mock the repository (since we don't have a real DB in tests)
3. Mock the MailPort
4. Use supertest for HTTP-level tests (byte comparison, validation errors)
5. Use service directly for timing tests

For the repository mock, I need to handle different scenarios:
- `findByEmail` returns null (new user)
- `findByEmail` returns a user object (existing user)
- `createUser` is called
- `touchUser` is called

Let me write this out now. I'll be careful about matching all parentheses.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Global, UseFilters } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma.service'; // might not exist...
```

Hmm, I don't know the exact path of PrismaService. Let me look at what's available. The plan says `src/auth/auth.repository.ts` depends on Prisma. Let me assume there's a `PrismaService` somewhere or the repository just uses the Prisma client directly.

Actually, for testing purposes, I'll just mock `AuthRepository` at the module level. I don't need to know its internal dependencies if I'm providing a mock.

Let me also think about the exception filter. The plan says there's a global exception filter in `main.ts` that maps `AuthFailureError → 401`. For tests, I need to either:
- Use the full app with the filter
- Or handle it in the test

I think the cleanest approach is to create the testing module with the controller and service, mock the repository and mail port, and apply the necessary pipes/filters.

Actually, let me look at this from a different angle. The error is just a missing `)`. The file probably has most of its content correct but one missing parenthesis. Since I can't see the original file, I need to write a complete correct version.

Let me write a clean, complete test file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';

describe('Auth (sign-up / sign-in)', () => {
  let app: INestApplication;
  let authService: AuthService;

  const mockRepo = {
    findByEmail: vi.fn(),
    createUser: vi.fn(),
    touchUser: vi.fn(),
  };

  const mockMail: MailPort = {
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };

  const existingUser = {
    id: 'test-uuid-1234',
    email: 'existing@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$someSalt$someHash',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
      overrides: [
        { token: AuthRepository, useValue: mockRepo },
        { token: MailPort, useValue: mockMail },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    authService = moduleRef.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findByEmail.mockReset();
    mockRepo.createUser.mockReset();
    mockRepo.touchUser.mockReset();
    mockMail.sendEmail.mockReset().mockResolvedValue(undefined);
  });

  // --- Sign-up tests ---

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
        .send({ email: 'byte-test-new@example.com', password: 'password123' });

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

    // Timing test for sign-up
    it('does not reveal branch via timing (sign-up: new vs existing)', async () => {
      const N = 30;
      const newEmail = 'timing-new@example.com';
      const existingEmail = 'existing@example.com';

      const newTimes: number[] = [];
      const existingTimes: number[] = [];

      for (let i = 0; i < N; i++) {
        mockRepo.findByEmail.mockResolvedValue(null);
        mockRepo.createUser.mockResolvedValue({ id: 'timing-uuid' });

        const t0 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: newEmail, password: 'password123' });
        newTimes.push(performance.now() - t0);

        mockRepo.findByEmail.mockResolvedValue(existingUser);
        mockRepo.touchUser.mockResolvedValue(undefined);

        const t1 = performance.now();
        await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: existingEmail, password: 'password123' });
        existingTimes.push(performance.now() - t1);
      }

      const median = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      const p95 = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1)];
      };

      const medDiff = Math.abs(median(newTimes) - median(existingTimes));
      const p95Diff = Math.abs(p95(newTimes) - p95(existingTimes));

      // Threshold: if timing difference exceeds this, the property is broken
      const THRESHOLD_MS = 50;
      expect(medDiff).toBeLessThan(THRESHOLD_MS);
      expect(p95Diff).toBeLessThan(THRESHOLD_MS * 2);
    });
  });

  // --- Sign-in tests ---

  describe('POST /auth/sign-in', () => {
    it('returns 200 with a token for correct credentials', async () => {
      mockRepo.findByEmail.mockResolvedValue(existingUser);

      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'correct-password' })
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

      const resWrongPassword = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'existing@example.com', password: 'wrong-password' });

      mockRepo.findByEmail.mockResolvedValue(null);

      const resUnknownEmail = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'unknown@example.com', password: 'wrong-password' });

      expect(resWrongPassword.status).toBe(resUnknownEmail.status);
      expect(Buffer.from(resWrongPassword.text, 'utf-8')).toEqual(Buffer.from(resUnknownEmail.text, 'utf-8'));
      expect(resWrongPassword.headers['content-type']).toBe(resUnknownEmail.headers['content-type']);
    });

    it('returns 400 validation_failed for missing fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'no-password@example.com' })
        .expect(400);

      expect(res.body.error.code).toBe('validation_failed');
    });

    // Timing test for sign-in
    it('does not reveal branch via timing (sign-in: wrong-password vs unknown-email)', async () => {
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

      const median = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      const p95 = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1)];
      };

      const medDiff = Math.abs(median(wrongPasswordTimes) - median(unknownEmailTimes));
      const p95Diff = Math.abs(p95(wrongPasswordTimes) - p95(unknownEmailTimes));

      const THRESHOLD_MS = 50;
      expect(medDiff).toBeLessThan(THRESHOLD_MS);
      expect(p95Diff).toBeLessThan(THRESHOLD_MS * 2);
    });
  });
});
```

Wait, I need to think about the sign-in success case. The plan says:
- If `existing` is non-null **and** verify returned `true`: create opaque token

But in my mock, `existingUser.passwordHash` is a fake argon2 hash. When the service calls `argon2.verify(dto.password, existingUser.passwordHash)`, it will likely fail because the password doesn't match the fake hash.

For the "correct credentials" test, I need the verify to actually succeed. This means I either:
1. Use a real argon2 hash that matches the password I'm sending
2. Or mock at a different level

Option 1 is better for testing. I can generate a real argon2 hash in the test setup:

```typescript
import * as argon2 from 'argon2';

// In beforeAll or setup:
const realPassword = 'correct-password-123';
const realHash = await argon2.hash(realPassword, { type: argon2.argon2id });
const existingUser = {
  id: 'test-uuid-1234',
  email: 'existing@example.com',
  passwordHash: realHash,
};
```

This way, when the test sends `password: 'correct-password-123'`, the argon2 verify will succeed.

For the "wrong password" case, I send a different password and the verify will fail.

This is the correct approach. Let me revise.

Also, I need to think about whether `performance.now()` is available in Node.js with Vitest. Yes, it is - `performance` is a global in Node 20+.

Let me also think about the timing threshold. With argon2id at t=3, m=65536 KiB, the verify takes roughly 50-100ms. The difference between verifying against a real hash vs the dummy hash should be negligible (both are argon2id with same params). The DB operations are mocked (resolve immediately), so the timing should be dominated by argon2.

A threshold of 50ms for median difference seems reasonable. The p95 threshold at 100ms gives some room for variance.

Actually, wait. Let me reconsider the threshold. If argon2 takes ~100ms, and both branches do the same amount of work, the difference should be in the range of a few milliseconds (just the overhead of different DB operations, which are mocked). So 50ms for median should be very safe. Let me keep it.

Now let me also think about the `AuthFailureError`. The service throws this, and the global filter catches it and returns 401. For this to work in tests, I need the exception filter to be registered.

Looking at the plan: "global exception filter that maps `AuthFailureError → 401` and `ValidationError → 400` into the standard envelope"

I need to either:
1. Import and apply the filter in the test setup
2. Or define it inline

Since I don't know the exact path of the filter, let me think... The plan says it's in `main.ts`. But in tests, I'm creating the app via `Test.createTestingModule`, so I don't run `main.ts`. I need to apply the filter manually.

I'll create a simple exception filter inline in the test that handles `AuthFailureError`:

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch(AuthFailureError)
class AuthFailureFilter implements ExceptionFilter {
  catch(exception: AuthFailureError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(401).json({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        details: {},
      },
    });
  }
}
```

And for validation errors (from ValidationPipe), I need another filter or I can use the default behavior. Actually, `ValidationPipe` throws a `BadRequestException` by default, which would return 400 but with NestJS's default format, not our custom envelope.

Hmm, this is getting complicated. Let me think about what the test actually needs to verify:
- For 401: the body has `error.code === 'invalid_credentials'`
- For 400: the body has `error.code === 'validation_failed'`

I'll create exception filters that produce the correct envelope format.

Actually, let me simplify. I'll apply the filter in the test setup:

```typescript
app.useGlobalFilters(
  new AuthFailureFilter(),
  new ValidationExceptionFilter(),
);
```

Let me write the complete file now, being very careful about matching all parentheses.

Actually, I realize I should also think about whether `supertest` and the argon2 import are available. The plan says the stack is TypeScript + NestJS + Prisma + PostgreSQL, and the package manager is pnpm. I'll assume `supertest` and `@types/supertest` are available as dev dependencies (they're standard for NestJS testing).

Let me also reconsider the structure. The error was at line 324, which suggests the file is about 324 lines. My version should be of similar length but with all parentheses matched.

Let me write it out carefully now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { AuthRepository } from '../src/auth/auth.repository';

// --- Exception filters for the error envelope ---

@Catch(AuthFailureError)
class AuthFailureFilter implements ExceptionFilter {
  catch(exception: AuthFailureError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(401).json({
      error: { code: 'invalid_credentials', message: 'Invalid credentials.', details: {} },
    });
  }
}

@Catch()
class ValidationFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    if (exception instanceof Error && exception.message.includes('Validation')) {
      response.status(400).json({
        error: { code: 'validation_failed', message: exception.message, details: {} },
      });
    } else {
      response.status(500).json({
        error: { code: 'internal_error', message: exception instanceof Error ? exception.message : 'Unknown error', details: {} },
      });
    }
  }
}
```

Hmm, actually the catch-all filter is too broad. Let me be more specific. The `ValidationPipe` throws a `BadRequestException` from `@nestjs/common`. Let me catch that specifically:

```typescript
import { BadRequestException } from '@nestjs/common';

@Catch(BadRequestException)
class ValidationFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const res = response;
    res.status(400).json({
      error: { code: 'validation_failed', message: exception.message, details: {} },
    });
  }
}
```

Wait, but `ValidationPipe` by default throws a `BadRequestException`. Let me verify... Yes, in NestJS, `ValidationPipe` throws `BadRequestException` when validation fails.

OK let me write the complete file now. I'll be very careful with parentheses.

Let me count my braces and parens as I go:

```typescript
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
  let authService: AuthService;

  const mockRepo = {
    findByEmail: vi.fn(),
    createUser: vi.fn(),
    touchUser: vi.fn(),
  };

  const mockMail: MailPort = {
    sendEmail: vi.fn(),
  };

  let existingUser: { id: string; email: string; passwordHash: string };

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

    authService = moduleRef.get(AuthService);
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
    it('creates a new account and returns 200', async () => {
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
```

Let me count the lines... that's roughly 280-300 lines. The original was 324+ lines (error at line 324). That's close enough - the original might have had some extra blank lines or comments.

Now let me double-check all my parentheses and braces:

1. `@Catch(AuthFailureError)` - class with method `catch` - looks good
2. `@Catch(BadRequestException)` - class with method `catch` - looks good
3. `describe('Auth', () => {` ... `});` - matches
4. Each `it(...)` block - let me verify each one has matching parens

Let me trace through the timing test more carefully:

```typescript
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
```

Let me count parens in `p95`:
- `(arr: number[]): number => {` - opens the function body
- `const sorted = [...arr].sort((a, b) => a - b);` - balanced
- `return sorted[Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1)];` 
  - `Math.min(` opens
  - `Math.ceil(0.95 * sorted.length)` - balanced inside
  - `- 1, sorted.length - 1` - args
  - `)` closes Math.min
  - `]` closes array index
- `}` closes function body

That looks balanced.

Let me also verify the `median` function:
- `(arr: number[]): number => {` - opens
- `const sorted = [...arr].sort((a, b) => a - b);` - balanced
- `const mid = Math.floor(sorted.length / 2);` - balanced
- `return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;`
  - `(sorted[mid - 1] + sorted[mid])` - balanced
- `}` closes

Good.

Now, one concern: the `catch` method name. In TypeScript, `catch` is a reserved word in some contexts (try/catch). However, as a method name on a class, it should be fine. The `ExceptionFilter` interface requires a `catch` method. Let me verify this is valid TypeScript... Yes, method names can be reserved words in class definitions.

Actually wait, I just realized there might be an issue. The `ExceptionFilter` interface in NestJS has the method signature:
```typescript
catch(exception: T, host: ArgumentsHost): void;
```

But `catch` is indeed a reserved word. However, in TypeScript/JavaScript, you can use reserved words as method names:
```typescript
class Foo {
  catch() { }
}
```

This is valid. So we're fine.

Let me also think about whether I need `// ASSUMPTION:` comments. The plan mentions:
- The MailPort interface with `sendEmail(to, template, vars)`
- The AuthFailureError class
- The AuthRepository with `findByEmail`, `createUser`, `touchUser`

I'm assuming these exist as specified in the plan. Since I can't see the actual source files, I'm relying on the plan's specifications. I don't think I need ASSUMPTION lines for these since they're directly from the plan.

One thing I'm not 100% sure about: does `MailPort` exist as an exported type from `auth.service.ts`? The plan says:
```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

So yes, it should be importable from there.

Similarly, `AuthFailureError` should be exported from `auth.service.ts`.

I think my test file is complete and correct. Let me write the final version.

Wait, one more thought: the `vi.fn()` usage. In Vitest, `vi` is a global. I should make sure I'm using it correctly. `vi.fn()` creates a mock function. `.mockResolvedValue(...)` sets the return value for async calls. This is correct for Vitest.

Also, I should note that `performance.now()` is available as a global in Node.js (since Node 8 or so), and definitely in Node 20+. No import needed.

Let me finalize the file.
```

## reply

```typescript
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
```
