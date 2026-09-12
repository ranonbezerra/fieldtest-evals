# repair2-set

## reasoning

```
Need to import correct names. In NestJS testing, exports are 'Test' is correct? Actually from '@nestjs/testing' import { Test, TestingModule }. That is correct. But TypeScript errors suggest the library version maybe uses 'TestingModule' etc. Should be 'TestingModule' and 'Test' are exported. Perhaps need to import from '@nestjs/testing' default? Actually they are exported. Maybe the issue is using ESM and need to add .js extensions? In other files they import with .js extension like import { AuthModule } from '../src/auth/auth.module.js'; test file uses import { AuthModule } from '../src/auth/auth.module.js'; Already .js. The errors about class-validator missing members likely due to using named imports but need to import from 'class-validator' default? Actually class-validator exports IsEmail etc. Should be fine. Maybe using ESM requires adding .js extension to import? But class-validator is a package, no extension.

Probably TypeScript config has "esModuleInterop": true? Not given.

Maybe the issue is that they are compiled as .js modules, need to import with .js extension for local files only. The errors maybe because file compiled as .ts but tsconfig's "moduleResolution": "node16"? Not.

Maybe the actual exported names are 'IsEmail' etc are functions, should be imported from 'class-validator' as 'IsEmail', correct.

Possibility: The file path is .ts but using "type":"module". In that case, importing from a CommonJS package need to use default import? No.

Probably the errors due to missing .js extension in imports of class-validator? No.

Given pattern, maybe the project uses "class-validator" version that exports decorators differently? Unlikely.

Simpler: adjust imports to import from 'class-validator' with * as validator and use validator.IsEmail etc. But that changes many.

But test errors about '@nestjs/testing' similarly.

Maybe the solution: change import statements to use require syntax? Not.

Given constraints, maybe the actual exported members are in 'class-validator' but TypeScript cannot find because tsconfig has "moduleResolution": "node16" and "type":"module" causing .ts import to need .js extension for packages? Actually for bare specifiers, extension not needed.

I'm stuck. Possibly the issue is that the files are .ts but project uses .js imports elsewhere, and tsconfig "allowJs": true? Might need to add .js to class-validator imports? Not.

Given time, maybe just change imports to use default import * as cv from 'class-validator'; and then export classes using decorators? That would compile.

Implement in both dto files: import { IsEmail, IsString, MinLength } from 'class-validator'; -> change to import * as cv from 'class-validator'; and use @cv.IsEmail etc. But need to modify decorators accordingly.

Similarly test file: import { Test, TestingModule } from '@nestjs/testing'; -> change to import * as nestTesting from '@nestjs/testing'; and use nestTesting.Test etc.

Let's do that.
```

## reply

### src/auth/dto/sign-in.dto.ts
```ts
import * as cv from 'class-validator';

export class SignInDto {
  @cv.IsEmail()
  email!: string;

  @cv.IsString()
  @cv.MinLength(8)
  password!: string;
}
```

### src/auth/dto/sign-up.dto.ts
```ts
import * as cv from 'class-validator';

export class SignUpDto {
  @cv.IsEmail()
  email!: string;

  @cv.IsString()
  @cv.MinLength(8)
  password!: string;
}
```

### test/auth.spec.ts
```ts
import * as nestTesting from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { setTimeout } from 'timers/promises';

describe('Auth API (timing & constant‑response)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const SIGN_UP = '/auth/sign-up';
  const SIGN_IN = '/auth/sign-in';

  const existingUser = {
    email: 'existing@example.com',
    password: 'StrongPass123!',
  };

  const newUser = {
    email: 'new@example.com',
    password: 'AnotherStrongPass123!',
  };

  beforeAll(async () => {
    const moduleRef: nestTesting.TestingModule = await nestTesting.Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = new PrismaClient();
    // Clean up before tests
    await prisma.user.deleteMany();
    const hash = await argon2.hash(existingUser.password, {
      type: argon2.argon2id,
    });
    await prisma.user.create({
      data: {
        email: existingUser.email,
        passwordHash: hash,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  /**
   * Helper to measure request duration in milliseconds.
   */
  async function timedRequest(
    method: 'post' | 'get',
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: any; duration: number; raw: Buffer }> {
    const start = Date.now();
    const res = await request(app.getHttpServer())[method](path).send(payload);
    const duration = Date.now() - start;
    const raw = (res as any).req.res.outputData[0]?.data
      ? Buffer.from((res as any).req.res.outputData[0].data)
      : Buffer.from(JSON.stringify(res.body));
    return {
      status: res.status,
      body: res.body,
      duration,
      raw,
    };
  }

  it('sign‑up returns identical responses for existing and new e‑mail', async () => {
    const existing = await timedRequest('post', SIGN_UP, existingUser);
    const fresh = await timedRequest('post', SIGN_UP, newUser);

    // Status code identical
    expect(existing.status).toBe(fresh.status);
    // Body byte‑identical
    expect(existing.raw.equals(fresh.raw)).toBe(true);
  });

  it('sign‑in returns identical error responses for wrong password and unknown e‑mail', async () => {
    const wrongPassword = await timedRequest('post', SIGN_IN, {
      email: existingUser.email,
      password: 'IncorrectPass!',
    });

    const unknownEmail = await timedRequest('post', SIGN_IN, {
      email: 'doesnotexist@example.com',
      password: 'Whatever123!',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.raw.equals(unknownEmail.raw)).toBe(true);
  });

  it('sign‑up timing is indistinguishable between branches', async () => {
    const samples = 20;
    const existingTimes: number[] = [];
    const newTimes: number[] = [];

    for (let i = 0; i < samples; i++) {
      const existing = await timedRequest('post', SIGN_UP, existingUser);
      const fresh = await timedRequest('post', SIGN_UP, {
        email: `temp${i}@example.com`,
        password: newUser.password,
      });
      existingTimes.push(existing.duration);
      newTimes.push(fresh.duration);
      // Small pause to avoid overlapping CPU bursts
      await setTimeout(20);
    }

    const avg = (arr: number[]) =>
      arr.reduce((sum, v) => sum + v, 0) / arr.length;

    const avgExisting = avg(existingTimes);
    const avgNew = avg(newTimes);
    const diff = Math.abs(avgExisting - avgNew);

    // Tolerance of 30 ms (empirically generous for CI environments)
    expect(diff).toBeLessThanOrEqual(30);
    // Ensure work was actually done – both averages must be > 150 ms
    expect(avgExisting).toBeGreaterThan(150);
    expect(avgNew).toBeGreaterThan(150);
  });

  it('sign‑in timing is indistinguishable between wrong password and unknown e‑mail', async () => {
    const samples = 20;
    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];

    for (let i = 0; i < samples; i++) {
      const wrong = await timedRequest('post', SIGN_IN, {
        email: existingUser.email,
        password: `WrongPass${i}!`,
      });
      const unknown = await timedRequest('post', SIGN_IN, {
        email: `unknown${i}@example.com`,
        password: 'DoesNotMatter123!',
      });
      wrongTimes.push(wrong.duration);
      unknownTimes.push(unknown.duration);
      await setTimeout(20);
    }

    const avg = (arr: number[]) =>
      arr.reduce((sum, v) => sum + v, 0) / arr.length;

    const avgWrong = avg(wrongTimes);
    const avgUnknown = avg(unknownTimes);
    const diff = Math.abs(avgWrong - avgUnknown);

    expect(diff).toBeLessThanOrEqual(30);
    expect(avgWrong).toBeGreaterThan(150);
    expect(avgUnknown).toBeGreaterThan(150);
  });
});
```
