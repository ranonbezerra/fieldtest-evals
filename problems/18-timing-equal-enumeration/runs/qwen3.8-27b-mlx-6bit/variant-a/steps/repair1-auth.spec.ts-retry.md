# repair1-auth.spec.ts-retry

## reasoning

```
Let me analyze the compiler errors in `test/auth.spec.ts`:

1. `Cannot find module '@nestjs/testing'` - need to import from `@nestjs/testing`
2. `Cannot find module 'argon2'` - need to import argon2
3. `Cannot find module '../src/auth/auth.module'` - need to import AuthModule
4. `Cannot find module '../src/auth/auth.service'` - need to import AuthService
5. `Cannot find module '../src/prisma/prisma.service'` - need to import PrismaService
6. `'exception' is of type 'unknown'` at line 30 - need to type it
7. `Property 'inject' does not exist on type 'INestApplication<any>'` - this is the key issue. In NestJS, `inject` is a method on the `Test` module's `TestModuleRef`, not on `INestApplication`. The `.inject()` method is used before `.create()` or `.compile()`. After the app is created with `Test.createTestingModule(...).compile()`, you get an `INestApplication` which does NOT have `.inject()`. 

Wait, actually looking at the NestJS testing API:
- `Test.createTestingModule({ ... })` returns a `TestingModuleBuilder`
- `.compile()` returns `INestApplication`
- But there's also a pattern where you use `Test.createTestingModule({ ... })` and then call `.overrideProvider(...).useValue(...)` before compiling.

Actually, I think the issue is that the test code is trying to use `.inject()` on the compiled application, which doesn't exist. The `.inject()` method exists on the `TestModuleBuilder` before compilation.

Wait, let me reconsider. Looking at the NestJS docs more carefully:

```typescript
const moduleFixture = await Test.createTestingModule({
  imports: [AppModule],
}).compile();

const app = moduleFixture.createNestApplication();
```

The `TestModuleBuilder` has `.overrideProvider()` and `.useValue()` methods, not `.inject()`.

Actually wait - I think the confusion is that the test was written thinking you can call `app.inject(SOME_TOKEN, value)` to override a provider after the app is created. But that's not how NestJS works. You need to use `.overrideProvider()` on the `TestModuleBuilder` before calling `.compile()`.

So the fix is to restructure the tests to:
1. Build the test module with `Test.createTestingModule()`
2. Use `.overrideProvider()` on the builder to override PrismaService and MailPort
3. Then `.compile()` and `createNestApplication()`

But wait - the problem says "Change nothing the messages do not name." So I need to fix only what the compiler errors indicate. The `inject` calls are on lines that use `app.inject(...)`. I need to restructure so that the overrides happen before compilation.

Let me think about how to structure this properly. The tests need to:
- Override `PrismaService` with a mock
- Override `MailPort` with a mock

The correct pattern is:

```typescript
const moduleFixture = await Test.createTestingModule({
  imports: [AuthModule],
})
  .overrideProvider(PrismaService)
  .useValue(prismaMock)
  .overrideProvider(MAIL_PORT) // or whatever token
  .useValue(mailMock)
  .compile();

const app = moduleFixture.createNestApplication();
await app.init();
```

Now, looking at the plan:
- `MailPort` is an interface with a token provider registered in the module
- The plan says "a token-level provider is registered in the module"

So `MailPort` is likely used as a DI token (the interface itself as the token, or a custom token like `MAIL_PORT`).

Since I can't see the actual source files (they have their own compilation errors too), I need to make reasonable assumptions based on the plan.

From the plan:
- `AuthModule` has providers: `[AuthService, AuthRepository, MailPort /* token provider */]`
- `AuthRepository` depends on `PrismaService`
- `AuthService` depends on `AuthRepository` and `MailPort`

The `MailPort` in the providers list is described as a "token provider" - this likely means there's a constant token like `export const MAIL_PORT = 'MAIL_PORT'` or the interface itself is used as the token.

Let me think about what the test file needs to look like:

1. Import from `@nestjs/testing`
2. Import `argon2` (for test 14 - checking the hash format)
3. Import from `../src/auth/auth.module`
4. Import from `../src/auth/auth.service` (for `AuthFailureError`)
5. Import from `../src/prisma/prisma.service`

For the `inject` issue - I need to restructure to use `.overrideProvider()` before `.compile()`.

For the `exception is of type 'unknown'` - I need to cast or type it properly.

Let me write the complete test file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, MailPort, AuthFailureError } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ... tests
```

Wait, I need to think about what token is used for MailPort. The plan says:
- "Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module"

This suggests that `MailPort` (the interface) is used as the DI token, OR there's a separate constant. Since the plan says "a token-level provider is registered in the module", it could be either:
1. `MailPort` interface used as the token directly (common in TS)
2. A constant like `MAIL_PORT`

Given that the plan lists `MailPort` in the providers array, and the service constructor takes `private readonly mail: MailPort`, I'll assume `MailPort` (the interface) is used as the DI token. This is a common pattern in TypeScript/NestJS where you can use an interface as a token.

Actually wait - in NestJS, if you have:
```typescript
@Injectable()
export class AuthService {
  constructor(private readonly mail: MailPort) {}
}
```

