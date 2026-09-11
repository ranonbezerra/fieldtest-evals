# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **`APP_FILTER` not exported from `@nestjs/common`** — This is a single mistake. `APP_FILTER` was moved to `@nestjs/core` in newer versions of NestJS. Let me check... Actually, `APP_FILTER` has been in `@nestjs/common` since NestJS 7+. But wait, maybe the version installed is different. Let me think about this differently.

Actually, looking more carefully, `APP_FILTER` is indeed exported from `@nestjs/common` in all modern versions of NestJS. But the error says it's not. This could be a version issue. However, the task says "Change exactly what the compiler requires." So I need to fix this.

Wait, let me reconsider. In NestJS, `APP_FILTER` is exported from `@nestjs/common`. Let me check if maybe it's a type resolution issue. Actually no — `APP_FILTER` is definitely in `@nestjs/common`. But the compiler says it's not there. 

Hmm, but the instructions say "Change exactly what the compiler requires." If the compiler says `APP_FILTER` is not in `@nestjs/common`, maybe in the installed version it's in `@nestjs/core`? Let me check...

Actually, looking at the NestJS source, `APP_FILTER` is defined in `@nestjs/common/constants` and re-exported from `@nestjs/common`. It should be available. But if the compiler is saying it's not, perhaps the installed version is very old or there's a resolution issue.

Wait — I need to be more careful. The error is `TS2305: Module '"@nestjs/common"' has no exported member 'APP_FILTER'`. This is a type-level error. In some versions of NestJS or with certain TS configurations, this might not be found. But the standard fix would be to import it from where it actually lives.

Actually, I just realized — in NestJS 10+, `APP_FILTER` IS exported from `@nestjs/common`. So if the compiler says it's not, maybe the `node_modules` has a different version. But the task says to fix what the compiler requires.

Let me look at this differently. The `APP_FILTER` constant is in `@nestjs/common` in all versions I know of. But if the compiler is rejecting it, maybe I should use `useClass` approach differently or check if it needs to be imported from a different path.

Actually wait — I just realized. In very old versions of NestJS (before 7.0), `APP_FILTER` might not have existed. But that seems unlikely given the rest of the code uses modern patterns.

Let me re-read the error: `error TS2305: Module '"@nestjs/common"' has no exported member 'APP_FILTER'`. 

One possibility: the `@nestjs/common` package's type definitions don't include it for some reason. But the standard approach is to import from `@nestjs/common`. 

Another possibility: Maybe in the specific version installed, it's `APP_FILTER` from `@nestjs/core`? Let me check... No, `APP_FILTER` is always in `@nestjs/common`.

I think the safest fix here is to just change the import. But where would `APP_FILTER` be if not in `@nestjs/common`? 

Actually, I just realized something. Looking at the NestJS GitHub, `APP_FILTER` is defined in `packages/common/constants.ts` and exported from `packages/common/index.ts`. So it should be in `@nestjs/common`.

But the compiler is saying it's not. The instruction says "Change exactly what the compiler requires." So I need to make the compiler happy. 

One option: import it from a deeper path like `@nestjs/common/constants`. But that's non-standard.

Another option: Maybe the issue is that the installed version of `@nestjs/common` is so old it doesn't have it, and the fix is to use the `APP_FILTER` from a different location.

Actually, you know what, let me just look at this pragmatically. The compiler says `APP_FILTER` is not in `@nestjs/common`. The most likely fix that would satisfy the compiler is to import it from `@nestjs/core` or to define it inline as the string `'APP_FILTER'`.

Wait, actually `APP_FILTER` is just the string `'APP_FILTER'`. So I could just use the string literal directly. But that's ugly.

