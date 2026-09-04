# repair1-tenant-config.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/tenant-config.spec.ts`:

```
test/tenant-config.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/tenant-config.spec.ts(3,26): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.
test/tenant-config.spec.ts(4,28): error TS2307: Cannot find module '@nestjs/jwt' or its corresponding type declarations.
test/tenant-config.spec.ts(5,31): error TS2307: Cannot find module '../src/db/prisma.service' or its corresponding type declarations.
test/tenant-config.spec.ts(6,27): error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.
test/tenant-config.spec.ts(7,37): error TS2307: Cannot find module '../src/errors/http-exception.filter' or its corresponding type declarations.
```

The issues are:
1. Line 1: `@nestjs/testing` - module not found (this is a dependency issue, but the import path needs `.js` extension per `node16`/`nodenext` moduleResolution)
2. Line 3: `supertest` - module not found (same)
3. Line 4: `@nestjs/jwt` - module not found (same)
4. Line 5: `../src/db/prisma.service` - needs `.js` extension
5. Line 6: `../src/app.module` - needs `.js` extension
6. Line 7: `../src/errors/http-exception.filter` - needs `.js` extension

Wait, let me re-read the errors. The TS2307 errors are "Cannot find module" which for external packages means they're not installed. But the task says "Change nothing the messages do not name." So I need to fix what these specific errors require.

For external packages (`@nestjs/testing`, `supertest`, `@nestjs/jwt`), the TS2307 means they can't be resolved. In a `node16`/`nodenext` module resolution setup, external packages should still resolve fine if they're installed. The fact that they can't be found suggests they might not be in `node_modules` or there's a type resolution issue.

Wait, but the task says "fixing what these messages require of this file." So I need to fix the import paths in this file. For external packages, the import path itself is correct - the issue is they're not installed. But since I can only fix this file, and the error says "Cannot find module", maybe the issue is that with `node16`/`nodenext` resolution, the imports need to be different?

Actually, looking more carefully at the errors:
- TS2307 for external packages: This typically means the package isn't installed or its types aren't available. But since I'm told to fix what the messages require of THIS file, and these are external packages, maybe I need to add type declarations or the packages just aren't installed. But I can only modify this one file.

Wait, let me reconsider. The instruction says "Change nothing the messages do not name." So I should only fix what's in this file. The TS2307 for external packages (`@nestjs/testing`, `supertest`, `@nestjs/jwt`) - these are legitimate imports that should work if the packages are installed. The error might be because they're genuinely not installed, but I can't fix that by changing this file's import syntax.

Actually, for `node16`/`nodenext` module resolution, external package imports work the same way - you just import the package name. The TS2307 would only occur if the package isn't installed or doesn't have type declarations.

But wait - looking at the other errors in the workspace, similar TS2307 errors appear for `express` and `@nestjs/jwt` in the middleware file. This suggests these packages might not be installed. But I'm told to only fix this file.

For the relative imports (lines 5, 6, 7), the fix is clear: add `.js` extensions:
- `../src/db/prisma.service` → `../src/db/prisma.service.js`
- `../src/app.module` → `../src/app.module.js`
- `../src/errors/http-exception.filter` → `../src/errors/http-exception.filter.js`

For the external packages, since I can't install them and the error is TS2307 (module not found), the only thing I can do in this file is... well, the import syntax is already correct for external packages. Unless I need to use a different import mechanism.

Hmm, but wait. Let me re-read the task: "Rewrite `test/tenant-config.spec.ts` complete, fixing what these messages require of this file."

So I need to rewrite the entire file. The errors tell me:
1. External packages can't be found - I can't fix this by changing import syntax (they're already correct). But maybe I should add `// @ts-expect-error` or use `require`? No, that would be changing the approach.

Actually, I think the real issue is that these packages aren't installed in the project, but since this is a test file and the plan specifies using them, I should keep the imports as-is. The TS2307 for external packages is an environment issue, not a file syntax issue.

But wait - the task says "fixing what these messages require of this file." If the message is "Cannot find module '@nestjs/testing'", what does that require of this file? It requires that the module be resolvable. In a `node16`/`nodenext` setup, external packages resolve via their `package.json` `exports` field. If the package is installed but its types aren't being found, maybe I need to import differently?

Actually, I think I'm overthinking this. Let me look at what a working test file would look like given the plan and the constraints:

1. The test needs to use `@nestjs/testing` to create a test module
2. It needs `supertest` for HTTP testing
3. It needs `@nestjs/jwt` to sign tokens
4. It needs to import from `../src/db/prisma.service.js`, `../src/app.module.js`, `../src/errors/http-exception.filter.js`

For the external packages, the import paths are already correct. The TS2307 is because they're not installed (or their types aren't available). Since I can only fix this file, and the import syntax for external packages is already correct in `node16`/`nodenext`, I'll keep them as-is. The fix for this file is primarily the `.js` extensions on relative imports.

