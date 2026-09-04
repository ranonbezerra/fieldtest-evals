# 21-tenant-config.spec.ts

## reasoning

```
Let me analyze what I need to write for `test/tenant-config.spec.ts`.

From the plan and the cases file, I need to test:

1. Returns branding and feature flags for a valid tenant (happy path)
2. Rejects when host slug and token org disagree (403 `tenant_mismatch`)
3. Rejects when no host is present or host doesn't map to a registered tenant (403 `unknown_tenant`)
4. Rejects a request with no `Authorization` header (401 `unauthorized`)
5. Rejects a bearer token with an invalid or tampered signature (401 `unauthorized`)
6. Rejects a validly-signed token whose payload has no `org` claim (403 `tenant_mismatch`)
7. Every error response uses the single envelope with `details` always an object
8. Feature flags default to an empty object when the tenant row stores `null`
9. Branding is returned as a JSON object matching what was stored
10. Host that equals the bare base domain is treated as unknown tenant

Now let me think about how to structure this test. I need to:
- Set up a NestJS testing module with the app
- Create test tenants in the database
- Make HTTP requests with different hosts and tokens
- Verify responses

From the plan:
- `TENANT_BASE_DOMAIN` env var for host parsing
- `JWT_SECRET` for JWT verification
- The middleware resolves host → slug, verifies JWT, compares org claim to slug
- `GET /tenant-config` returns branding + feature flags

Let me think about the test setup:
- I'll use `@nestjs/testing` to create a test module
- I'll use the actual `PrismaService` (or mock it)
- I'll set environment variables before importing the app

Actually, looking at the plan more carefully:
- `TENANT_BASE_DOMAIN` is the base domain (e.g. `operator-x.com`)
- Wait, re-reading: "Base domain from env. `TENANT_BASE_DOMAIN` (e.g. `operator-x.com`) configures host→slug parsing; host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`."

Wait, that's confusing. If `TENANT_BASE_DOMAIN` is `operator-x.com`, then the host would be `app.operator-x.com`? But that doesn't make sense for multi-tenant.

Let me re-read: "Tenant identity = slug. The tenant slug is the subdomain label of the host (e.g. app.operator-x.com → operator-x)"

So `app.operator-x.com` → slug is `operator-x`. The base domain would be... hmm.

Actually wait, I think the model is:
- `TENANT_BASE_DOMAIN` = something like `example.com` (the parent domain)
- A tenant's host would be `<slug>.<TENANT_BASE_DOMAIN>` e.g. `operator-x.example.com`
- The slug is the subdomain part

But the example says `app.operator-x.com → operator-x`. That implies the base domain is `operator-x.com` and the subdomain is `app`? No, that gives slug `app`.

Let me re-read more carefully: "The tenant slug is the subdomain label of the host (e.g. app.operator-x.com → operator-x)"

Hmm, so `app.operator-x.com` → slug is `operator-x`. That means the base domain is `.com`? No...

Actually I think the convention here is:
- The full host is something like `app.operator-x.com`
- The "base domain" in the env is the registrable domain part, like `com`? No that's weird.

Wait, I think I'm overcomplicating this. Let me look at the `hostToTenantSlug` function signature:
```ts
export function hostToTenantSlug(host: string, baseDomain: string): string | undefined;
```

And the plan says: "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

So if `baseDomain` = `operator-x.com`, then:
- Host `app.operator-x.com` ends in `.operator-x.com`? No, it ends in `.com`.
- Wait, `app.operator-x.com` - does it end in `.` + `operator-x.com`? Yes! `app.operator-x.com`.endsWith(`.operator-x.com`) is true.
- So the slug would be `app`? But the example says slug is `operator-x`.

I'm confused. Let me re-read the assumption again:

"Tenant identity = slug. The tenant slug is the subdomain label of the host (e.g. app.operator-x.com → operator-x) and is also the value of the token's org claim"

OK so the example is `app.operator-x.com` → `operator-x`. This means:
- The host is `app.operator-x.com`
- The slug is `operator-x`

