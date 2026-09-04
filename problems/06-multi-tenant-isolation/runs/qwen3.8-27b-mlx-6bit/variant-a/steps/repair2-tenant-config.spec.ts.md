# repair2-tenant-config.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/tenant-config.spec.ts`:

1. `test/tenant-config.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.`
2. `test/tenant-config.spec.ts(3,26): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.`
3. `test/tenant-config.spec.ts(4,28): error TS2307: Cannot find module '@nestjs/jwt' or its corresponding type declarations.`
4. `test/tenant-config.spec.ts(35,9): error TS2561: Object literal may only specify known properties, but 'feature_flags' does not exist in type '(Without<TenantCreateInput, TenantUncheckedCreateInput> & TenantUncheckedCreateInput) | (Without<...> & TenantCreateInput)'. Did you mean to write 'featureFlags'?`
5. `test/tenant-config.spec.ts(44,9): error TS2561: Object literal may only specify known properties, but 'feature_flags' does not exist in type '(Without<TenantCreateInput, TenantUncheckedCreateInput> & TenantUncheckedCreateInput) | (Without<...> & TenantCreateInput)'. Did you mean to write 'featureFlags'?`

So the issues in this file are:
1. The module `@nestjs/testing` can't be found - this is a missing dependency, not something I can fix in the file itself. But wait, the task says "fixing what these messages require of this file." So I need to address the errors that are in this file.

Actually, looking more carefully - the TS2307 errors about missing modules are about missing packages. I can't fix those by rewriting the file - they need `pnpm install` or adding to package.json. But the task says to rewrite the file fixing what the messages require of this file.

Wait, let me re-read: "Rewrite `test/tenant-config.spec.ts` complete, fixing what these messages require of this file."

The TS2307 errors are about missing modules. These can't be fixed by changing the file content - they need the packages to be installed. So those are not something I can fix in this file.

The TS2561 errors ARE fixable in this file: `feature_flags` should be `featureFlags` in the Prisma create input (since Prisma uses camelCase for the JS API, and `@map` is used for the DB column name).

So the fix needed in this file is:
- Change `feature_flags` to `featureFlags` on lines 35 and 44.

The TS2307 errors about `@nestjs/testing`, `supertest`, and `@nestjs/jwt` are missing package issues. I can't fix those by rewriting the file - they need to be in `package.json` and installed. But I should still write the file correctly assuming those packages will be available.

Wait, but the task says "fixing what these messages require of this file." The TS2307 errors don't require changes to the file - they require installing packages. The TS2561 errors DO require changes to the file (using `featureFlags` instead of `feature_flags`).