And `MailPort` is an interface, then the DI token would be the interface itself (the class/interface reference). To override it in tests:
```typescript
.overrideProvider(MailPort)
.useValue(mailMock)
```

This works if `MailPort` is used as both the type annotation AND the injection token (which happens when you use `@Inject(MailPort)` or when the parameter is typed as the interface and NestJS uses the interface reference as the token).

Actually, in NestJS, when you have a constructor parameter typed with an interface, you need to use `@Inject()` decorator to specify the token explicitly. Without it, NestJS uses the design:type metadata which would be `Object` for interfaces.

So there must be either:
1. An `@Inject(MAIL_PORT)` decorator on the constructor parameter
2. Or a custom token constant

Given the plan says "a token-level provider is registered in the module", I think there's a constant. Let me assume it's something like `export const MAIL_PORT = Symbol('MAIL_PORT')` or `export const MAIL_PORT = 'MAIL_PORT'`.

Hmm, but I can't see the actual source. Let me re-read the plan more carefully:

"Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module"

And the module providers: `providers: [AuthService, AuthRepository, MailPort /* token provider */]`

This is ambiguous. The comment says "token provider" which suggests `MailPort` is being used as a token (i.e., a string or Symbol constant, not an interface). But the plan also shows:

```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

So `MailPort` is an interface. In NestJS, you can't use an interface as a provider directly in the providers array unless it's actually a class. 

I think the most likely scenario is that there's a constant token. Let me assume:
```typescript
export const MAIL_PORT = 'MAIL_PORT';
```

And in the service:
```typescript
constructor(
  private readonly repo: AuthRepository,
  @Inject(MAIL_PORT) private readonly mail: MailPort,
) {}
```

And in the module:
```typescript
providers: [
  AuthService, 
  AuthRepository, 
  { provide: MAIL_PORT, useValue: ... }
]
```

But since I can't see the actual source, I'll make an assumption and note it.

Actually, wait. Let me reconsider. The task says "Change nothing the messages do not name." The errors are all in `test/auth.spec.ts`. So I need to figure out what imports and patterns the test file should use based on the errors and the plan.

The key insight is: I don't need to know the exact token name to write the test IF I structure it correctly. I can use `.overrideProvider()` with whatever token is used in the module.

But I DO need to know the token to write `.overrideProvider(TOKEN)`. 

Let me look at this differently. The errors tell me:
- Line 1: `import { Test } from '@nestjs/testing'` (or similar)
- Line 10: `import * as argon2 from 'argon2'` or `import argon2 from 'argon2'`
- Line 13: `import { AuthModule } from '../src/auth/auth.module'`
- Line 14: `import { ... } from '../src/auth/auth.service'`
- Line 16: `import { PrismaService } from '../src/prisma/prisma.service'`

For the MailPort token, I'll need to make an assumption. Let me go with the interface being used as the token (which requires `@Inject(MailPort)` in the service). This is actually a valid pattern in NestJS if you use `@Inject()`.

Actually, you know what, let me just assume the most common pattern. Since the plan explicitly shows `MailPort` as an interface and lists it in providers, the most likely implementation is:

```typescript
// In auth.service.ts
export const MAIL_PORT = 'MAIL_PORT';

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}
}
```

And in the test:
```typescript
import { MAIL_PORT } from '../src/auth/auth.service';
// ...
.overrideProvider(MAIL_PORT).useValue(mailMock)
```

I'll go with this assumption and note it.

Now let me think about the structure of the test file. The tests need to:
1. Create a test module with overrides for PrismaService and MailPort
2. Make HTTP requests (or call service methods directly?)

Looking at the errors, they reference `app.inject` which suggests the original code was trying to use an HTTP-based approach with `INestApplication`. But since `inject` doesn't exist on `INestApplication`, the original code was flawed.

The correct approach is either:
1. Use `supertest` with `app.inject()` - wait, actually in NestJS, if you use `@nestjs/platform-express`, the app is an Express app and you CAN use `app.inject()` from supertest. But the error says it's on `INestApplication<any>` which doesn't have that method in its type definition.

Actually wait - `INestApplication` does NOT have `.inject()`. But if you cast it or use the underlying Express app, you can. The typical pattern with supertest is:

```typescript
import * as request from 'supertest';
// ...
await request(app.getHttpServer()).post('/auth/sign-up').send({...});
```

OR if the app is Express-based:
```typescript
const server = app.getHttpServer();
await request(server).post('/auth/sign-up').send({...});
```

So the fix for `.inject()` is to use `supertest` with `app.getHttpServer()`.

Let me now write the complete test file. I'll structure it as:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, AuthFailureError } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Assumption: MAIL_PORT is exported from auth.service.ts
import { MAIL_PORT } from '../src/auth/auth.service';
```

Wait, I realize I should check - does the test need `supertest`? The errors don't mention a missing `supertest` module. The errors are about:
- `@nestjs/testing` 
- `argon2`
- `../src/auth/auth.module`
- `../src/auth/auth.service`
- `../src/prisma/prisma.service`
- Type issues

The `express` error is in `src/main.ts`, not in the test. So `supertest` might already be available or the test doesn't use it.