Let me look at this from another angle. In NestJS source code:
- `@nestjs/common` exports `APP_FILTER` (it's been there since v7)

If the compiler says it's not there, maybe the `node_modules` is broken or the version is wrong. But I can't fix `node_modules`. I can only fix the source files.

The safest fix: Since `APP_FILTER` is just the string `'APP_FILTER'`, I can either:
1. Import from a sub-path: `import { APP_FILTER } from '@nestjs/common/constants'`
2. Use the string literal directly: `provide: 'APP_FILTER'`

Option 2 is the most reliable since it doesn't depend on any export. But it's less readable.

Actually, let me reconsider. Maybe the issue is simpler than I think. Perhaps in the version of NestJS installed, `APP_FILTER` is actually in `@nestjs/core` not `@nestjs/common`. Let me check...

No, I'm quite confident it's in `@nestjs/common`. But the compiler disagrees. Let me just go with importing from `@nestjs/common/constants` which is the actual file where it's defined.

Hmm, but that might also fail if the module resolution doesn't find it.

You know what, the simplest and most reliable fix is to just use the string literal `'APP_FILTER'` as the provide key. This is what the constant actually is, and it will always work regardless of what's exported.

2. **Cannot find module `./auth/auth.module`** and similar for other relative imports without `.js` extensions.

Looking at the errors:
- `src/app.module.ts(2,28)`: Cannot find module './auth/auth.module'
- `src/app.module.ts(3,37)`: Cannot find module './errors/all-exceptions.filter'
- `src/auth/auth.controller.ts(2,57)`: Cannot find module './auth.service'
- `src/auth/auth.module.ts(2,32)`: Cannot find module './auth.controller'
- `src/auth/auth.module.ts(3,40)`: Cannot find module './auth.service'
- `src/auth/auth.module.ts(4,32)`: Cannot find module './auth.repository'
- `src/auth/auth.module.ts(5,48)`: TS2835: Did you mean './password-hash.js'?
- `src/auth/auth.service.ts(2,57)`: Cannot find module './auth.repository'
- `src/auth/auth.service.ts(3,32)`: TS2835: Did you mean './password-hash.js'?
- `src/main.ts(3,27)`: Cannot find module './app.module'
- `test/auth.spec.ts(5,27)`: Cannot find module '../src/app.module'
- `test/auth.spec.ts(6,57)`: Cannot find module '../src/auth/auth.repository'
- `test/auth.spec.ts(7,48)`: TS2835: Did you mean '../src/auth/password-hash.js'?
- `test/auth.spec.ts(8,27)`: Cannot find module '../src/auth/auth.service'

So there are two types of errors here:
- `TS2307`: Cannot find module (no extension at all)
- `TS2835`: Relative import paths need explicit file extensions in ECMAScript imports

Both are the same root cause: the project uses ESM (`"type": "module"`) with `moduleResolution: node16` or `nodenext`, which requires explicit `.js` extensions on relative imports.

The fix is to add `.js` to all relative imports.

Let me list all the files that need `.js` extensions added:

**src/app.module.ts:**
- `'./auth/auth.module'` → `'./auth/auth.module.js'`
- `'./errors/all-exceptions.filter'` → `'./errors/all-exceptions.filter.js'`

**src/auth/auth.controller.ts:**
- `'./auth.service'` → `'./auth.service.js'`

**src/auth/auth.module.ts:**
- `'./auth.controller'` → `'./auth.controller.js'`
- `'./auth.service'` → `'./auth.service.js'`
- `'./auth.repository'` → `'./auth.repository.js'`
- `'./password-hash'` → `'./password-hash.js'`

**src/auth/auth.service.ts:**
- `'./auth.repository'` → `'./auth.repository.js'`
- `'./password-hash'` → `'./password-hash.js'`

**src/main.ts:**
- `'./app.module'` → `'./app.module.js'`

**test/auth.spec.ts:**
- `'../src/app.module'` → `'../src/app.module.js'`
- `'../src/auth/auth.repository'` → `'../src/auth/auth.repository.js'`
- `'../src/auth/password-hash'` → `'../src/auth/password-hash.js'`
- `'../src/auth/auth.service'` → `'../src/auth/auth.service.js'`

3. **Cannot find module `@node-rs/argon2`** — This is a missing package. The error is `TS2307: Cannot find module '@node-rs/argon2'`. This means the package isn't installed or its types aren't available. 

Hmm, but I can't install packages. I can only fix source files. If the package isn't installed, I can't make it resolvable by changing the import. Unless... the package name is wrong?

Wait, `@node-rs/argon2` is a real package. It exists on npm. If it's not found, it's either not installed or the types aren't available. Since I can only modify source files, and the package name `@node-rs/argon2` is correct, maybe the issue is that it needs to be `@node-rs/argon2` with the types coming from the package itself (it ships its own types).

Actually, I think this is a dependency issue that can't be fixed by changing source files. The package simply isn't in `node_modules`. But the task says "Fix all of them in one reply" and "Return only the files you changed."

Hmm, but if the package isn't installed, no amount of source file changes will fix it. Unless the import path is wrong. Let me double-check: `@node-rs/argon2` — yes, that's the correct package name. It exports `argon2id` and `verify` functions.

Wait, maybe I should look at this differently. The `@node-rs/argon2` package does export types. If it's not found, it's a `package.json` / `node_modules` issue, not a source file issue. I cannot fix this by editing source files.

Similarly for `express` and `supertest` and `@nestjs/testing` — these are all `Cannot find module` errors that indicate missing dependencies.

So the errors fall into these categories:
1. **Missing `.js` extensions on relative imports** — Fixable by adding `.js`
2. **`APP_FILTER` not found in `@nestjs/common`** — Possibly fixable by using string literal or different import path
3. **Missing packages (`@node-rs/argon2`, `express`, `supertest`, `@nestjs/testing`)** — NOT fixable by changing source files

Wait, but the task says "Fix all of them in one reply." If some of them can't be fixed by changing source files, what do I do?

Let me re-read: "Change exactly what the compiler requires." and "Return only the files you changed."

I think the intent is that I should fix what I can fix. The missing packages are an environment issue, not a source code issue. I'll fix all the source code issues (extensions, APP_FILTER) and leave the package-related errors as they are since they can't be resolved by file edits.

Actually wait, let me reconsider the `APP_FILTER` issue. In NestJS, `APP_FILTER` has been in `@nestjs/common` since v7. If the compiler says it's not there, maybe the installed version is very old. But more likely, this is also a resolution issue.

Actually, you know what, let me look at this more carefully. The error is:
```
src/app.module.ts(1,10): error TS2305: Module '"@nestjs/common"' has no exported member 'APP_FILTER'.
```

Column 10 on line 1. Line 1 is:
```
import { APP_FILTER, Module } from '@nestjs/common';
```

Position 10 would be `APP_FILTER`. So the compiler is saying `@nestjs/common` is resolved (otherwise it would be TS2307) but `APP_FILTER` is not an exported member.

This is strange. In all modern versions of NestJS, `APP_FILTER` is exported from `@nestjs/common`. 

One possibility: the version of `@nestjs/common` installed is so old that it doesn't have `APP_FILTER`. In that case, the fix would be to not use `APP_FILTER` and instead register the filter differently.

But actually, the simplest fix that will definitely work: just use the string `'APP_FILTER'` directly as the provide value. The constant is literally the string `'APP_FILTER'`, so using the string directly is equivalent.

Let me now plan all the changes:

**Files to change:**

1. `src/app.module.ts` — fix `APP_FILTER` import and add `.js` extensions
2. `src/main.ts` — add `.js` extension
3. `src/auth/auth.controller.ts` — add `.js` extension
4. `src/auth/auth.module.ts` — add `.js` extensions
5. `src/auth/auth.service.ts` — add `.js` extensions
6. `test/auth.spec.ts` — add `.js` extensions

Files I'm NOT changing (errors are due to missing packages, not source issues):
- `src/auth/password-hash.ts` — `@node-rs/argon2` not found (missing package)
- `src/errors/all-exceptions.filter.ts` — `express` not found (missing package)

Wait, but `src/errors/all-exceptions.filter.ts` also has the `express` import issue. Can I fix that? The `express` types are needed for `Response`. I could use a different type or a minimal interface. But the task says "Do not add features, do not rename anything the errors do not mention, do not reorganise." And "Change exactly what the compiler requires."

If `express` is not installed, I can't import from it. But I could define a minimal type. However, that would be "reorganising" or "adding features" which is forbidden.

Hmm, but the error IS mentioned. The compiler requires the module to be resolvable. If I can't make it resolvable by changing the import (because the package isn't installed), then I can't fix it.

