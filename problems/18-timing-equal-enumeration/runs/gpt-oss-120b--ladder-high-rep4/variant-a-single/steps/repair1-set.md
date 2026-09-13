# repair1-set

## reasoning

```
We need to fix import paths with .js extensions? In ES module mode need extensions. So add .js to relative imports. Also need to install types? But we just adjust imports to include .js where needed. For package imports like class-validator, argon2, nestjs etc they have types, should be fine. The errors about not finding module likely due to missing .js extension in internal imports. Add .js to all relative imports.

Files: src/app.module.ts imports './auth/auth.module' -> should be './auth/auth.module.js'. Also './prisma.service' -> './prisma.service.js'.

Similarly others.

Also src/auth/auth.controller.ts imports './auth.service' -> './auth.service.js' and 'class-validator' stays.

src/auth/auth.module.ts imports './auth.controller', './auth.service', './auth.repository', './password.service', '../prisma.service' -> add .js.

src/auth/auth.repository.ts imports '../prisma.service' -> '../prisma.service.js'.

src/auth/auth.service.ts imports './auth.repository', './password.service', './invalid-credentials.exception' -> add .js. Also mail import '../mail' needs .js? In code it's import { sendEmail } from '../mail'; need .js extension.

src/auth/password.service.ts imports 'argon2' which is node module; no extension needed.

src/main.ts imports './app.module' -> './app.module.js'.

test files import from src with .js? test/auth.spec.ts imports '../src/app.module' -> should be '../src/app.module.js', same for prisma.service.

Also need to ensure that InvalidCredentialsException file exists? Not shown, but likely there is a file. Path should be .js.

We'll modify imports accordingly.

Provide changed files list.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [AuthModule],
  providers: [PrismaService],
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
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(3000);
}
bootstrap();
```

### src/auth/auth.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { IsEmail, IsString, MinLength } from 'class-validator';

class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.OK)
  async signUp(@Body() dto: SignUpDto) {
    await this.authService.signUp(dto.email, dto.password);
    return {
      message:
        'If a user with this email exists, you will receive an email shortly',
    };
  }

  @Post('sign-in')
  async signIn(@Body() dto: SignInDto) {
    const token = await this.authService.signIn(dto.email, dto.password);
    return { token };
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PasswordService, PrismaService],
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
import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { InvalidCredentialsException } from './invalid-credentials.exception.js';
import { sendEmail } from '../mail.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async signUp(email: string, password: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();

    // Start hashing immediately – both branches must pay the cost.
    const hashPromise = this.passwordService.hashPassword(password);

    // Determine whether the address already exists.
    const existingUser = await this.authRepository.findByEmail(
      normalizedEmail,
    );

    // Await the hash to equalise timing.
    const passwordHash = await hashPromise;

    if (!existingUser) {
      // New address – create the account.
      await this.authRepository.createUser(normalizedEmail, passwordHash);
      // Verification email (out‑of‑band).
      sendEmail(normalizedEmail, 'verification', {}).catch(() => {});
    } else {
      // Existing address – inform the owner.
      sendEmail(normalizedEmail, 'signup-notification', {}).catch(() => {});
    }
    // The controller sends a generic response; nothing else is awaited.
  }

  async signIn(email: string, password: string): Promise<string> {
    const normalizedEmail = email.toLowerCase();

    const user = await this.authRepository.findByEmail(normalizedEmail);
    const hash = user
      ? user.passwordHash
      : this.passwordService.getDummyHash();

    // Verification is performed in all cases.
    const isValid = await this.passwordService.verifyPassword(
      password,
      hash,
    );

    if (user && isValid) {
      // Successful authentication – token generation is out of scope.
      return 'dummy-token';
    }

    // Wrong password or unknown address – identical error.
    throw new InvalidCredentialsException();
  }
}
```

### test/auth.spec.ts
```ts
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
```