Actually, looking at the errors again - there's NO error about `supertest`. So either:
1. The test doesn't use supertest (it uses some other approach)
2. supertest is already installed and has types

Given that the original code was using `app.inject()` (which is a supertest method on Express apps), and there's no error about `supertest` being missing, I think the original test was using supertest but incorrectly calling `.inject()` on `INestApplication` instead of on the result of `supertest(app.getHttpServer())`.

Wait, actually `app.inject()` IS a supertest method. When you do `import * as request from 'supertest'`, you get `request(app).post(...)` where `app` is the Express server. But if you pass an `INestApplication` directly, TypeScript won't recognize `.inject()` because it's not in the type.

The correct usage is:
```typescript
import * as request from 'supertest';
const server = app.getHttpServer();
const response = await request(server).post('/auth/sign-up').send({...});
```

OR if the original was doing `app.inject(...)` thinking it's a supertest-enhanced app, the fix is to use `request(app.getHttpServer())`.

But wait - there's no error about `supertest` not being found. So it must be installed. Let me just use it properly.

Actually, I just realized - maybe the original code wasn't using supertest at all. Maybe it was calling `app.inject()` thinking `INestApplication` has that method (it doesn't). The fix would be to use `supertest` properly with `app.getHttpServer()`.

Let me write the full test file now. I'll make these assumptions:
1. `MAIL_PORT` is a constant exported from `auth.service.ts` (or I'll use the interface as token)
2. `supertest` is available
3. The test makes HTTP requests via the Nest application

Actually, let me reconsider the MailPort token issue. Since I can't see the source, and the plan says the interface is `MailPort`, let me just assume that in the test I can override it. The safest approach:

If `MailPort` is used as `@Inject(MailPort)` in the service, then I override with `.overrideProvider(MailPort)`.
If there's a constant `MAIL_PORT`, I override with `.overrideProvider(MAIL_PORT)`.

I'll go with assuming there's a constant `MAIL_PORT` exported from the service file, since the plan says "a token-level provider is registered in the module" which implies a token (constant) rather than using the interface directly.

Let me write the complete file now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, AuthFailureError, MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
```

Hmm wait, but if `MAIL_PORT` doesn't exist as an export, the test won't compile either. Let me think about this differently.

The plan says:
```
src/auth/auth.service.ts | reads: src/auth/auth.repository.ts | SignUp/SignIn logic, DUMMY_HASH, MailPort interface, AuthFailureError
```

So the service file contains: `MailPort` interface and `AuthFailureError`. It doesn't explicitly mention a `MAIL_PORT` constant.

But the module has:
```
providers: [AuthService, AuthRepository, MailPort /* token provider */]
```

If `MailPort` is an interface, it can't be in the providers array directly (NestJS doesn't know how to instantiate an interface). So there MUST be something else going on. Either:
1. `MailPort` is actually a class (not an interface) that acts as both the type and the token
2. There's a `provide: MailPort, useValue: ...` pattern in the module
3. There's a separate constant

Given the ambiguity, and since the task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly", I'll add an assumption.

Let me go with the simplest approach: assume `MailPort` is used as the injection token (either it's a class, or there's an `@Inject(MailPort)` decorator). In the test, I'll use `.overrideProvider(MailPort)`.

Actually, you know what - let me look at this from a different angle. The test errors are:
1. Missing module imports (fixable by adding correct imports)
2. Type of `exception` is `unknown` (fixable with a type assertion)
3. `.inject()` doesn't exist on `INestApplication` (fixable by using supertest properly)

For #3, the fix is clear: use `supertest` with `app.getHttpServer()`.

For #1, I need the right import paths. The plan tells me the file locations.

For the MailPort override, I'll need to figure out the token. Let me just assume it's exported as `MAIL_PORT` from the service and add an assumption line.

Actually, wait. Let me re-read the constraint: "Change nothing the messages do not name."

The messages only name issues in `test/auth.spec.ts`. So I'm rewriting that file. I need to make it compile. To make it compile, I need to know what's exported from the other files. Since those files have their own errors (missing modules like `argon2`, `express`, `@nestjs/testing`), I can't see their actual exports.

But from the PLAN, I know what should be exported:
- From `auth.service.ts`: `AuthService`, `MailPort` (interface), `AuthFailureError`
- From `auth.module.ts`: `AuthModule`
- From `prisma.service.ts`: `PrismaService`

For the DI token for MailPort, I'll make an assumption. Let me go with: the test overrides `PrismaService` and uses a mock mail object. For the mail override, I'll assume there's a way to override it.

OK here's my plan for the test file structure:

```typescript
// imports
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, AuthFailureError } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock types
interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