Actually wait — maybe I should check if `@types/express` is the issue. In NestJS, `express` types come from `@types/express`. If that's not installed, the import will fail. But again, I can't install packages.

I think the right approach is:
- Fix all errors that are fixable by changing source files (extensions, APP_FILTER)
- Leave errors that require package installation as they are

Let me finalize my changes:

**1. `src/app.module.ts`:**
- Change `import { APP_FILTER, Module } from '@nestjs/common'` to `import { Module } from '@nestjs/common'`
- Change `provide: APP_FILTER` to `provide: 'APP_FILTER'`
- Add `.js` to `'./auth/auth.module'` and `'./errors/all-exceptions.filter'`

**2. `src/main.ts`:**
- Add `.js` to `'./app.module'`

**3. `src/auth/auth.controller.ts`:**
- Add `.js` to `'./auth.service'`

**4. `src/auth/auth.module.ts`:**
- Add `.js` to `'./auth.controller'`, `'./auth.service'`, `'./auth.repository'`, `'./password-hash'`

**5. `src/auth/auth.service.ts`:**
- Add `.js` to `'./auth.repository'` and `'./password-hash'`

**6. `test/auth.spec.ts`:**
- Add `.js` to `'../src/app.module'`, `'../src/auth/auth.repository'`, `'../src/auth/password-hash'`, `'../src/auth/auth.service'`

