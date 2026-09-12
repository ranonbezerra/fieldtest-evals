# repair1-set

## reasoning

```
We need to fix import paths likely due to missing index.ts or .js extension? In TypeScript with "type": "module", need to include file extensions in imports. All imports lack .js. Need to add .js extensions. Change imports to include .js relative paths. Also class-validator path is package, fine. But with ESM, need to import with .js? Node ESM requires extensions for local files only. External packages ok. So adjust all local imports to include .js extension.

Files to modify: src/app.module.ts, src/main.ts, src/auth/*.ts, src/prisma/*.ts, test files import paths need .js? Tests run via ts-node? They compile TS, so import .ts maybe okay. But with ESM, need .js. So adjust test imports too.

Also prisma.service file not shown; likely exists without .js extension. Need to adjust its import.

Implement changes.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Global validation for DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```

### src/auth/auth.controller.ts
```ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service.js';

class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.OK) // Always return 200, regardless of account existence.
  async signUp(@Body() signUpDto: SignUpDto): Promise<{ message: string }> {
    await this.authService.signUp(signUpDto.email, signUpDto.password);
    return {
      message: 'If you have not yet verified your email, please check your inbox.',
    };
  }

  @Post('sign-in')
  async signIn(@Body() signInDto: SignInDto) {
    // Returns an access token on success, or throws an HttpException on failure.
    return await this.authService.signIn(signInDto.email, signInDto.password);
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { User } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { sendEmail } from '../mail/mail.service.js';

@Injectable()
export class AuthService {
  // Dummy hash used to equalise timing when the fast branch would otherwise skip hashing.
  private readonly dummyHashPromise: Promise<string>;

  constructor(private readonly authRepository: AuthRepository) {
    // Generate a dummy Argon2id hash once at start‑up.
    this.dummyHashPromise = argon2.hash('dummy_password', { type: argon2.argon2id });
  }

  private async getDummyHash(): Promise<string> {
    return this.dummyHashPromise;
  }

  /**
   * Sign‑up flow.
   * - If the e‑mail already exists, we verify the supplied password against a dummy hash
   *   to consume the same amount of CPU time as the hashing path.
   * - In both cases a generic 200 response is returned and an e‑mail is sent out‑of‑band.
   */
  async signUp(email: string, password: string): Promise<void> {
    const existingUser = await this.authRepository.findByEmail(email);
    const dummyHash = await this.getDummyHash();

    if (existingUser) {
      // Equalise timing by performing a dummy verification.
      await argon2.verify(dummyHash, password);
      // Notify the owner – fire‑and‑forget.
      void sendEmail(email, 'sign-up-attempt', {});
    } else {
      // Hash the password for storage.
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await this.authRepository.createUser(email, passwordHash);
      // Send verification e‑mail – fire‑and‑forget.
      void sendEmail(email, 'verification', {});
    }
    // The controller emits the generic response; nothing else is returned here.
  }

  /**
   * Sign‑in flow.
   * - On success a dummy access token is returned.
   * - On any failure (unknown e‑mail or wrong password) a dummy verification is performed
   *   when the e‑mail is unknown, ensuring identical timing to the wrong‑password case.
   * - A generic 401 error envelope is thrown; it does not reveal which check failed.
   */
  async signIn(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.authRepository.findByEmail(email);
    const dummyHash = await this.getDummyHash();

    if (user) {
      const passwordValid = await argon2.verify(user.passwordHash, password);
      if (passwordValid) {
        // In a real system this would be a signed JWT; we return a placeholder.
        return { accessToken: 'dummy-token' };
      }
      // Wrong password – verification already performed, timing is as intended.
    } else {
      // Unknown e‑mail – perform dummy verification to match timing of the wrong‑password path.
      await argon2.verify(dummyHash, password);
    }

    // Generic error response – no indication whether the e‑mail existed.
    throw new HttpException(
      {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/auth.spec.ts
```ts
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
```