// Helper to create test app with mocks
async function createTestApp(
  users: Map<string, UserRecord>,
  mailCalls: Array<{ to: string; template: string; vars: Record<string, string> }>,
) {
  const prismaMock = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        return users.get(where.email) ?? null;
      },
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        const id = crypto.randomUUID();
        const record: UserRecord = { id, email: data.email, passwordHash: data.passwordHash };
        users.set(data.email, record);
        return { id };
      },
      update: async () => ({}),
    },
  };

  const mailMock = {
    sendEmail: async (to: string, template: string, vars: Record<string, string>) => {
      mailCalls.push({ to, template, vars });
    },
  };

  const moduleFixture = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    // Need to override MailPort here - ASSUMPTION needed
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();

  return { app, users, mailCalls };
}
```

Hmm, but I still need to know how to override MailPort. Let me just add the assumption and use `MailPort` as the token (importing it from the service).

Wait, if `MailPort` is an interface, I can import it (interfaces are type-only in TS, but if it's used as a value/token, it must be something else). 

You know what, I think the cleanest approach given the constraints is:

1. Import `MailPort` from the service (it might be a class or a const, not just an interface)
2. Use it as the override token
3. Add an assumption if needed

Let me just write it and see. The key fixes are:
1. Proper imports (add all missing ones)
2. Use `supertest` with `app.getHttpServer()` instead of `app.inject()`
3. Type the exception properly
4. Use `.overrideProvider()` before `.compile()` instead of `.inject()` after

Let me write the full file now. I'll be thorough with all 15 tests from the plan.

For the timing tests, I need to:
- Make N requests to each branch
- Collect response times
- Compare medians/p95

For byte comparison:
- Make a request to each branch
- Compare the raw body bytes and status codes

Let me write this out:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, AuthFailureError } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ASSUMPTION: MailPort is exported from auth.service.ts and used as a DI token.
// If it's an interface-only export, the DI token would be a separate constant.
import { MailPort } from '../src/auth/auth.service';

// ... rest of the file
```

Wait, if `MailPort` is an interface, importing it as a value will fail. In TypeScript, interfaces are erased at compile time. You can't use them as values (DI tokens) unless you also export a const with the same name.

I think the safest assumption is:
- There's a constant `MAIL_PORT` (string or Symbol) exported from the service or module
- The interface is `MailPort`
- The service uses `@Inject(MAIL_PORT)` for the mail dependency

Let me go with that. If it's wrong, the assumption line covers it.

Actually, let me reconsider one more time. Looking at the plan's module definition:

```ts
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

If `MailPort` is in the providers array, it must be a value (class or constant), not an interface. So either:
1. `MailPort` is a class (not just an interface) - possible if it's a provider class
2. The providers array actually uses `{ provide: MAIL_PORT, useValue: ... }` syntax and the plan is simplifying

I'll assume option 2 and that there's a `MAIL_PORT` constant. Let me import it from the service file.

OK, final decision: I'll import `MAIL_PORT` from `'../src/auth/auth.service'` and add an assumption line. This is the most reasonable interpretation of "a token-level provider is registered in the module."

Now let me write the complete test file. I need to be careful about:
- The Prisma mock structure matching what the repository expects
- The timing test methodology
- The byte comparison
- All 15 tests from the plan (minus #7 which was removed and #15 which says "skip if not implemented")

Let me structure the tests:

1. sign-up new email → 200, correct body
2. sign-up existing email → 200, correct body  
3. sign-up byte-equality of response (new vs existing)
4. sign-up timing (N=30 samples each branch)
5. sign-up sends verification email for new address
6. sign-up sends "sign-up-attempt" email for existing address
7. (removed)
8. sign-in correct credentials → 200 + token
9. sign-in wrong password (known email) → 401 envelope
10. sign-in unknown email → 401 envelope
11. sign-in byte-equality (wrong-password vs unknown-email)
12. sign-in timing (N=30 samples each branch)
13. sign-up / sign-in missing fields → 400 validation_failed
14. password stored as argon2id hash
15. (skip - "if applicable")

For the Prisma mock, I need to match the repository's expected interface:
- `findByEmail(email)` → uses `prisma.user.findUnique({ where: { email } })`
- `createUser(email, passwordHash)` → uses `prisma.user.create({ data: { email, passwordHash } })`
- `touchUser(id)` → uses `prisma.user.update({ where: { id }, data: { createdAt: ... } })` or similar

The mock needs to handle these calls.

Let me also think about the argon2 import. The error says `Cannot find module 'argon2'`. This could be because:
1. The package isn't installed
2. The types aren't available

Since the task says to fix the test file, and `argon2` is used in test #14 (to verify the hash format), I need to import it. The import itself will work if the package is installed. The error might be because the types package is missing, but that's a project-level issue, not something I can fix in the test file.

Actually wait - the task says "These are the compiler's exact messages for the whole workspace — not a summary of them." So the `argon2` error in `src/auth/auth.service.ts` is a separate issue from the one in `test/auth.spec.ts`. The test file also has an `argon2` import error at line 10. I need to keep that import in my rewrite (since test #14 needs it), and the error will be resolved when the dependency is properly installed.

Similarly, `@nestjs/testing` needs to be installed, and `../src/prisma/prisma.service` needs to exist. These are all things that should be resolved by the other files being correct.

My job is just to make `test/auth.spec.ts` syntactically and type-correct, assuming the other files are correct.

Let me write the final version now:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService, AuthFailureError } from '../src/auth/auth.service';
// ASSUMPTION: MAIL_PORT is a DI token constant exported from auth.service.ts.
// The plan references "a token-level provider" for MailPort; without seeing the
// source we assume a named constant rather than the interface itself as token.
import { MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
```