So my rewrite should:
1. Keep the imports for `@nestjs/testing`, `supertest`, `@nestjs/jwt` (they're correct, just not installed)
2. Fix `feature_flags` → `featureFlags` in the Prisma create calls

Now let me think about what the test file should contain based on the PLAN.md:

Tests for `test/tenant-config.spec.ts`:
- `GET /tenant-config` with a matching host and token `org` returns that tenant's branding and feature flags.
- Same host with a token whose `org` claim differs returns 403 `tenant_mismatch`.
- Host that maps to no tenant returns 403 `unknown_tenant`.

I need to write a complete test file. Let me think about the structure:

1. Import from `@nestjs/testing` (Test), `supertest`, `@nestjs/jwt`
2. Set up the NestJS test module with AppModule (or a test-specific module)
3. Create tenants in the database
4. Generate JWT tokens with the correct `org` claim
5. Make requests with the appropriate `Host` header and `Authorization` header

Let me think about what the AppModule needs:
- It uses `JwtModule` with `JWT_SECRET` from env
- It applies `TenantResolutionMiddleware` globally
- It imports `TenantModule` and `CustomerModule`

For the test, I need to:
1. Set environment variables before importing/creating the app
2. Create the test module
3. Seed tenant data
4. Make HTTP requests

Let me write this out:

```typescript
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/db/prisma.service.js';

describe('GET /tenant-config', () => {
  let app;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const JWT_SECRET = 'test-secret';
  const BASE_DOMAIN = 'operator-x.com';

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);

    // Seed tenants
    await prisma.tenant.create({
      data: {
        slug: 'operator-x',
        domain: 'operator-x.com',
        name: 'Operator X',
        branding: { logo: '/logo-x.png' },
        featureFlags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'operator-y',
        domain: 'operator-y.com',
        name: 'Operator Y',
        branding: { logo: '/logo-y.png' },
        featureFlags: { beta: false },
      },
    });
  });

  afterEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  it('returns branding and feature flags for the resolved tenant', async () => {
    const token = jwtService.sign({ org: 'operator-x' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-x.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.slug).toBe('operator-x');
    expect(res.body.name).toBe('Operator X');
    expect(res.body.branding).toEqual({ logo: '/logo-x.png' });
    expect(res.body.featureFlags).toEqual({ beta: true });
  });

  it('returns 403 tenant_mismatch when token org differs from host', async () => {
    const token = jwtService.sign({ org: 'operator-y' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'operator-x.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('returns 403 unknown_tenant when host maps to no tenant', async () => {
    const token = jwtService.sign({ org: 'unknown-org' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', 'unknown.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```

Wait, I need to think about the host resolution. The plan says:
- "The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"
- "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

So with `TENANT_BASE_DOMAIN = 'operator-x.com'`, the host `operator-x.com` would be... hmm, that's the base domain itself. Let me re-read.

"Base domain from env. `TENANT_BASE_DOMAIN` (e.g. `operator-x.com`) configures host→slug parsing; host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`."

So if base domain is something like `platform.com`, then:
- `operator-x.platform.com` → slug `operator-x`
- `operator-y.platform.com` → slug `operator-y`

But the plan example says `TENANT_BASE_DOMAIN` is `operator-x.com`. That's confusing. Let me re-read the variant description:

"each gets its own domain (`app.operator-x.com`)"

So the host would be `app.operator-x.com`. The base domain would be... hmm.

Actually, I think the base domain is the parent domain that all tenants share. Like if it's a white-label platform, maybe the base is `platform.com` and each tenant gets `<slug>.platform.com`.

But the plan says `TENANT_BASE_DOMAIN` (e.g. `operator-x.com`). That's odd because that's specific to one operator.

Wait, I think I'm overthinking this. Let me look at what the middleware does:
- `hostToTenantSlug(host, baseDomain)` - extracts slug from host given the base domain
- If base is `platform.com` and host is `operator-x.platform.com`, slug = `operator-x`
- If base is `platform.com` and host is `platform.com`, no slug (it's the base itself)

For the test, I'll use a generic base domain. Let me use `platform.com` as the base domain and create tenants with slugs that match.

Actually wait - looking at the plan more carefully:

"host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

This means:
- host = `operator-x.platform.com`, base = `platform.com` → ends in `.platform.com` ✓, slug = `operator-x`
- host = `sub.operator-x.platform.com`, base = `platform.com` → ends in `.platform.com` ✓, but what's the slug? Probably the first label: `sub`? Or the second-to-last?

Hmm, I think the simplest interpretation is: if host ends in `.<base>`, the slug is the part before `.<base>`. So:
- `operator-x.platform.com` with base `platform.com` → slug = `operator-x`
- `app.operator-x.platform.com` with base `platform.com` → slug = `app.operator-x`? That doesn't make sense.

Let me just go with: slug is the subdomain part (everything before the base domain). For `operator-x.platform.com` with base `platform.com`, slug = `operator-x`.

For the test, I'll set `TENANT_BASE_DOMAIN` to something like `platform.com` and use hosts like `operator-x.platform.com`.

Actually, I just realized I should look at what makes the tests pass. The key requirement is:
1. Host + token org must agree
2. The tenant must exist in the DB

Let me just pick reasonable values. I'll use:
- `TENANT_BASE_DOMAIN = 'platform.com'`
- Tenant A: slug `operator-x`, host `operator-x.platform.com`
- Tenant B: slug `operator-y`, host `operator-y.platform.com`

This should work with the `hostToTenantSlug` function that extracts the subdomain label.

Now, about the `feature_flags` vs `featureFlags` issue: In Prisma, the model field is `featureFlags` (camelCase in TS), and it's mapped to `feature_flags` (snake_case in DB) via `@map`. So when creating a tenant via Prisma, we use `featureFlags` in the JS object.

The error messages confirm this:
```
test/tenant-config.spec.ts(35,9): error TS2561: ... 'feature_flags' does not exist in type ... Did you mean to write 'featureFlags'?
test/tenant-config.spec.ts(44,9): error TS2561: ... 'feature_flags' does not exist in type ... Did you mean to write 'featureFlags'?
```

So I need to use `featureFlags` instead of `feature_flags` in the create calls.

Now let me also think about the `branding` field. It's a `JsonValue` in Prisma. When creating, I pass a JSON object. The response should have it as a parsed object.

Let me also consider: the `TenantConfigDto` from the plan has:
```ts
interface TenantConfigDto {
  slug: string; name: string;
  branding: Record<string, unknown>; featureFlags: Record<string, boolean>;
}
```

So the response body should have `slug`, `name`, `branding`, and `featureFlags`.

Let me write the final version. I need to be careful about:
1. Using `featureFlags` not `feature_flags`
2. The TS2307 errors for missing modules - I can't fix those in the file, they're package installation issues. I'll keep the imports as-is since they're correct.

Actually, wait. The task says "fixing what these messages require of this file." The TS2307 errors for `@nestjs/testing`, `supertest`, and `@nestjs/jwt` - these require the packages to be installed. They don't require changes to the file content. The imports are correct; the packages just aren't installed.

The only fix I can make in this file is changing `feature_flags` to `featureFlags`.

But I'm asked to "Rewrite `test/tenant-config.spec.ts` complete" - so I need to provide the full file. Let me write it with the correct `featureFlags` and keep everything else correct.

Let me also think about whether I need an `// ASSUMPTION:` comment. The TS2307 errors are about missing packages, not about the file content being wrong. The file imports are correct; the packages just need to be installed. I don't think an assumption comment is needed for that - it's just a missing dependency issue.

Let me finalize the test file:
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/db/prisma.service.js';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const JWT_SECRET = 'test-secret';
  const BASE_DOMAIN = 'platform.com';

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TENANT_BASE_DOMAIN = BASE_DOMAIN;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);

    await prisma.tenant.create({
      data: {
        slug: 'operator-x',
        domain: 'operator-x.com',
        name: 'Operator X',
        branding: { logo: '/logo-x.png' },
        featureFlags: { beta: true },
      },
    });
    await prisma.tenant.create({
      data: {
        slug: 'operator-y',
        domain: 'operator-y.com',
        name: 'Operator Y',
        branding: { logo: '/logo-y.png' },
        featureFlags: { beta: false },
      },
    });
  });

  afterEach(async () => {
    await prisma.customer.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  it('returns branding and feature flags for the resolved tenant', async () => {
    const token = jwtService.sign({ org: 'operator-x' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `operator-x.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.slug).toBe('operator-x');
    expect(res.body.name).toBe('Operator X');
    expect(res.body.branding).toEqual({ logo: '/logo-x.png' });
    expect(res.body.featureFlags).toEqual({ beta: true });
  });

  it('returns 403 tenant_mismatch when token org differs from host', async () => {
    const token = jwtService.sign({ org: 'operator-y' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `operator-x.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('returns 403 unknown_tenant when host maps to no tenant', async () => {
    const token = jwtService.sign({ org: 'ghost' });

    const res = await request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', `ghost.${BASE_DOMAIN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```