For this to work with `hostToTenantSlug(host, baseDomain)`:
- If `baseDomain` = `.com`, then the part before `.com` is `app.operator-x`, and... no that doesn't work either.

Actually, I think the intended model might be:
- `baseDomain` is something like `platform.com` (the SaaS platform's domain)
- Each tenant gets a subdomain: `<slug>.platform.com`
- So `operator-x.platform.com` → slug = `operator-x`

The example in the plan (`app.operator-x.com → operator-x`) might just be poorly chosen or I'm misreading it. Let me just go with the standard multi-tenant subdomain pattern:
- `TENANT_BASE_DOMAIN` = e.g. `myplatform.com`
- Tenant host = `<slug>.myplatform.com`
- Slug = the subdomain part

For my tests, I'll use:
- `TENANT_BASE_DOMAIN` = `myplatform.com`
- Tenant A slug = `alpha`, host = `alpha.myplatform.com`
- Tenant B slug = `beta`, host = `beta.myplatform.com`

Now, for the test setup:

I need to:
1. Set `JWT_SECRET` and `TENANT_BASE_DOMAIN` env vars
2. Create test tenants in the DB (via Prisma or seed)
3. Make HTTP requests

Let me think about whether to use the real DB or mock. The plan says "Tests: tenant B cannot list, fetch-by-id (expect 404)..." which implies integration tests with a real DB. But for tenant-config specifically, I could potentially mock the repository.

However, looking at the cases more carefully, some test the middleware behavior (host resolution, JWT verification) which requires the full stack. And some test the service behavior (null feature flags → empty object).

I think the best approach is:
- Use `@nestjs/testing` with the full app module (integration test)
- Use the real Prisma service with a test database
- Seed tenants directly via Prisma

Actually, for a unit/integration hybrid, I could:
- Mock the `TenantRepository` for some tests
- Use the full stack for others

But the cases file says "proves the full happy path: middleware resolves host→slug, verifies JWT org matches, sets ALS, service reads context, repo fetches the row, controller shapes the response." This implies integration.

Let me go with a full integration test approach:
- Use `Test.createTestingModule` with `AppModule`
- Set up the DB (assume it's available via `DATABASE_URL`)
- Seed test data in `beforeAll`
- Clean up in `afterAll`

For JWT tokens, I'll use `jsonwebtoken` or `@nestjs/jwt`'s JwtService to sign tokens.

Let me structure the test:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/db/prisma.service';
import { JwtService } from '@nestjs/jwt';

// Set env vars before importing app module
process.env.JWT_SECRET = 'test-secret';
process.env.TENANT_BASE_DOMAIN = 'myplatform.com';

describe('GET /tenant-config', () => {
  // ...
});
```

Wait, I need to think about what the `TENANT_BASE_DOMAIN` env var is called in the actual implementation. The plan says `TENANT_BASE_DOMAIN`. Let me use that.

Now let me think about the cases:

1. **Happy path**: Valid host + valid token with matching org → 200 with branding and featureFlags
2. **Tenant mismatch**: Valid host + valid token with different org → 403 `tenant_mismatch`
3. **Unknown tenant**: Host that doesn't map to a registered tenant → 403 `unknown_tenant`
4. **No auth header**: No Authorization header → 401 `unauthorized`
5. **Invalid token**: Tampered/invalid signature → 401 `unauthorized`
6. **Missing org claim**: Valid token but no `org` in payload → 403 `tenant_mismatch`
7. **Error envelope**: Every error has `{ error: { code, message, details } }` with `details` as object
8. **Null feature flags**: Tenant row has null feature_flags → response has `featureFlags: {}`
9. **Branding as JSON**: Branding stored as JSON object is returned as JSON object (not stringified)
10. **Bare base domain**: Host = `myplatform.com` (no subdomain) → 403 `unknown_tenant`

For the test setup, I'll:
- Create two tenants (alpha and beta) in the DB
- Sign JWT tokens with different org claims
- Make requests with different Host headers

Let me write this out:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/db/prisma.service';
import { JwtService } from '@nestjs/jwt';

process.env.JWT_SECRET = 'test-secret-key';
process.env.TENANT_BASE_DOMAIN = 'myplatform.com';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const tenantASlug = 'alpha';
  const tenantBSlug = 'beta';
  const tenantADomain = 'myplatform.com'; // Wait, domain should be unique...
  
  // Actually, looking at the schema:
  // tenants has: slug (unique), domain (unique)
  // So domain is per-tenant, not the base domain
  
  // Let me re-think. The tenant has its own domain field.
  // But the host-to-slug resolution uses TENANT_BASE_DOMAIN to extract the slug.
  // The tenant's `domain` field might be the full domain like `alpha.myplatform.com`?
  
  // Actually, re-reading the plan: the `domain` field on tenant is "e.g. operator-x.com"
  // But that seems to be the tenant's own domain, separate from the base domain.
  
  // For the middleware, it uses TENANT_BASE_DOMAIN to parse the host into a slug.
  // The tenant's `domain` field is just stored data, not used for resolution.
  
  // So in my test:
  // - TENANT_BASE_DOMAIN = 'myplatform.com'
  // - Tenant A: slug='alpha', domain could be anything (it's just stored data)
  // - Request to Host: 'alpha.myplatform.com' with token org='alpha' → resolves to slug 'alpha'
  
  // Let me set domain to something reasonable for each tenant.
```

Actually, I realize I should just focus on what the middleware does:
1. Parse host to get slug (using TENANT_BASE_DOMAIN)
2. Look up tenant by slug in DB
3. Verify JWT
4. Compare token's org claim to the slug
5. If all pass, set ALS and proceed

The tenant's `domain` field is just data stored on the tenant record, not used in resolution.

Let me write the complete test now:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service';

process.env.JWT_SECRET = 'test-secret-key';
process.env.TENANT_BASE_DOMAIN = 'myplatform.com';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const tenantASlug = 'alpha';
  const tenantBSlug = 'beta';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    // Seed tenants
    await prisma.tenant.create({
      data: {
        slug: tenantASlug,
        domain: `${tenantASlug}.myplatform.com`,
        name: 'Tenant Alpha',
        branding: { logo: '/alpha-logo.png', theme: 'dark' },
        featureFlags: { beta_feature: true, new_checkout: false },
      },
    });

    await prisma.tenant.create({
      data: {
        slug: tenantBSlug,
        domain: `${tenantBSlug}.myplatform.com`,
        name: 'Tenant Beta',
        branding: { logo: '/beta-logo.png', theme: 'light' },
        featureFlags: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  // Helper to create a signed token
  function signToken(org: string | undefined): string {
    const payload = org !== undefined ? { org } : {};
    return jwt.sign(payload);
  }

  function makeRequest(host: string, token?: string) {
    let req = request(app.getHttpServer()).get('/tenant-config').set('Host', host);
    if (token) {
      req = req.set('Authorization', `Bearer ${token}`);
    }
    return req;
  }

  // Case 1: Happy path
  it('returns branding and feature flags for a valid tenant', async () => {
    const token = signToken(tenantASlug);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slug: tenantASlug,
      name: 'Tenant Alpha',
      branding: { logo: '/alpha-logo.png', theme: 'dark' },
      featureFlags: { beta_feature: true, new_checkout: false },
    });
  });

  // Case 2: Tenant mismatch
  it('rejects when host slug and token org disagree', async () => {
    const token = signToken(tenantBSlug); // token says beta, host says alpha
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  // Case 3: Unknown tenant (host doesn't map to registered tenant)
  it('rejects when host does not map to a registered tenant', async () => {
    const token = signToken('ghost');
    const res = await makeRequest('ghost.myplatform.com', token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('unknown_tenant');
  });

  // Case 4: No auth header
  it('rejects a request with no Authorization header', async () => {
    const res = await makeRequest(`${tenantASlug}.myplatform.com`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  // Case 5: Invalid token signature
  it('rejects a bearer token with an invalid signature', async () => {
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, 'invalid.token.here');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  // Case 6: Missing org claim
  it('rejects a validly-signed token with no org claim', async () => {
    const token = signToken(undefined); // valid JWT but no org field
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  // Case 7: Error envelope shape
  it('every error response uses the single envelope with details as an object', async () => {
    const cases = [
      makeRequest(`${tenantASlug}.myplatform.com`), // 401 no auth
      makeRequest('ghost.myplatform.com', signToken('ghost')), // 403 unknown
      makeRequest(`${tenantASlug}.myplatform.com`, signToken(tenantBSlug)), // 403 mismatch
    ];

    for (const req of cases) {
      const res = await req;
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body.error).toHaveProperty('details');
      expect(typeof res.body.error.details).toBe('object');
      expect(res.body.error.details).not.toBeNull();
    }
  });

  // Case 8: Null feature flags default to empty object
  it('returns empty object for featureFlags when stored as null', async () => {
    // Create a tenant with null feature_flags
    const slug = 'noflags';
    await prisma.tenant.create({
      data: {
        slug,
        domain: `${slug}.myplatform.com`,
        name: 'No Flags Tenant',
        branding: { logo: '/x.png' },
        featureFlags: null, // Prisma Json can be null
      },
    });

    const token = signToken(slug);
    const res = await makeRequest(`${slug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(res.body.featureFlags).toEqual({});

    // cleanup
    await prisma.tenant.deleteMany({ where: { slug } });
  });

  // Case 9: Branding returned as JSON object (not string)
  it('returns branding as a JSON object, not a stringified value', async () => {
    const token = signToken(tenantASlug);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(typeof res.body.branding).toBe('object');
    expect(res.body.branding).not.toBeNull();
    expect(res.body.branding.logo).toBe('/alpha-logo.png');
  });

  // Case 10: Bare base domain → unknown tenant
  it('treats the bare base domain as unknown tenant', async () => {
    const token = signToken('');
    const res = await makeRequest('myplatform.com', token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```

Wait, I need to think about a few things:

1. The `featureFlags` field in Prisma - if it's a `Json?` type, passing `null` should work. But I need to make sure the Prisma schema allows it. The plan says "map of flag→bool, default `{}`" so it's `Json @default("{}")`. If it has a default, can I still set it to null? In Prisma, if the field is `Json?` (optional), yes. If it's `Json` (non-optional with default), then no - it would always have the default.

Looking at the plan's schema: `feature_flags | jsonb | map of flag→bool, default {}`. This suggests it's non-nullable with a default. In that case, I can't store null.

Hmm, but the test case says "Feature flags default to an empty object when the tenant row stores null or the column was never set". So the service should handle both cases: when it's null AND when it's absent.

If the column is non-nullable with a default of `{}`, then it can never be null in practice. But the service might still want to be defensive. Let me just test the case where it's `{}` (the default) and verify it comes back as `{}`.

Actually wait - if the Prisma field is `Json @default("{}")` (non-nullable), then I can't insert null. Let me adjust the test to just verify that an empty object comes back as an empty object. Or I could make the field nullable in my test by using a raw query... but that's getting complicated.

Let me re-read the plan: "feature_flags | jsonb | map of flag→bool, default {}"

I think this means the Prisma field is `Json @default("{}")` which is non-nullable. So in practice it will always be at least `{}`. The service case about "null" might be about defensive coding.

For the test, I'll just verify that when featureFlags is `{}` (empty), it comes back as `{}`. And I'll add a note that this tests the normalization path.

Actually, you know what, let me just make the test work with what's actually possible. If the field is non-nullable, I'll test that an empty object is returned as an empty object. The "null" case from the cases list might not be testable if the schema prevents it. But I should still write the test - maybe I can use a raw SQL update to set it to null to simulate the edge case.

Hmm, but that's getting complicated. Let me just test with the empty object `{}` case and note that it verifies the contract holds.

Actually, re-reading the cases file more carefully: "Feature flags default to an empty object when the tenant row stores `null` or the column was never set — proves the service normalises a null/absent `featureFlags` jsonb to `{}` before returning it."

I think the safest approach is to use a raw Prisma query or `$queryRaw` to set the column to null, then test that the service normalizes it. Or I could just trust that if the schema has a default, the "never set" case is covered by the default, and the "null" case is a defensive check in the service.

Let me just test with `{}` and move on. The important thing is the response has `featureFlags: {}` not `null`.

Wait, actually I just realized - if I look at the Prisma schema field as `Json @default("{}")`, in TypeScript the type would be `JsonValue` (non-nullable). So when the service reads it, it should always get a JSON value, never null. The normalization to `{}` would only matter if somehow null got in there (e.g., a direct SQL insert).

For the test, I'll use `$executeRaw` to set it to null to simulate that edge case:

```typescript
await prisma.$executeRaw`UPDATE tenants SET feature_flags = NULL WHERE slug = 'noflags'`;
```

Then the service should still return `{}`.

OK let me also think about the `branding` field. Same situation - it's `Json` type. If I store `{ logo: '/alpha-logo.png', theme: 'dark' }`, it should come back as that object. The test verifies no double-stringification.

Now, one more consideration: the `AppModule` imports. I need to import it in my test. Let me check what the module structure looks like from the references:

From `src/app.module.ts`:
```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CustomerModule } from './customer/customer.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
    }),
    TenantModule,
    CustomerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
```

So I import `AppModule` from `'../src/app.module'`.

Now, for the global error filter - the plan says it's registered in `main.ts` via `app.useGlobalFilters(new HttpExceptionFilter())`. In my test, I'm creating the app via `Test.createTestingModule`, so I need to also register the filter:

```typescript
app.useGlobalFilters(new HttpExceptionFilter());
```

I need to import `HttpExceptionFilter` from `'../src/errors/http-exception.filter'`.

Let me also think about whether I need a `ValidationPipe` - probably not for these tests since I'm not testing validation.

Let me also consider: do I need to handle the `DATABASE_URL` env var? The plan says "Configuration comes from environment variables only. DATABASE_URL for Postgres." I'll assume the test database is available and set `DATABASE_URL` if needed. Actually, in a real test setup, you'd have this configured. I'll add it as an assumption or just leave it (assuming the test environment has it set).

Actually, I should set it in the test to be safe:
```typescript
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
```

Hmm, but that might conflict with the actual test environment. Let me just assume it's set and not override it.

Let me finalize my test file. One more thing - I need to make sure the `beforeAll` properly sets up and `afterAll` cleans up.

Also, I should think about test isolation. If tests run in parallel or in a specific order, the seeded tenants need to be there. I'll seed in `beforeAll` and clean in `afterAll`.

Let me also think about the `hostToTenantSlug` function. Based on the plan:
- If host ends with `.<baseDomain>`, the slug is the part before that suffix
- If host equals `<something>.<baseDomain>`, same thing
- If host equals the base domain itself, return undefined

So for `TENANT_BASE_DOMAIN = 'myplatform.com'`:
- `alpha.myplatform.com` → slug = `alpha`
- `myplatform.com` → undefined (bare base domain)
- `ghost.myplatform.com` → slug = `ghost` (but not in DB → unknown_tenant)

This matches my test cases.

One more thing: for case 5 (invalid token), I'm using `'invalid.token.here'` which is a malformed JWT. The `jwt.verify` will throw, and the middleware should catch it and return 401. Let me make sure this is correct.

Actually, a more realistic invalid token would be one that's properly formatted but has a bad signature. Like taking a valid token and tampering with it. Let me do:

```typescript
const validToken = signToken(tenantASlug);
const tampered = validToken.slice(0, -2) + 'xx'; // tamper with signature
```

Or I could just use a random string that looks like a JWT: `'aaa.bbb.ccc'`. The `jwt.verify` will fail on either.

Let me use `'invalid.signature.token'` for simplicity - it's clearly not a valid JWT.

Actually, `jwt.verify('invalid.signature.token', secret)` will throw because the token is malformed (not 3 parts, or parts aren't valid base64). Either way it should result in a 401.

Let me use a properly-formatted but bad-signature token for a more realistic test:
```typescript
const tampered = signToken(tenantASlug).slice(0, -3) + 'abc';
```

This gives a valid-format JWT with a wrong signature. `jwt.verify` will throw `JsonWebTokenError: invalid signature`.

OK I think I have enough to write the complete file. Let me put it all together.

Wait, one more thought: the `beforeEach` or `afterEach` cleanup. If I create extra tenants in individual tests (like the "noflags" tenant), I should clean them up. I'll do it in the test itself or in an `afterEach`.

Let me also think about whether I should use `beforeEach` to clean the tenants table and re-seed. That would give better isolation between tests. But it's slower. For a test file of this size, I'll seed once in `beforeAll` and clean up individual additions in the tests that add them.

Actually, for cleanliness, let me use `beforeEach` to ensure the two main tenants exist (upsert) and clean up any extras. Or better, just seed in `beforeAll` and use `deleteMany` in `afterAll`.

Let me write the final version now.

Oh wait, I also need to think about: does the `PrismaService` in the test use the same `DATABASE_URL` as my seed? Yes, because it's the same Prisma client instance from the app.

One concern: the `PrismaService.scoped` client - when I seed tenants directly via `prisma.tenant.create(...)`, this goes through the unscoped client (since `Tenant` is exempt from the guard). That's correct - I'm setting up test data, not going through the tenant-isolated path.

But wait - `prisma.tenant` on the base `PrismaClient` would work fine because `Tenant` is not in `TENANT_SCOPED_MODELS`. The guard only applies to `Customer`, `Plan`, `Order`. So `prisma.tenant.create(...)` works without a tenant context.

Actually, hold on. Looking at `PrismaService`:
```typescript
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
  constructor() {
    super();
    this.scoped = createTenantAwareClient(this);
  }
}
```

So `prisma.tenant` is the base PrismaClient's tenant model (unscoped), and `prisma.scoped.tenant` would be... wait, the guard says non-scoped models pass through unchanged. So `prisma.scoped.tenant` would also work without a tenant context.

For my seed, I'll use `prisma.tenant` (the base client) which definitely works.

OK, I'm confident now. Let me write the final file.

Actually, one more edge case to consider: the `details` field in error responses. The plan says "details is an object, never null." I should verify this in my envelope test.

Also, for the `tenant_mismatch` error, the plan's factory is:
```typescript
static tenantMismatch(expected: string, actual: string): AppException; // 403
```

So `details` might contain `{ expected, actual }` or something similar. I won't assert on the specific contents of `details` beyond it being an object - that would be testing implementation details.

Let me finalize. Here's my plan for the file structure:

```
imports
env setup
describe block
  beforeAll - setup app, seed tenants
  afterAll - cleanup, close app
  helper functions (signToken, makeRequest)
  
  test 1: happy path
  test 2: tenant mismatch (host alpha, token org beta)
  test 3: unknown tenant (ghost.myplatform.com)
  test 4: no auth header
  test 5: invalid token signature
  test 6: missing org claim
  test 7: error envelope shape (multiple errors)
  test 8: null feature flags → empty object
  test 9: branding as JSON object
  test 10: bare base domain → unknown tenant
```

Let me write it out completely now.
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/db/prisma.service';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/errors/http-exception.filter';

process.env.JWT_SECRET = 'test-secret-key';
process.env.TENANT_BASE_DOMAIN = 'myplatform.com';

describe('GET /tenant-config', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const tenantASlug = 'alpha';
  const tenantBSlug = 'beta';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await prisma.tenant.create({
      data: {
        slug: tenantASlug,
        domain: `${tenantASlug}.myplatform.com`,
        name: 'Tenant Alpha',
        branding: { logo: '/alpha-logo.png', theme: 'dark' },
        featureFlags: { beta_feature: true, new_checkout: false },
      },
    });

    await prisma.tenant.create({
      data: {
        slug: tenantBSlug,
        domain: `${tenantBSlug}.myplatform.com`,
        name: 'Tenant Beta',
        branding: { logo: '/beta-logo.png', theme: 'light' },
        featureFlags: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({});
    await app.close();
  });

  function signToken(org: string | undefined): string {
    const payload: Record<string, unknown> = {};
    if (org !== undefined) {
      payload.org = org;
    }
    return jwt.sign(payload);
  }

  function makeRequest(host: string, token?: string) {
    let req = request(app.getHttpServer())
      .get('/tenant-config')
      .set('Host', host);
    if (token !== undefined) {
      req = req.set('Authorization', `Bearer ${token}`);
    }
    return req;
  }

  it('returns branding and feature flags for a valid tenant', async () => {
    const token = signToken(tenantASlug);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slug: tenantASlug,
      name: 'Tenant Alpha',
      branding: { logo: '/alpha-logo.png', theme: 'dark' },
      featureFlags: { beta_feature: true, new_checkout: false },
    });
  });

  it('rejects when host slug and token org disagree', async () => {
    const token = signToken(tenantBSlug);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('rejects when host does not map to a registered tenant', async () => {
    const token = signToken('ghost');
    const res = await makeRequest('ghost.myplatform.com', token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('unknown_tenant');
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await makeRequest(`${tenantASlug}.myplatform.com`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a bearer token with an invalid signature', async () => {
    const validToken = signToken(tenantASlug);
    const tampered = validToken.slice(0, -3) + 'abc';
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, tampered);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a validly-signed token with no org claim', async () => {
    const token = signToken(undefined);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tenant_mismatch');
  });

  it('every error response uses the single envelope with details as a non-null object', async () => {
    const requests = [
      makeRequest(`${tenantASlug}.myplatform.com`),
      makeRequest('ghost.myplatform.com', signToken('ghost')),
      makeRequest(`${tenantASlug}.myplatform.com`, signToken(tenantBSlug)),
      makeRequest('myplatform.com', signToken('')),
    ];

    for (const req of requests) {
      const res = await req;
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(typeof res.body.error.code).toBe('string');
      expect(res.body.error).toHaveProperty('message');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error).toHaveProperty('details');
      expect(typeof res.body.error.details).toBe('object');
      expect(res.body.error.details).not.toBeNull();
      Array.isArray(res.body.error.details) || expect(Object.getPrototypeOf(res.body.error.details)).toBe(Object.prototype);
    }
  });

  it('returns empty object for featureFlags when stored as null', async () => {
    const slug = 'noflags';
    await prisma.tenant.create({
      data: {
        slug,
        domain: `${slug}.myplatform.com`,
        name: 'No Flags Tenant',
        branding: { logo: '/x.png' },
        featureFlags: {},
      },
    });

    await prisma.$executeRaw`UPDATE tenants SET feature_flags = NULL WHERE slug = ${slug}`;

    const token = signToken(slug);
    const res = await makeRequest(`${slug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(res.body.featureFlags).toEqual({});

    await prisma.tenant.deleteMany({ where: { slug } });
  });

  it('returns branding as a JSON object, not a stringified value', async () => {
    const token = signToken(tenantASlug);
    const res = await makeRequest(`${tenantASlug}.myplatform.com`, token);

    expect(res.status).toBe(200);
    expect(typeof res.body.branding).toBe('object');
    expect(res.body.branding).not.toBeNull();
    expect(res.body.branding.logo).toBe('/alpha-logo.png');
    expect(res.body.branding.theme).toBe('dark');
  });

  it('treats the bare base domain as unknown tenant', async () => {
    const token = signToken('');
    const res = await makeRequest('myplatform.com', token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('unknown_tenant');
  });
});
```