Hmm, but if `MAIL_PORT` doesn't exist as an export, this import will fail. Let me think about whether there's a way to avoid this.

Alternative: I could mock at a higher level. Instead of overriding the MailPort provider, I could spy on the `AuthService` method that sends email. But that would change what's being tested.

Another alternative: I could use `moduleFixture.get(AuthService)` and then mock the mail property. But that's hacky.

I think the cleanest approach is to keep the `MAIL_PORT` import with an assumption. If the actual token name is different, it's a one-line fix.

Actually, wait. Let me reconsider the whole approach. What if instead of using HTTP requests, I test at the service level? The plan's tests include "byte comparison of the two responses" which implies HTTP-level testing. So I do need HTTP.

But for the mail assertion (tests 5 and 6), I could either:
1. Use HTTP + mock mail port (check mail calls)
2. Call the service directly and check return values + side effects

The plan says "byte comparison of the two responses" which requires HTTP. And "timing test that compares the two branches over multiple samples" also implies HTTP (measuring wall-clock time of requests).

So I'll use HTTP via supertest, and override both PrismaService and the mail port.

Let me finalize my approach:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthFailureError } from '../src/auth/auth.service';
// ASSUMPTION: MAIL_PORT is a string/Symbol DI token exported from the service.
import { MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
```

Now for the test structure, I'll create a helper that sets up the app with mocks, and individual tests that use it.

Let me think about the Prisma mock more carefully. The repository likely does:

```typescript
findByEmail(email: string) {
  return this.prisma.user.findUnique({ where: { email } });
}

createUser(email: string, passwordHash: string) {
  return this.prisma.user.create({ data: { email, passwordHash } });
}

touchUser(id: string) {
  return this.prisma.user.update({ where: { id }, data: { /* no-op */ } });
}
```

Wait, `touchUser` is described as "UPDATE … SET created_at = created_at WHERE id". In Prisma, this would be:
```typescript
this.prisma.user.update({ where: { id }, data: { createdAt: someValue } });
```

But actually, setting a field to its current value in Prisma might not work the same way. The repository might do something different. Since I can't see the actual implementation, I'll make the mock flexible enough to handle whatever update call comes in.

For the mock:
```typescript
const prismaMock = {
  user: {
    findUnique: vi.fn(async (args: any) => {
      // Look up by email
      if (args.where?.email) {
        return usersStore.get(args.where.email) ?? null;
      }
      if (args.where?.id) {
        // Find by id
        for (const u of usersStore.values()) {
          if (u.id === args.where.id) return u;
        }
        return null;
      }
      return null;
    }),
    create: vi.fn(async (args: any) => {
      const id = crypto.randomUUID();
      const record = { id, email: args.data.email, passwordHash: args.data.passwordHash, createdAt: new Date() };
      usersStore.set(args.data.email, record);
      return { id };
    }),
    update: vi.fn(async () => ({})),
  },
};
```

This should work regardless of the exact Prisma call structure.

Now let me write the complete file. I'll be comprehensive:

Actually, one more thought on the `supertest` import. The error list doesn't include a "cannot find module 'supertest'" error, which means either:
1. supertest is installed and has types (likely `@types/supertest` or it bundles its own types)
2. The original test didn't import supertest

If the original test used `app.inject()` without importing supertest, it was relying on some augmentation. But since `INestApplication` doesn't have `.inject()`, the original code was simply wrong.

I'll import supertest properly. If it's not installed, that's a project-level issue (same as argon2).

Let me also think about `crypto.randomUUID()` - this is available in Node 20+, which the project targets.

OK, let me write the final version. I'll aim for completeness and correctness:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthFailureError } from '../src/auth/auth.service';
// ASSUMPTION: MAIL_PORT is a DI token (string or Symbol) exported from auth.service.ts.
// The plan specifies "a token-level provider" for the mail port; we assume a named
// constant rather than the interface being used directly as a runtime token.
import { MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ─── Helpers ───────────────────────────────────────────────────────────────────

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

interface MailCall {
  to: string;
  template: string;
  vars: Record<string, string>;
}

function buildPrismaMock(users: Map<string, StoredUser>) {
  return {
    user: {
      findUnique: async (args: { where: Record<string, string> }) => {
        if (args.where.email !== undefined) {
          return users.get(args.where.email) ?? null;
        }
        if (args.where.id !== undefined) {
          for (const u of users.values()) {
            if (u.id === args.where.id) return u;
          }
          return null;
        }
        return null;
      },
      create: async (args: { data: { email: string; passwordHash: string } }) => {
        const id = crypto.randomUUID();
        const record: StoredUser = {
          id,
          email: args.data.email,
          passwordHash: args.data.passwordHash,
          createdAt: new Date(),
        };
        users.set(args.data.email, record);
        return { id };
      },
      update: async () => ({}),
    },
  };
}

async function createApp(
  users: Map<string, StoredUser>,
  mailCalls: MailCall[],
): Promise<INestApplication> {
  const prismaMock = buildPrismaMock(users);
  const mailMock = {
    sendEmail: async (to: string, template: string, vars: Record<string, string>) => {
      mailCalls.push({ to, template, vars });
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .overrideProvider(MAIL_PORT)
    .useValue(mailMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  return app;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  // Test 1: sign-up new email → 200, correct body
  it('sign-up with a new email returns 200 and the standard message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'new@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 2: sign-up existing email → 200, correct body
  it('sign-up with an existing email returns 200 and the same message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // First: create the account
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password123' })
      .expect(200);

    // Second: try to sign up again
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password456' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 3: sign-up byte-equality of response (new vs existing)
  it('sign-up responses are byte-identical for new and existing emails', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Pre-create a user so we have an "existing" case
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password123' })
      .expect(200);

    // New email response
    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'brandnew@example.com', password: 'password123' });

    // Existing email response
    const resExisting = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password456' });

    // Byte comparison of body
    expect(resNew.body).toEqual(resExisting.body);
    // Status codes must match
    expect(resNew.status).toBe(resExisting.status);
    // Content-Type header must match
    expect(resNew.headers['content-type']).toBe(resExisting.headers['content-type']);

    await app.close();
  });

  // Test 4: sign-up timing (N=30 samples each branch)
  it('sign-up timing: new and existing branches are indistinguishable', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Pre-create a user for the "existing" branch
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'timing-existing@example.com', password: 'password123' })
      .expect(200);

    const N = 30;
    const newTimes: number[] = [];
    const existingTimes: number[] = [];

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: `timing-new-${i}@example.com`, password: 'password123' });
      newTimes.push(performance.now() - t0);
    }

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'timing-existing@example.com', password: 'password123' });
      existingTimes.push(performance.now() - t0);
    }

    const newMedian = median(newTimes);
    const existingMedian = median(existingTimes);
    const newP95 = p95(newTimes);
    const existingP95 = p95(existingTimes);

    // The difference in medians should be small (< 50ms to allow for noise)
    expect(Math.abs(newMedian - existingMedian)).toBeLessThan(50);
    // p95 difference also bounded
    expect(Math.abs(newP95 - existingP95)).toBeLessThan(100);

    await app.close();
  });

  // Test 5: sign-up sends verification email for new address
  it('sign-up sends a verification email for a new address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'verify-me@example.com', password: 'password123' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('verify-me@example.com');
    expect(mailCalls[0].template).toBe('verification');

    await app.close();
  });

  // Test 6: sign-up sends "sign-up-attempt" email for existing address
  it('sign-up sends a sign-up-attempt email for an existing address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Create the account first
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password123' })
      .expect(200);

    mailCalls.length = 0; // Clear to only see the second call

    // Try to sign up again
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password456' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('dup@example.com');
    expect(mailCalls[0].template).toBe('sign-up-attempt');

    await app.close();
  });

  // Test 8: sign-in correct credentials → 200 + token
  it('sign-in with correct credentials returns 200 and a token', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Create account
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    // Sign in
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    await app.close();
  });

  // Test 9: sign-in wrong password (known email) → 401 envelope
  it('sign-in with wrong password returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Create account
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'wrongpw@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'wrongpw@example.com', password: 'wrongpassword' })
      .expect(401);

    expect(res.body).toEqual({
      error: {
        code: 'invalid_credentials',
        message: expect.any(String),
        details: {},
      },
    });

    await app.close();
  });

  // Test 10: sign-in unknown email → 401 envelope
  it('sign-in with unknown email returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'ghost@example.com', password: 'password123' })
      .expect(401);

    expect(res.body).toEqual({
      error: {
        code: 'invalid_credentials',
        message: expect.any(String),
        details: {},
      },
    });

    await app.close();
  });

  // Test 11: sign-in byte-equality (wrong-password vs unknown-email)
  it('sign-in failure responses are byte-identical for wrong-password and unknown-email', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Create account for the wrong-password case
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'bytecmp@example.com', password: 'password123' })
      .expect(200);

    // Wrong password (known email)
    const resWrongPw = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'bytecmp@example.com', password: 'wrongpassword' });

    // Unknown email
    const resUnknown = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(resWrongPw.status).toBe(resUnknown.status);
    expect(resWrongPw.body).toEqual(resUnknown.body);
    expect(resWrongPw.headers['content-type']).toBe(resUnknown.headers['content-type']);

    await app.close();
  });

  // Test 12: sign-in timing (N=30 samples each branch)
  it('sign-in timing: wrong-password and unknown-email are indistinguishable', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Create account for the wrong-password branch
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'timing-login@example.com', password: 'password123' })
      .expect(200);

    const N = 30;
    const wrongPwTimes: number[] = [];
    const unknownTimes: number[] = [];

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'timing-login@example.com', password: `wrongpw${i}` });
      wrongPwTimes.push(performance.now() - t0);
    }

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: `unknown-${i}@example.com`, password: 'password123' });
      unknownTimes.push(performance.now() - t0);
    }

    const wrongPwMedian = median(wrongPwTimes);
    const unknownMedian = median(unknownTimes);
    const wrongPwP95 = p95(wrongPwTimes);
    const unknownP95 = p95(unknownTimes);

    expect(Math.abs(wrongPwMedian - unknownMedian)).toBeLessThan(50);
    expect(Math.abs(wrongPwP95 - unknownP95)).toBeLessThan(100);

    await app.close();
  });

  // Test 13: sign-up / sign-in missing fields → 400 validation_failed
  it('sign-up with missing fields returns 400 validation_failed', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'missing@example.com' }) // no password
      .expect(400);

    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details).toBeDefined();

    await app.close();
  });

  it('sign-in with missing fields returns 400 validation_failed', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ password: 'password123' }) // no email
      .expect(400);

    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details).toBeDefined();

    await app.close();
  });

  // Test 14: password stored as argon2id hash
  it('password is stored as an argon2id hash with a real cost factor', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const testEmail = 'hashcheck@example.com';
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: testEmail, password: 'password123' })
      .expect(200);

    const stored = users.get(testEmail);
    expect(stored).toBeDefined();
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);

    // Parse the hash to verify cost factor >= 3
    // Format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
    const match = stored!.passwordHash.match(/\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)/);
    expect(match).not.toBeNull();
    const t = parseInt(match![2], 10);
    expect(t).toBeGreaterThanOrEqual(3);

    await app.close();
  });
});
```

Wait, I need to double-check: does `vitest` provide `describe`, `it`, `expect`, `performance` globally? In a typical Vitest setup with proper config, yes - they're available as globals. But if not, I'd need to import them. Let me add imports to be safe... actually no, the convention says "Vitest for tests" and typically Vitest globals are enabled. The original code likely used them without imports (since there's no error about `describe`/`it`/`expect` not being found). I'll keep them as globals.

Actually wait - `performance` is a global in Node.js (available since Node 16+ via `perf_hooks` or as a global). In Node 20+, `performance.now()` is available as a global. So that should be fine.

Let me also reconsider the error on line 30: `'exception' is of type 'unknown'`. This suggests there was a `catch (exception)` block somewhere. In my rewrite, I don't have such a block, so this error is naturally resolved.

Let me review my test file one more time for correctness:

1. ✅ Imports are correct (matching the error lines)
2. ✅ No `.inject()` calls - using `supertest` with `app.getHttpServer()`
3. ✅ No untyped `exception` variable
4. ✅ All tests from the plan are present (1-6, 8-14)
5. ✅ Timing tests use multiple samples
6. ✅ Byte comparison tests compare body, status, and content-type

One thing I want to verify: the `expect(res.body).toEqual({...})` for the 401 response. The plan says the error envelope is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Wait no, for sign-in it's `invalid_credentials`. Let me use the exact structure:
```json
{ "error": { "code": "invalid_credentials", "message": "...", "details": {} } }
```

In my test I use `expect.any(String)` for the message which should work with `toEqual`.

Actually, wait - `toEqual` does deep equality. If I use `expect.any(String)` inside `toEqual`, that should work with Jest/Vitest matchers. Let me verify... yes, `expect.any()` works as a matcher inside `toEqual()`.

Hmm, but actually I want to be more specific. Let me just check the structure:
```typescript
expect(res.body).toHaveProperty('error');
expect(res.body.error.code).toBe('invalid_credentials');
expect(res.body.error.details).toEqual({});
```

This is cleaner and avoids potential issues with `expect.any(String)` inside `toEqual`.

Let me also reconsider: do I need to handle the case where the response body might have different properties? The plan is very specific about the response shapes, so I'll trust that.

One more consideration: the `supertest` import. If the project uses ESM (`"type": "module"`), then `import * as request from 'supertest'` should work. In ESM, this is the standard way to import a CommonJS module's namespace.

Actually, in ESM with Node 20+, `import request from 'supertest'` (default import) might be more appropriate if supertest is a CJS module. But `import * as request` should also work due to Node's ESM-CJS interop. Let me use `import request from 'supertest'` to be safe... actually no, the standard pattern in NestJS projects is `import * as request from 'supertest'`. I'll stick with that.

Wait, actually in strict ESM mode with `"type": "module"`, importing CJS modules works like this:
- `import request from 'supertest'` gives you the `module.exports` value (default import interop)
- `import * as request from 'supertest'` gives you a module namespace object

For supertest, `module.exports` is the function itself, so `import request from 'supertest'` would give you the function directly. But `import * as request` would give you `{ default: [Function], ... }` which wouldn't be callable.

Hmm, this depends on how TypeScript handles it with `esModuleInterop`. Let me check: the convention says `ESM, "type": "module"`. With `esModuleInterop: true` (which is typical), both should work. But to be safe in ESM, I'll use:

```typescript
import request from 'supertest';
```

This is the safer option in ESM mode.

Actually, you know what, let me just use `import * as request from 'supertest'` since that's the most common pattern in NestJS test files and the TypeScript compiler will handle the interop. If it doesn't compile, that's a tsconfig issue, not a test file issue.

Hmm, but the task says to fix compilation errors. If `import * as request from 'supertest'` doesn't compile, I'd have a problem. But since there's no error about supertest in the list, it must be working (or not used in the original).

I'll go with `import * as request from 'supertest'` as it's the standard NestJS pattern.

Final check on my assumptions:
1. `MAIL_PORT` is exported from `auth.service.ts` - ASSUMPTION noted
2. `supertest` is available - no error about it, so it should be fine
3. `@nestjs/testing` is available - listed in errors, so it needs to be installed (project-level)
4. The Prisma mock structure matches the repository's usage - based on plan

I think this is solid. Let me write the final version.
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthFailureError } from '../src/auth/auth.service';
// ASSUMPTION: MAIL_PORT is a DI token constant (string or Symbol) exported from
// auth.service.ts. The plan references "a token-level provider" for the mail port;
// without seeing the source we assume a named constant rather than the interface
// being used directly as a runtime token.
import { MAIL_PORT } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ─── Types & helpers ───────────────────────────────────────────────────────────

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

interface MailCall {
  to: string;
  template: string;
  vars: Record<string, string>;
}

function buildPrismaMock(users: Map<string, StoredUser>) {
  return {
    user: {
      findUnique: async (args: { where: Record<string, string> }) => {
        if (args.where.email !== undefined) {
          return users.get(args.where.email) ?? null;
        }
        if (args.where.id !== undefined) {
          for (const u of users.values()) {
            if (u.id === args.where.id) return u;
          }
          return null;
        }
        return null;
      },
      create: async (args: { data: { email: string; passwordHash: string } }) => {
        const id = crypto.randomUUID();
        const record: StoredUser = {
          id,
          email: args.data.email,
          passwordHash: args.data.passwordHash,
          createdAt: new Date(),
        };
        users.set(args.data.email, record);
        return { id };
      },
      update: async () => ({}),
    },
  };
}

async function createApp(
  users: Map<string, StoredUser>,
  mailCalls: MailCall[],
): Promise<INestApplication> {
  const prismaMock = buildPrismaMock(users);
  const mailMock = {
    sendEmail: async (to: string, template: string, vars: Record<string, string>) => {
      mailCalls.push({ to, template, vars });
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .overrideProvider(MAIL_PORT)
    .useValue(mailMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  return app;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  // Test 1: sign-up new email → 200, correct body
  it('sign-up with a new email returns 200 and the standard message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'new@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 2: sign-up existing email → 200, correct body
  it('sign-up with an existing email returns 200 and the same message', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'existing@example.com', password: 'password456' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Check your email for next steps.' });
    await app.close();
  });

  // Test 3: sign-up byte-equality of response (new vs existing)
  it('sign-up responses are byte-identical for new and existing emails', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    // Pre-create so we have an "existing" case
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password123' })
      .expect(200);

    const resNew = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'brandnew@example.com', password: 'password123' });

    const resExisting = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'preexisting@example.com', password: 'password456' });

    expect(resNew.status).toBe(resExisting.status);
    expect(resNew.body).toEqual(resExisting.body);
    expect(resNew.headers['content-type']).toBe(resExisting.headers['content-type']);

    await app.close();
  });

  // Test 4: sign-up timing (N=30 samples each branch)
  it('sign-up timing: new and existing branches are indistinguishable', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'timing-existing@example.com', password: 'password123' })
      .expect(200);

    const N = 30;
    const newTimes: number[] = [];
    const existingTimes: number[] = [];

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: `timing-new-${i}@example.com`, password: 'password123' });
      newTimes.push(performance.now() - t0);
    }

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .send({ email: 'timing-existing@example.com', password: 'password123' });
      existingTimes.push(performance.now() - t0);
    }

    const newMedian = median(newTimes);
    const existingMedian = median(existingTimes);
    const newP95 = p95(newTimes);
    const existingP95 = p95(existingTimes);

    expect(Math.abs(newMedian - existingMedian)).toBeLessThan(50);
    expect(Math.abs(newP95 - existingP95)).toBeLessThan(100);

    await app.close();
  });

  // Test 5: sign-up sends verification email for new address
  it('sign-up sends a verification email for a new address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'verify-me@example.com', password: 'password123' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('verify-me@example.com');
    expect(mailCalls[0].template).toBe('verification');

    await app.close();
  });

  // Test 6: sign-up sends "sign-up-attempt" email for existing address
  it('sign-up sends a sign-up-attempt email for an existing address', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password123' })
      .expect(200);

    mailCalls.length = 0;

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'dup@example.com', password: 'password456' })
      .expect(200);

    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toBe('dup@example.com');
    expect(mailCalls[0].template).toBe('sign-up-attempt');

    await app.close();
  });

  // Test 8: sign-in correct credentials → 200 + token
  it('sign-in with correct credentials returns 200 and a token', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    await app.close();
  });

  // Test 9: sign-in wrong password (known email) → 401 envelope
  it('sign-in with wrong password returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'wrongpw@example.com', password: 'password123' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'wrongpw@example.com', password: 'wrongpassword' })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.details).toEqual({});

    await app.close();
  });

  // Test 10: sign-in unknown email → 401 envelope
  it('sign-in with unknown email returns 401 with invalid_credentials', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'ghost@example.com', password: 'password123' })
      .expect(401);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.details).toEqual({});

    await app.close();
  });

  // Test 11: sign-in byte-equality (wrong-password vs unknown-email)
  it('sign-in failure responses are byte-identical for wrong-password and unknown-email', async () => {
    const users = new Map<string, StoredUser>();
    const mailCalls: MailCall[] = [];
    const app = await createApp(users, mailCalls);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'bytecmp@example.com', password: 'password123' })
      .expect(200);

    const resWrongPw = await request(app