Wait, but actually - maybe I should look at this differently. The task says the file "does not compile" and gives me the exact compiler messages. My job is to rewrite the file so it compiles. For external packages that aren't installed, no amount of import syntax changes will fix TS2307. But for relative imports missing `.js` extensions, that's the fix.

Let me just write the file with:
- External package imports as-is (they're correct syntax, the issue is environmental)
- Relative imports with `.js` extensions

Actually wait - I just realized something. In `node16`/`nodenext` module resolution, if a package doesn't have proper `exports` in its package.json or the types aren't resolved, you might get TS2307. But for well-known packages like `@nestjs/testing`, `supertest`, `@nestjs/jwt`, they should work fine if installed.

I think the pragmatic answer is: fix what I can fix (the `.js` extensions on relative imports), and for the external packages, they're correctly specified. The TS2307 for them is an environment/installation issue that can't be fixed by changing this file's import syntax.

But the task says "fixing what these messages require of this file" - so maybe for external packages, there's nothing I can do differently in the import statement itself. The import `from '@nestjs/testing'` is the correct way to import it regardless of module resolution mode.

Let me now write the complete test file based on the plan:

The plan says these tests for tenant-config.spec.ts:
- `GET /tenant-config` with a matching host and token `org` returns that tenant's branding and feature flags.
- Same host with a token whose `org` claim differs returns 403 `tenant_mismatch`.
- Host that maps to no tenant returns 403 `unknown_tenant`.

I need to:
1. Set up a NestJS test module with `AppModule`
2. Override the `PrismaService` or use a real DB connection (the plan uses PrismaService)
3. Use supertest to make HTTP requests
4. Sign JWTs with `jsonwebtoken` (wait, the error shows `@nestjs/jwt` not `jsonwebtoken`)

Wait, looking at the error messages again:
```
test/tenant-config.spec.ts(4,28): error TS2307: Cannot find module '@nestjs/jwt' or its corresponding type declarations.
```

So line 4 imports `@nestjs/jwt`. Let me think about what the test needs:

1. Create a test app with `Test.createTestingModule({ imports: [AppModule] })`
2. The app needs the global error filter applied
3. Seed tenant data in the database
4. Make requests with appropriate headers (Host and Authorization)

For JWT signing in tests, I could use `jsonwebtoken` directly or the `JwtService`. The error shows `@nestjs/jwt` is imported, so I'll use that.

Actually, let me reconsider the structure. Looking at the plan:
- `JWT_SECRET` from env
- The middleware verifies JWTs with `@nestjs/jwt`
- For tests, I need to create valid tokens

Let me write the test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/errors/http-exception.filter.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // ... setup/teardown
});
```

Wait, but the issue is that `AppModule` uses `JwtModule` which needs `JWT_SECRET`. And the tests need a database. Let me think about how to handle this...

Looking at the plan more carefully, it says tests use `PrismaService` - so they likely connect to a real (test) database. The tests would:
1. Connect to the test DB
2. Seed tenant records
3. Create tokens
4. Make requests

Let me structure this properly. I'll need to:
- Set `JWT_SECRET` env var before importing (or configure it in the test module)
- Use `Test.createTestingModule` with `AppModule`
- Apply the global filter
- Override or use the real PrismaService

Actually, since `AppModule` imports `JwtModule` with a global config using `JWT_SECRET`, I need to make sure that env var is set. Let me handle this in the test setup.

For the `TenantResolutionMiddleware`, it reads `TENANT_BASE_DOMAIN` from env. I need to set that too.

Let me write a comprehensive test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/errors/http-exception.filter.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const tenantA = { slug: 'operator-a', domain: 'operator-a.com', name: 'Operator A' };
  const tenantB = { slug: 'operator-b', domain: 'operator-b.com', name: 'Operator B' };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.TENANT_BASE_DOMAIN = 'example.com';
    // Hmm, but TENANT_BASE_DOMAIN is used to parse the host...
    // If host is 'app.operator-a.com', how does that work with base domain?
  });
});
```

