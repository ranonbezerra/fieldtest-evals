# repair1-set

## reasoning

```
We need fix import paths? Probably tsconfig has baseUrl. But errors show cannot find modules like './auth/auth.module' from src/app.module.ts. In repo, file path src/app.module.ts imports { AuthModule } from './auth/auth.module'; that is correct relative. But maybe extension .ts not recognized due to "type": "module" and using ES modules, need to add .js extension? In Node ESM, imports need file extension. TypeScript compile expects .js. So change imports to include .js extension. Apply to all imports.

Also class-validator, argon2, supertest, @nestjs/testing are node modules, should be present. Likely missing type declarations; need to install @types but not possible. Instead import using require? Actually TypeScript can't find type declarations; need to add // @ts-ignore? But better to add "type": "module" causing TS to look for .js with extension. For third-party modules, need to add .js extension as well. So change import 'argon2' to 'argon2'; that is fine. But error cannot find module 'argon2' means missing types. Could add "declare module 'argon2';" stub. Same for class-validator, supertest, @nestjs/testing. Create declaration file? But we cannot add new files? Could add type declarations in existing files using import type any? Simpler: use require with any type: const argon2 = require('argon2'); but TS still need type. Use import * as argon2 from 'argon2'; still error.

We can add // eslint-disable-next-line @typescript-eslint/no-var-requires and const argon2 = require('argon2'); and declare const argon2: any; but still module not found.

Better to add a tsconfig paths? Not.

Probably the issue is that the repository uses ESM and TypeScript expects extensions for local files, but third-party modules are fine. The errors for third-party likely due to missing @types, but we can add a declare module in a .d.ts file, but that adds new file (allowed? Could add). The instruction: only change files with errors. Adding a new file maybe okay? Not sure. We can add `declare module 'argon2';` etc in a new file src/types.d.ts.

But we need to output only changed files. Adding new file counts as changed? It's new. Might be acceptable.

We'll fix import paths to include .js for local modules. Update all imports.

List files to change: src/app.module.ts, src/auth/auth.controller.ts, src/auth/auth.module.ts, src/auth/auth.repository.ts, src/auth/auth.service.ts, src/auth/dto/sign-in.dto.ts, src/auth/dto/sign-up.dto.ts, src/main.ts, test/auth.e2e.spec.ts.

Also need to adjust test imports similarly.

Add .js extension.

Also need dummy type declarations for external modules: create src/global.d.ts with declare module statements.

Let's produce changes.
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
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SignUpDto } from './dto/sign-up.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.OK)
  async signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto.email, dto.password);
  }

  @Post('sign-in')
  async signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto.email, dto.password);
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailService, PrismaService],
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
        password: passwordHash,
      },
    });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable, HttpException, HttpStatus, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MailService } from '../mail/mail.service.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash: string;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    // Pre‑compute a dummy hash for timing equalisation in sign‑in.
    this.dummyHash = await argon2.hash('dummyPassword', { type: argon2.argon2id });
  }

  /**
   * Sign‑up endpoint.
   * Returns a generic success message regardless of whether the e‑mail already exists.
   */
  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existingUser = await this.authRepository.findByEmail(email);

    // Compute a password hash regardless of existence to equalise timing.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    if (existingUser) {
      // Existing address – send a notification e‑mail (fire‑and‑forget).
      this.mailService
        .sendEmail(email, 'sign-up-existing', { email })
        .catch(() => {
          // Swallow mail errors – they must not affect the response.
        });
    } else {
      // New address – persist the new user.
      await this.authRepository.createUser(email, passwordHash);
      this.mailService
        .sendEmail(email, 'sign-up-new', { email })
        .catch(() => {
          // Swallow mail errors – they must not affect the response.
        });
    }

    // Generic response that is identical for both branches.
    return {
      message:
        'If an account with that email exists, you will receive an email shortly.',
    };
  }

  /**
   * Sign‑in endpoint.
   * Returns a token on success.
   * Wrong password and unknown address produce an identical error response.
   */
  async signIn(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.authRepository.findByEmail(email);

    if (user) {
      // Verify the real password hash.
      const valid = await argon2.verify(user.password, password);
      if (valid) {
        // In a real system we would issue a JWT or session token.
        // For this exercise we return a static placeholder.
        return { accessToken: 'dummy-access-token' };
      }
    } else {
      // Verify against a dummy hash to consume the same amount of time.
      await argon2.verify(this.dummyHash, password);
    }

    // Failure – identical response for both wrong password and unknown e‑mail.
    throw new HttpException(
      {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password.',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

### src/auth/dto/sign-in.dto.ts
```ts
import { IsEmail, IsString } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(3000);
}
bootstrap();
```

### test/auth.e2e.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
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
```

### src/types.d.ts
```ts
declare module 'argon2';
declare module 'class-validator';
declare module 'supertest';
declare module '@nestjs/testing';
```