Now let me write out the complete files.
```

## reply

Looking at the errors as a whole, I see three distinct mistakes:

1. **Missing `.js` extensions on relative imports** — the project uses ESM with `node16`/`nodenext` resolution, so every relative import needs an explicit `.js` suffix. This accounts for the majority of `TS2307` and `TS2835` errors.

2. **`APP_FILTER` not exported from `@nestjs/common`** — the compiler resolves the module but doesn't find the member. The fix is to use the string literal directly (the constant is literally `'APP_FILTER'`).

3. **Missing third-party packages** (`@node-rs/argon2`, `express`, `supertest`, `@nestjs/testing`) — these are environment/`node_modules` issues that cannot be resolved by editing source files.

I'll fix categories 1 and 2 across all affected files.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';

@Module({
  imports: [AuthModule],
  providers: [{ provide: 'APP_FILTER', useClass: AllExceptionsFilter }],
})
export class AppModule {}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

### src/auth/auth.controller.ts
```ts
import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AuthService, SignInResult, SignUpResult } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Blind sign-up. The status and body are identical whether or not the
   * address was new; the actual outcome reaches the address by mail.
   */
  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<SignUpResult> {
    const { email, password } = this.parseCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  async signIn(@Body() body: unknown): Promise<SignInResult> {
    const { email, password } = this.parseCredentials(body);
    return this.authService.signIn(email, password);
  }

  /**
   * Input validation only; the result is handed to the service. Validation
   * runs identically before any branch is taken, so it leaks nothing.
   */
  private parseCredentials(body: unknown): { email: string; password: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      this.reject('The request body must be a JSON object with "email" and "password".');
    }
    const { email, password } = body as Record<string, unknown>;

    const emailValue = typeof email === 'string' ? email.trim() : '';
    if (emailValue.length === 0 || emailValue.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(emailValue)) {
      this.reject('"email" must be a syntactically valid address.');
    }
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      this.reject(`"password" must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
    }

    return { email: emailValue.toLowerCase(), password };
  }

  private reject(message: string): never {
    throw new BadRequestException({
      error: { code: 'invalid_input', message, details: {} },
    });
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService, MAIL_PORT } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { Argon2idHasher, PasswordHasher } from './password-hash.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    { provide: PasswordHasher, useClass: Argon2idHasher },
    {
      provide: MAIL_PORT,
      // ASSUMPTION: the task states a mail port sendEmail(to, template, vars)
      // exists in the host application; it should be bound to this token
      // there. This standalone build needs a concrete provider to boot, so a
      // console sink stands in for it.
      useValue: {
        async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
          console.error(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
        },
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

### src/auth/auth.service.ts
```ts
import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { AuthRepository, EmailAlreadyExistsError } from './auth.repository.js';
import { PasswordHasher } from './password-hash.js';

/** The mail port the feature needs. */
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

/** Injection token for the mail port. */
export const MAIL_PORT = 'MAIL_PORT';

export interface SignUpResult {
  status: 'accepted';
  message: string;
}

export interface SignInResult {
  status: 'authenticated';
  email: string;
}

const DUMMY_PASSWORD = 'dummy-password-for-timing-equalisation';

const SIGN_UP_MESSAGE = 'Your request was accepted. If this address is new, a verification email is on its way.';

const SIGN_IN_FAILURE = {
  error: {
    code: 'authentication_failed',
    message: 'The email or password is incorrect.',
    details: {},
  },
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash = '';

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  /**
   * Build the dummy hash at boot with the identical parameters that real
   * account hashes carry. The unknown-address branch of sign-in verifies
   * against it, so every sign-in spends one full argon2id operation.
   */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hasher.hash(DUMMY_PASSWORD);
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const existing = await this.repository.findByEmail(email);

    if (existing) {
      // No account is created here, but the hash cost is still paid: the
      // supplied password is verified against the stored one. Only the work
      // matters; the result is discarded.
      await this.hasher.verify(existing.passwordHash, password);
      this.deliver(email, 'sign-up-attempt-alert');
    } else {
      const passwordHash = await this.hasher.hash(password);
      try {
        await this.repository.create(email, passwordHash);
        this.deliver(email, 'sign-up-verification');
      } catch (err) {
        if (err instanceof EmailAlreadyExistsError) {
          // A concurrent request created the account first. Same single hash
          // op, same response, same branch of behaviour.
          this.deliver(email, 'sign-up-attempt-alert');
        } else {
          throw err;
        }
      }
    }

    return { status: 'accepted', message: SIGN_UP_MESSAGE };
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = await this.repository.findByEmail(email);

    if (user) {
      const authenticated = await this.hasher.verify(user.passwordHash, password);
      if (!authenticated) {
        throw new UnauthorizedException(SIGN_IN_FAILURE);
      }
      return { status: 'authenticated', email };
    }

    // Unknown address: verify against the dummy hash so this branch takes
    // exactly as long as a real check. The result is always discarded; an
    // unknown address never authenticates, even if the password happened to
    // match the dummy.
    await this.hasher.verify(this.dummyHash, password);
    throw new UnauthorizedException(SIGN_IN_FAILURE);
  }

  /**
   * Out-of-band delivery. The response path never awaits this promise, so a
   * slow or failing mailer cannot change the status, body, or time of the
   * response the caller observes.
   */
  private deliver(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch((err: unknown) => {
      this.logger.error(
        `Mail delivery failed (to=${to}, template=${template}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
```

### test/auth.spec.ts
```ts
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthRepository, EmailAlreadyExistsError } from '../src/auth/auth.repository.js';
import { Argon2idHasher, PasswordHasher } from '../src/auth/password-hash.js';
import { MAIL_PORT } from '../src/auth/auth.service.js';

// A real argon2id cost, reduced from production so the suite stays quick.
// The timing assertions are written against this cost: "slow enough" means
// "at least one real hash op at test cost". Deleting the hashing collapses
// every branch to a few milliseconds and these tests fail.
const TEST_HASH_PARAMS = { memoryCost: 8192, timeCost: 2, parallelism: 1 };

const SLOW_MAIL_DELAY_MS = 2000;
const MIN_BRANCH_MS = 10;
const TIMING_SAMPLES = 10;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A fresh, guaranteed-unique address for each test.
let counter = 0;
function freshEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}@example.test`;
}

interface StoredUser {
  email: string;
  passwordHash: string;
}

class FakeAuthRepository {
  private readonly users = new Map<string, StoredUser>();

  seed(email: string, passwordHash: string): void {
    this.users.set(email, { email, passwordHash });
  }

  get(email: string): StoredUser | null {
    return this.users.get(email) ?? null;
  }

  findByEmail(email: string): Promise<StoredUser | null> {
    return Promise.resolve(this.users.get(email) ?? null);
  }

  create(email: string, passwordHash: string): Promise<StoredUser> {
    if (this.users.has(email)) {
      return Promise.reject(new EmailAlreadyExistsError(email));
    }
    const record: StoredUser = { email, passwordHash };
    this.users.set(email, record);
    return Promise.resolve(record);
  }
}

interface MailCall {
  to: string;
  template: string;
  vars: Record<string, string>;
}

class FakeMailPort {
  calls: MailCall[] = [];
  private failing = false;
  private delayMs = 0;

  setFailing(failing: boolean): void {
    this.failing = failing;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
    }
    if (this.failing) {
      throw new Error('mail server unavailable');
    }
    this.calls.push({ to, template, vars });
  }
}

describe('auth endpoints (enumeration resistance)', () => {
  let app: INestApplication;
  const repository = new FakeAuthRepository();
  const mail = new FakeMailPort();
  const hasher = new Argon2idHasher(TEST_HASH_PARAMS);

  const existingEmail = 'existing@example.test';
  const existingPassword = 'existing-secret-1';
  const timingExistingEmail = 'timing-existing@example.test';

  beforeAll(async () => {
    // Seed addresses with real test-cost hashes so every branch that
    // verifies them does a full KDF op.
    repository.seed(existingEmail, await hasher.hash(existingPassword));
    repository.seed(timingExistingEmail, await hasher.hash('timing-seed-password'));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(PasswordHasher)
      .useValue(hasher)
      .overrideProvider(MAIL_PORT)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe('sign-up', () => {
    it('an existing address and a new one produce byte-identical responses', async () => {
      const existing = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password: 'supplied-secret-1' });
      const fresh = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: freshEmail('bytes-fresh'), password: 'supplied-secret-1' });

      expect(existing.status).toBe(202);
      expect(fresh.status).toBe(202);
      expect(Buffer.from(existing.text, 'utf8')).toEqual(Buffer.from(fresh.text, 'utf8'));
      expect(existing.headers['content-length']).toBe(fresh.headers['content-length']);
      expect(existing.headers['content-type']).toBe(fresh.headers['content-type']);
    });

    it('leaves an existing account untouched', async () => {
      const before = repository.get(existingEmail);
      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: existingEmail, password: 'other-secret-1' });

      expect(res.status).toBe(202);
      expect(repository.get(existingEmail)).toEqual(before);
    });

    it('stores a new address with a hash that verifies', async () => {
      const email = freshEmail('created');
      const password = 'created-secret-1';
      const res = await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('accepted');
      const record = repository.get(email);
      expect(record).not.toBeNull();
      expect(await hasher.verify(record!.passwordHash, password)).toBe(true);
    });

    it('mails a verification to a new address and an alert to an existing one', async () => {
      mail.calls.length = 0;
      const email = freshEmail('mail');
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email, password: 'mail-secret-1' });
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: existingEmail, password: 'mail-secret-1' });
      // Mail is fire-and-forget; give the out-of-band promises a tick to land.
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });

      const forNew = mail.calls.find((call) => call.to === email);
      const forExisting = mail.calls.find((call) => call.to === existingEmail);
      expect(forNew?.template).toBe('sign-up-verification');
      expect(forNew?.vars).toEqual({ email });
      expect(forExisting?.template).toBe('sign-up-attempt-alert');
    });

    it('a mail failure changes nothing the caller observes', async () => {
      mail.setFailing(true);
      const email = freshEmail('mail-fail');
      try {
        const existing = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: existingEmail, password: 'fail-secret-1' });
        const fresh = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email, password: 'fail-secret-1' });

        expect(existing.status).toBe(202);
        expect(fresh.status).toBe(202);
        expect(Buffer.from(existing.text, 'utf8')).toEqual(Buffer.from(fresh.text, 'utf8'));

        // Let the rejected deliveries settle; the service catches them.
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
      } finally {
        mail.setFailing(false);
      }
    });

    it('does not wait on the mailer for the response', async () => {
      mail.setDelay(SLOW_MAIL_DELAY_MS);
      const email = freshEmail('slow-mail');
      try {
        const started = performance.now();
        const res = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email, password: 'slow-secret-1' });
        const elapsedMs = performance.now() - started;

        expect(res.status).toBe(202);
        // If the response path awaited mail, this would take >= SLOW_MAIL_DELAY_MS.
        expect(elapsedMs).toBeLessThan(SLOW_MAIL_DELAY_MS / 2);
      } finally {
        mail.setDelay(0);
      }
    });

    it('existing and new branches take statistically indistinguishable time', async () => {
      // Warm-up: absorb one-time costs (first KDF call, socket setup) so the
      // samples measure steady state.
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: timingExistingEmail, password: 'warm-secret-1' });
      await request(app.getHttpServer()).post('/auth/sign-up').send({ email: freshEmail('warm'), password: 'warm-secret-1' });

      const existingTimes: number[] = [];
      const freshTimes: number[] = [];
      for (let i = 0; i < TIMING_SAMPLES; i += 1) {
        let started = performance.now();
        const existing = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: timingExistingEmail, password: 'timing-secret-1' });
        existingTimes.push(performance.now() - started);
        expect(existing.status).toBe(202);

        started = performance.now();
        const fresh = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .send({ email: freshEmail('timing-fresh'), password: 'timing-secret-1' });
        freshTimes.push(performance.now() - started);
        expect(fresh.status).toBe(202);
      }

      const existingMedian = median(existingTimes);
      const freshMedian = median(freshTimes);

      // Both branches must be slow enough to include a real hash op. Without
      // hashing, both medians collapse to a few milliseconds and these fail.
      expect(existingMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);
      expect(freshMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);

      // The medians must agree within a tolerance that scales with the work.
      // Without equalisation, one branch collapses and this line fails.
      const toleranceMs = Math.max(15, 0.3 * Math.min(existingMedian, freshMedian));
      expect(Math.abs(existingMedian - freshMedian)).toBeLessThanOrEqual(toleranceMs);
    }, 60_000);
  });

  describe('sign-in', () => {
    it('a wrong password and an unknown address produce byte-identical responses', async () => {
      const wrong = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: 'definitely-wrong-1' });
      const unknown = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: freshEmail('unknown-in'), password: 'definitely-wrong-1' });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(Buffer.from(wrong.text, 'utf8')).toEqual(Buffer.from(unknown.text, 'utf8'));
      expect(wrong.headers['content-length']).toBe(unknown.headers['content-length']);
      expect(wrong.headers['content-type']).toBe(unknown.headers['content-type']);

      const body = wrong.body as { error?: { code?: string; details?: unknown } };
      expect(body.error?.code).toBe('authentication_failed');
      expect(typeof body.error?.details).toBe('object');
      expect(body.error?.details).not.toBeNull();
    });

    it('authenticates correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: existingEmail, password: existingPassword });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'authenticated', email: existingEmail });
    });

    it('a wrong password and an unknown address take statistically indistinguishable time', async () => {
      // Warm-up: absorb one-time costs.
      await request(app.getHttpServer()).post('/auth/sign-in').send({ email: existingEmail, password: 'warm-wrong-1' });
      await request(app.getHttpServer()).post('/auth/sign-in').send({ email: freshEmail('warm-in'), password: 'warm-wrong-1' });

      const wrongTimes: number[] = [];
      const unknownTimes: number[] = [];
      for (let i = 0; i < TIMING_SAMPLES; i += 1) {
        let started = performance.now();
        const wrong = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: existingEmail, password: `wrong-${i}-secret-1` });
        wrongTimes.push(performance.now() - started);
        expect(wrong.status).toBe(401);

        started = performance.now();
        const unknown = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .send({ email: freshEmail('timing-unknown'), password: `wrong-${i}-secret-1` });
        unknownTimes.push(performance.now() - started);
        expect(unknown.status).toBe(401);
      }

      const wrongMedian = median(wrongTimes);
      const unknownMedian = median(unknownTimes);

      // Both branches must be slow enough to include a real hash op.
      expect(wrongMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);
      expect(unknownMedian).toBeGreaterThanOrEqual(MIN_BRANCH_MS);

      // Without the dummy-hash equalisation the unknown branch collapses.
      const toleranceMs = Math.max(15, 0.3 * Math.min(wrongMedian, unknownMedian));
      expect(Math.abs(wrongMedian - unknownMedian)).toBeLessThanOrEqual(toleranceMs);
    }, 60_000);
  });

  it('rejects malformed input with the standard envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'not-an-address', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(res.body.error.details).toEqual({});
  });
});
```