Wait, I need to re-read the plan's assumption about tenant resolution:

"The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"

So for `app.operator-a.com`, the slug would be `operator-a`. The base domain would be... hmm, this is confusing. Let me re-read:

"Base domain from env. TENANT_BASE_DOMAIN (e.g. operator-x.com) configures host→slug parsing; host is considered tenant-owned only if it ends in .<base> or equals <slug>.<base>."

Wait, that's a bit confusing. If `TENANT_BASE_DOMAIN` is `operator-x.com`, then a host like `app.operator-x.com` ends in `.operator-x.com`? No, that doesn't make sense for multi-tenant.

Actually I think the base domain is something like `platform.com` and each tenant gets `<slug>.platform.com`. But the plan example says `app.operator-x.com` → slug is `operator-x`. So maybe the parsing is: take the host, strip known suffixes, and the remaining part before the last dot (or some subdomain structure) gives the slug.

Actually, re-reading more carefully: "The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"

So from `app.operator-x.com`, the slug is `operator-x`. This means the parsing logic extracts everything between the first subdomain label and the base domain. If the base domain is `com`... no that's too generic.

I think the simplest interpretation for testing is:
- Host: `app.operator-a.com`
- The slug extraction gives `operator-a` (everything after the first subdomain `app.` and before the base domain `.com`)

But for the test, I just need to set up the environment so that:
1. A host like `app.operator-a.com` resolves to slug `operator-a`
2. A tenant with slug `operator-a` exists in the DB

For the test, I'll just set `TENANT_BASE_DOMAIN` to something that makes the parsing work. Given the example in the plan, I think `TENANT_BASE_DOMAIN` might be `com` or something... Actually, I think I'm overcomplicating this.

Let me look at the `hostToTenantSlug` function signature: `hostToTenantSlug(host: string, baseDomain: string): string | undefined`

The plan says: "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

So if base domain is `example.com`:
- `operator-a.example.com` → slug `operator-a` (host ends in `.example.com`)
- `app.operator-a.example.com` → hmm, this would be... the part before `.example.com` is `app.operator-a`, and the slug would be... the last label? `operator-a`?

I think for simplicity, in the tests I'll use hosts like:
- `operator-a.example.com` → slug `operator-a`
- `operator-b.example.com` → slug `operator-b`

And set `TENANT_BASE_DOMAIN=example.com`.

Now, for the token: the JWT needs an `org` claim that matches the slug. So for tenant A, the token has `org: 'operator-a'`.

