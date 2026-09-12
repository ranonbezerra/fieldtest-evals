# repair1-set

## reasoning

```
We need adjust import paths: likely missing .ts extensions? In ESM need extensions. Add .js? Actually Node ESM requires extension .js. So change imports to include .js. Apply to all. Also argon2 import maybe default? Use import * as argon2 from 'argon2'; that's fine but need type declarations; maybe need to install @types? Not. Probably need to add .js extension to local imports. Also class-validator import need extension? It's node_modules, fine. The errors are cannot find module './auth.service' etc because missing .js extension in ESM. So modify all relative imports to include .js. Also prisma.service path maybe '../prisma.service' needs .js. Also test imports need .js? test files are ts compiled, they import from '../src/auth/auth.controller' need .js? In tsconfig with moduleResolution node16? Usually need .js. So add .js. Also invalid-credentials.exception file not shown but exists? Not in reference, maybe missing file causing error but import failing due to path. It exists likely. We'll just add .js.

Provide changed files: src/app.module.ts, src/auth/auth.controller.ts, src/auth/auth.module.ts, src/auth/auth.repository.ts, src/auth/auth.service.ts, src/auth/dto/sign-in.dto.ts, src/auth/dto/sign-up.dto.ts, src/main.ts, test/auth.spec.ts.

Let's output with corrected imports adding .js extension.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [AuthModule],
})
export class AppModule {}
```

### src/auth/auth.controller.ts
```ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SignUpDto } from './dto/sign-up.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(200)
  async signUp(@Body() dto: SignUpDto) {
    await this.authService.signUp(dto.email, dto.password);
    return {
      message:
        'If an account does not exist, a verification email has been sent',
    };
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() dto: SignInDto) {
    const result = await this.authService.signIn(dto.email, dto.password);
    return result;
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
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
import {
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { sendEmail } from '../email/email.service.js';
import { InvalidCredentialsException } from './invalid-credentials.exception.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(private readonly authRepository: AuthRepository) {}

  async onModuleInit() {
    // Pre‑compute a dummy hash once so that the unknown‑email branch has the
    // same cryptographic workload as the known‑email branch.
    this.dummyHash = await argon2.hash('dummy_password', {
      type: argon2.argon2id,
    });
  }

  async signUp(email: string, password: string): Promise<void> {
    // Always hash the supplied password – this equalises the time spent
    // regardless of whether the address already exists.
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const existingUser = await this.authRepository.findByEmail(email);
    if (existingUser) {
      // Existing address – notify the owner without revealing anything.
      void sendEmail(email, 'signup-attempt', {});
    } else {
      // New address – create the account and send verification.
      await this.authRepository.createUser(email, passwordHash);
      void sendEmail(email, 'verify-email', {});
    }
    // The controller returns a generic success message.
  }

  async signIn(email: string, password: string): Promise<{ token: string }> {
    const user = await this.authRepository.findByEmail(email);
    let passwordMatches = false;

    if (user) {
      // Verify the supplied password against the stored hash.
      passwordMatches = await argon2.verify(user.passwordHash, password);
    } else {
      // Verify against the pre‑computed dummy hash to keep timing identical.
      passwordMatches = await argon2.verify(this.dummyHash, password);
    }

    if (!passwordMatches) {
      // Generic error – does not reveal whether the address exists.
      throw new InvalidCredentialsException();
    }

    // Authentication succeeded. In a real system a JWT would be issued.
    return { token: 'dummy-token' };
  }
}
```

### src/auth/dto/sign-in.dto.ts
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

### src/auth/dto/sign-up.dto.ts
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(3000);
}
bootstrap();
```

### test/auth.spec.ts
```ts
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
```