Let me write the full test now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/errors/http-exception.filter.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.TENANT_BASE_DOMAIN = 'example.com';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);

    // Seed tenants
    await prisma.tenant.create({
      data: {
        slug: 'operator-a',
        domain: 'operator-a.example.com',
        name: 'Operator A',
        branding: { logo: '/logo-a.png', color: '#ff0000' },
        feature_flags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'operator-b',
        domain: 'operator-b.example.com',
        name: 'Operator B',
        branding: { logo: '/logo-b.png', color: '#00ff00' },
        feature_flags: { beta: false },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    // Cleanup
    await prisma.customer.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.$disconnect();
  });

  it('returns branding and feature flags for the resolved tenant', async () => {
    const token = jwtService.sign({ org: 'operator-a' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-a.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      slug: 'operator-a',
      name: 'Operator A',
      branding: { logo: '/logo-a.png', color: '#ff0000' },
      featureFlags: { beta: true },
    });
  });

  it('returns 403 tenant_mismatch when token org differs from host', async () => {
    const token = jwtService.sign({ org: 'operator-b' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-a.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('returns 403 unknown_tenant when host maps to no tenant', async () => {
    const token = jwtService.sign({ org: 'nonexistent' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'nonexistent.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```

Wait, but I need to think about whether `prisma.tenant` is accessible directly. The plan says the `Tenant` model is exempt from the guard (non-scoped), so `prisma.tenant` should work directly on the base client. But `PrismaService` extends `PrismaClient`, so `prisma.tenant` should be available.

Actually, looking at the plan:
```
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
}
```

So `prisma.tenant` is the base PrismaClient's tenant model (unscoped), and `prisma.scoped.customer` is the guarded one. For seeding in tests, I can use `prisma.tenant` directly since it's the registry model.

But wait - for cleanup, `prisma.customer.deleteMany({})` would fail because the guard requires a tenant context. I should use `prisma.$executeRaw` or just not worry about cleanup in the test (since it's a test DB). Or I could use the base client for cleanup.

Actually, since `PrismaService extends PrismaClient`, I can use `prisma.$executeRaw` for cleanup, or I can just use the base prisma client methods for non-scoped operations. But `customer` is scoped, so `prisma.customer.deleteMany({})` would go through the guard and fail without a tenant context.

Hmm, let me think... In the test setup/teardown, I'm not in a tenant context. So I can't use `prisma.customer` or `prisma.scoped.customer`. I should use raw SQL for cleanup, or just skip cleanup (tests run in isolation with a fresh DB).

Let me simplify: I'll just clean up the tenant records (which are non-scoped) and use `$executeRaw` for the rest, or just rely on a fresh test database.

Actually, the simplest approach: since this is a test, I'll just clean up tenants (non-scoped model) and use `$executeRaw` for scoped models. Or even simpler - just clean up what I can and let the test DB handle the rest.

Let me also consider: does `prisma.tenant.create` work without a tenant context? Yes, because `Tenant` is in the exempt list (non-scoped), so the guard passes it through unchanged.

Now, one more consideration: the `beforeAll` sets env vars, but they need to be set BEFORE the module is created (since `JwtModule` reads `JWT_SECRET` at module registration time). Setting them at the top of `beforeAll` before `Test.createTestingModule` should work.

Actually wait - I need to be more careful. If `AppModule` has `JwtModule.register({ secret: process.env.JWT_SECRET })`, then the env var needs to be set before `AppModule` is instantiated. Setting it at the start of `beforeAll` should be fine since that's before the module is created.

But there's another issue: if the test file is loaded and `process.env` is read at import time (top-level), it won't work. But since I'm setting it in `beforeAll` before creating the module, it should be fine.

Let me also think about whether I need `jsonwebtoken` instead of `@nestjs/jwt`. The error message shows `@nestjs/jwt` on line 4, so the original file used that. I'll keep it.

Actually, for signing tokens in tests, using `JwtService` (from the app's DI) is cleaner because it uses the same secret. Let me get it from the module ref.

One more thing: the `Host` header in supertest. When you use `.set('Host', 'operator-a.example.com')`, it overrides the Host header that supertest normally sets. This should work for the middleware to read `req.headers.host`.

Let me also consider: does the middleware read from `req.hostname` or `req.headers.host`? In Express, `req.hostname` is derived from the `Host` header. The middleware likely reads `req.headers.host` or `req.hostname`. Either way, setting the `Host` header in supertest should work.

Let me finalize the test file. I'll keep it focused on the three test cases specified in the plan for `tenant-config.spec.ts`:

1. Returns branding and feature flags for the resolved tenant
2. Returns 403 tenant_mismatch when token org differs from host
3. Returns 403 unknown_tenant when host maps to no tenant

Here's my final version:
```

## reply

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/errors/http-exception.filter.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.TENANT_BASE_DOMAIN = 'example.com';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);

    await prisma.tenant.create({
      data: {
        slug: 'operator-a',
        domain: 'operator-a.example.com',
        name: 'Operator A',
        branding: { logo: '/logo-a.png', color: '#ff0000' },
        feature_flags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'operator-b',
        domain: 'operator-b.example.com',
        name: 'Operator B',
        branding: { logo: '/logo-b.png', color: '#00ff00' },
        feature_flags: { beta: false },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.tenant.deleteMany({});
    await prisma.$disconnect();
  });

  it('returns branding and feature flags for the resolved tenant', async () => {
    const token = jwtService.sign({ org: 'operator-a' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-a.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      slug: 'operator-a',
      name: 'Operator A',
      branding: { logo: '/logo-a.png', color: '#ff0000' },
      featureFlags: { beta: true },
    });
  });

  it('returns 403 tenant_mismatch when token org differs from host', async () => {
    const token = jwtService.sign({ org: 'operator-b' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-a.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('returns 403 unknown_tenant when host maps to no tenant', async () => {
    const token = jwtService.sign({ org: 'nonexistent' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'nonexistent.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```
