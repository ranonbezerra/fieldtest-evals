# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **`src/customer/customer.repository.ts(34,7)`**: The `create` call passes `{ email: data.email, name: data.name ?? null }` but Prisma's `CustomerCreateInput` requires a `tenant` relation field. Since the tenant-aware Prisma client is supposed to stamp the tenantId structurally, the repository shouldn't need to pass tenantId. But Prisma's type system still requires it. The fix is to use `create` with `unchecked` fields by casting or using a different approach.

Wait, let me think more carefully. The tenant-aware Prisma client is supposed to handle the tenantId stamping. But the type system still complains because Prisma's generated types require either the relation or the raw field.

Looking at the schema, `Customer` has a `tenant` relation. When using `create` without `unchecked` fields, Prisma expects `CustomerCreateInput` which requires the `tenant` relation. When using `unchecked` fields, it expects `CustomerUncheckedCreateInput` which requires `tenantId`.

The tenant-aware client is supposed to inject `tenantId` into the data. So the repository is passing data without `tenantId` because the extension/middleware adds it. But TypeScript doesn't know about that.

The fix for the repository: cast the data to bypass the type check, since the tenant-aware client will add `tenantId` at runtime. Something like:

```ts
return this.prisma.customer.create({
  data: { email: data.email, name: data.name ?? null } as any,
});
```

Or better, use `as Prisma.CustomerUncheckedCreateInput` or a similar cast. Actually, the cleanest approach that's common in multi-tenant Prisma setups is to cast the data object since the middleware/extension will add the tenantId.

2. **`src/tenant/tenant.middleware.ts(19,46)`**: `runWithTenant(context, () => next(req, _res))` — the error says "Expected 0-1 arguments, but got 2." So `runWithTenant` only accepts 0-1 arguments. Looking at the test file, it's used as:
```ts
await runWithTenant(ctxA, async () => ...)
```
Wait, that's 2 arguments in the test too. Let me re-read.

Actually wait - the test at line 231 has the error about `prisma.customer.create({ data: { email: 'no-context@example.com' } })`. And the test uses `runWithTenant(ctxA, async () => ...)` with 2 arguments.

The error is at `tenant.middleware.ts(19,46)` which is the line:
```ts
runWithTenant(context, () => next(req, _res));
```

So `runWithTenant` is defined to take 0-1 arguments. That means the definition of `runWithTenant` must be wrong, or the calls are wrong.

Wait, but the tests also use `runWithTenant` with 2 arguments. If `runWithTenant` only accepts 0-1 args, then the tests would also have errors. But the test file only shows an error at line 231 about the create input, not about `runWithTenant` calls.

Hmm, let me re-read the test. The test imports `runWithTenant` from `'../src/tenant/tenant-context.util.js'`. The middleware also imports it from `'./tenant-context.util.js'`.

If `runWithTenant` is defined with 0-1 parameters, then:
- The middleware call `runWithTenant(context, () => next(req, _res))` has 2 args → error
- The test calls `runWithTenant(ctxA, async () => ...)` also have 2 args → should also error

But the test file only shows one error (line 231). So maybe the test's `runWithTenant` calls don't error because... hmm.

Wait, maybe I'm misreading. Let me look at the test more carefully:

```ts
const smuggled = await runWithTenant(ctxA, async () =>
  prisma.customer.findMany({ where: { tenantId: tenants.b.id } }),
);
```

This is 2 arguments. If `runWithTenant` only accepts 0-1 args, this should also error. But it's not in the error list.

Unless... the test file has a different import or the errors are only showing a subset. But the instructions say "Below are every file that has errors and the compiler's complete output."

So only 3 errors total:
1. `customer.repository.ts(34,7)` - create input missing tenant
2. `tenant.middleware.ts(19,46)` - runWithTenant expected 0-1 args got 2
3. `test/customer.spec.ts(231,32)` - create input missing tenant

For error 2: If `runWithTenant` is defined to accept 0-1 arguments, but the tests call it with 2 arguments without error, then maybe the tests have a different import or the function is overloaded. Or maybe the definition is wrong and should accept 2 arguments.

Wait, the instruction says "When two files disagree about a name, a signature or a type, one of them is the definition. Change the caller unless the definition is the thing the errors say is wrong."

The error says `runWithTenant` at line 19 of the middleware "Expected 0-1 arguments, but got 2." This means the definition of `runWithTenant` takes 0-1 arguments. But the tests also pass 2 arguments and don't get an error. That's contradictory unless...

Oh wait, maybe the test file's errors are truncated or the test's `runWithTenant` calls actually do error but aren't shown. No, the instructions say "the compiler's complete output."

Let me reconsider. Maybe `runWithTenant` is defined as:
```ts
function runWithTenant(fn: () => Promise<void>): Promise<void>
```
(i.e., takes 0 or 1 argument - the callback)

And the correct usage in the middleware should be:
```ts
runWithTenant(() => next(req, _res));
```
But that doesn't make sense because the context needs to be set somewhere.

Or maybe it's:
```ts
function runWithTenant<T>(fn: () => T): T
```
Takes 1 argument (the function), and the tenant context is set elsewhere (like via a decorator or the function sets it internally).

But the tests call `runWithTenant(ctxA, async () => ...)` with 2 args. If that doesn't error, then the function must accept 2 args...

I'm confused. Let me re-read the error: `src/tenant/tenant.middleware.ts(19,46): error TS2554: Expected 0-1 arguments, but got 2.`

The column 46 points to the second argument. So the function signature only accepts 0-1 args.

But the test file uses it with 2 args and doesn't error. This is impossible unless:
1. The test file has a different `runWithTenant` import (unlikely, same path)
2. The test file's errors are not shown (contradicts "complete output")
3. There's some TypeScript magic (generics, overloads) that makes the test calls valid but not the middleware call

Wait, actually let me look at the test more carefully. Line numbers in the test:
- The `runWithTenant` calls are around lines 260-280 area
- The error is at line 231

Let me count lines in the test file... Actually, I can't easily count. Let me just look at what's at line 231.

Looking at the test file, the `it` blocks start around various lines. Let me try to count:

```
1: import { randomUUID } from 'node:crypto';
2: import type { Server } from 'node:http';
3: import type { INestApplication } from '@nestjs/common';
4: import request from 'supertest';
5: import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
6: import { PrismaService } from '../src/prisma/prisma.service.js';
7: import { runWithTenant, TenantContextError } from '../src/tenant/tenant-context.util.js';
8: import {
9:   bearer,
10:   bootstrapApp,
11:   raw,
12:   seedTenants,
13:   SeededTenants,
14:   TENANT_A,
15:   TENANT_B,
16:   wipeTenantData,
17: } from './helpers.js';
18: (empty)
19: type TestTenant = { slug: string; domain: string };
20: (empty)
21: describe('customer isolation across tenants', () => {
22:   let app: INestApplication;
23:   let server: Server;
24:   let tenants: SeededTenants;
25: (empty)
26:   beforeAll(async () => {
27:     tenants = await seedTenants();
28:     app = await bootstrapApp();
29:     server = app.getHttpServer();
30:   });
31: (empty)
32:   afterAll(async () => {
33:     await app?.close();
34:     await raw.$disconnect();
35:   });
36: (empty)
37:   beforeEach(async () => {
38:     await wipeTenantData();
39:   });
40: (empty)
41:   const createAs = (tenant: TestTenant, body: object): request.Test =>
42:     request(server)
43:       .post('/customers')
44:       .set('Host', tenant.domain)
45:       .set('Authorization', bearer(tenant.slug))
46:       .send(body);
47: (empty)
48:   const listAs = (tenant: TestTenant): request.Test =>
49:     request(server)
50:       .get('/customers')
51:       .set('Host', tenant.domain)
52:       .set('Authorization', bearer(tenant.slug));
53: (empty)
54:   it('fetches its own customer by id and hides tenantId', async () => {
55:     const created = await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' });
56:     expect(created.status).toBe(201);
57:     expect(created.body).not.toHaveProperty('tenantId');
58: (empty)
59:     const res = await request(server)
60:       .get(`/customers/${created.body.id}`)
61:       .set('Host', TENANT_A.domain)
62:       .set('Authorization', bearer(TENANT_A.slug));
63:     expect(res.status).toBe(200);
64:     expect(res.body).toMatchObject({ id: created.body.id, email: 'alice@a.example', name: 'Alice' });
65:     expect(res.body).not.toHaveProperty('tenantId');
66:   });
67: (empty)
68:   it('tenant B cannot list tenant A rows', async () => {
...
```

This is getting complex. Let me just focus on the errors and figure out the minimal fixes.

**Error 1 & 3**: Both are about `prisma.customer.create({ data: { email: ... } })` not having `tenant` or `tenantId`. The Prisma type system requires either the relation `tenant` or the scalar `tenantId` in the create input. Since the tenant-aware client stamps `tenantId` at runtime, we need to bypass the type check.

For `customer.repository.ts`, the fix is to cast the data:
```ts
create(data: CustomerCreateData): Promise<Customer> {
  return this.prisma.customer.create({
    data: { email: data.email, name: data.name ?? null } as Prisma.CustomerUncheckedCreateInput,
  });
}
```

But wait, we need to import `Prisma` from `@prisma/client`. Or we can just use `as any` but that's less clean. Actually, looking at the conventions, the repository is the only layer that touches the DB, and the tenant-aware client handles the scoping. The cleanest approach is to cast.

Actually, a better approach: since the tenant-aware Prisma extension will add `tenantId` to the data, we should cast the data to satisfy TypeScript. The standard pattern is:

```ts
import { Prisma, Customer } from '@prisma/client';

create(data: CustomerCreateData): Promise<Customer> {
  return this.prisma.customer.create({
    data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
  });
}
```

Or simpler: `data: { email: data.email, name: data.name ?? null, tenantId: '' } as any` — no, that's ugly.

The cleanest: cast to `Prisma.CustomerUncheckedCreateInput`. But we need `tenantId` to be present in that type too. Let me think...

`CustomerUncheckedCreateInput` would have `tenantId: string` as required. So we'd need:
```ts
data: { email: data.email, name: data.name ?? null, tenantId: '' } as Prisma.CustomerUncheckedCreateInput
```

That's also ugly. The most common pattern I've seen in multi-tenant Prisma setups is to just cast the entire data object:

```ts
data: { email: data.email, name: data.name ?? null } as any
```

Or even better, since the PrismaService is the tenant-aware one, we could define a type that represents what the repository passes (without tenantId) and cast. But the simplest fix that the compiler requires is just to add a type assertion.

Let me go with:
```ts
import { Customer, Prisma } from '@prisma/client';

create(data: CustomerCreateData): Promise<Customer> {
  return this.prisma.customer.create({
    data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
  });
}
```

For the test at line 231, the error is:
```ts
prisma.customer.create({ data: { email: 'no-context@example.com' } })
```

This is in the test that checks "a query issued with no tenant in context fails." The test is verifying that without a tenant context, the create is rejected. The fix here is the same cast:
```ts
prisma.customer.create({ data: { email: 'no-context@example.com' } as any })
```

Or:
```ts
prisma.customer.create({ data: { email: 'no-context@example.com' } as unknown as Prisma.CustomerUncheckedCreateInput })
```

But in the test, importing `Prisma` might not be ideal. Let me use `as any` for the test since it's test code.

Actually wait - for the test, the point is that this call should REJECT (throw TenantContextError). So the data doesn't matter for the type; it just needs to compile. `as any` is fine in a test.

**Error 2**: `runWithTenant(context, () => next(req, _res))` — "Expected 0-1 arguments, but got 2."

The definition of `runWithTenant` takes 0-1 arguments. The tests call it with 2 arguments and don't get an error. This is the key contradiction.

Wait... unless the test file's `runWithTenant` calls are on lines that I'm not seeing errors for because they happen to not trigger the error. But that's impossible if the function only takes 0-1 args.

Let me re-read the problem statement: "Below are every file that has errors and the compiler's complete output."

So the test file only has ONE error (line 231). The `runWithTenant` calls in the test must be valid. This means `runWithTenant` must accept 2 arguments in some overload or the function signature is different from what I think.

Wait, maybe `runWithTenant` is defined as:
```ts
export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T;
export function runWithTenant(): void; // or something
```

No, that would still allow 2 args.

Or maybe it's:
```ts
export function runWithTenant(fn?: () => void): void
```

That takes 0-1 args. Then the test calls with 2 args would error. But they don't.

I'm stuck. Let me reconsider.

OH WAIT. Maybe I'm wrong about the test not having errors on `runWithTenant`. Let me re-read the error list:

```
src/customer/customer.repository.ts(34,7): error TS2322
src/tenant/tenant.middleware.ts(19,46): error TS2554: Expected 0-1 arguments, but got 2.
test/customer.spec.ts(231,32): error TS2322
```

Only 3 errors. The test file only has 1 error. So the `runWithTenant` calls in the test must be valid.

This means `runWithTenant` must accept 2 arguments in some cases. But the middleware call is rejected. How?

Maybe the function signature is:
```ts
export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T
```

And the error in the middleware is because of the type of the first argument? No, the error is TS2554 which is about argument count, not types.

Hmm, or maybe there are two different `runWithTenant` functions? No, they import from the same file.

Wait, let me reconsider. What if the error is actually about the arrow function `() => next(req, _res)` having 2 arguments (`req` and `_res`) where 0-1 are expected? Let me re-read:

`src/tenant/tenant.middleware.ts(19,46): error TS2554: Expected 0-1 arguments, but got 2.`

Line 19, column 46. Let me count:
```ts
    runWithTenant(context, () => next(req, _res));
```
Column 46 would be around `next(req, _res)` — specifically the `req` in `next(req, _res)`. 

`next` is a `NextFunction` from express. `NextFunction` has the signature:
```ts
interface NextFunction {
    (err?: any): void;
    name: string;
}
```

So `next` takes 0-1 arguments! And `next(req, _res)` passes 2 arguments. THAT's the error!

So the fix is: `runWithTenant(context, () => next())` — just call `next()` without arguments.

That makes perfect sense! `NextFunction` in Express takes an optional error argument (0-1 args), not `(req, res)`.

So the three distinct mistakes are:

1. **`runWithTenant(context, () => next(req, _res))`** → should be `runWithTenant(context, () => next())` — the `next` callback doesn't take `req` and `res` as arguments.

2. **`customer.repository.ts` create** — needs a type assertion to bypass the missing `tenantId` requirement, since the tenant-aware client adds it at runtime.

3. **`test/customer.spec.ts` line 231** — same type assertion needed for the create call.

Now let me write the fixes:

**Fix 1: `src/tenant/tenant.middleware.ts`**
Change `runWithTenant(context, () => next(req, _res))` to `runWithTenant(context, () => next())`

**Fix 2: `src/customer/customer.repository.ts`**
Add a type assertion to the create data. Need to import `Prisma` or just use a cast.

Looking at the current imports:
```ts
import { Customer } from '@prisma/client';
```

I'll add `Prisma` to the import and use:
```ts
data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
```

**Fix 3: `test/customer.spec.ts`**
The line is:
```ts
prisma.customer.create({ data: { email: 'no-context@example.com' } }),
```

Need to add a cast. Since it's a test file, `as any` is simplest:
```ts
prisma.customer.create({ data: { email: 'no-context@example.com' } as any }),
```

Let me now write out the complete files.

For `src/tenant/tenant.middleware.ts`, the only change is line 19:
```ts
runWithTenant(context, () => next());
```

For `src/customer/customer.repository.ts`:
```ts
import { Customer, Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CustomerCreateData {
  email: string;
  name?: string;
}

export interface CustomerUpdateData {
  email?: string;
  name?: string;
}

/**
 * The only layer that touches the database for customers. Note what is not
 * here: no tenantId in any query. Scoping and stamping happen structurally in
 * the tenant-aware Prisma client.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  create(data: CustomerCreateData): Promise<Customer> {
    return this.prisma.customer.create({
      data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
    });
  }

  update(id: string, data: CustomerUpdateData): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
    });
  }

  remove(id: string): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
```

For `test/customer.spec.ts`, I need to change line 231. The line is:
```ts
    await expect(
      prisma.customer.create({ data: { email: 'no-context@example.com' } }),
    ).rejects.toBeInstanceOf(TenantContextError);
```

Change to:
```ts
    await expect(
      prisma.customer.create({ data: { email: 'no-context@example.com' } as any }),
    ).rejects.toBeInstanceOf(TenantContextError);
```

Now let me write out the complete files. I need to be careful to reproduce the test file exactly as given, with only that one line changed.
```

## reply

### src/tenant/tenant.middleware.ts
```ts
import { HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { verifyJwt } from '../auth/jwt.util.js';
import { runWithTenant, TenantContext } from './tenant-context.util.js';
import { TenantRepository } from './tenant.repository.js';

// ASSUMPTION: a tenant's registered `domain` is the only host-to-tenant
// mapping (no host can resolve a tenant without a row in `tenants`), and the
// token verification secret is read from JWT_SECRET.

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantRepository) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.resolveTenant(req);
      // The whole downstream pipeline runs inside this tenant's context.
      runWithTenant(context, () => next());
    } catch (error) {
      next(error);
    }
  }

  private async resolveTenant(req: Request): Promise<TenantContext> {
    const host = this.hostOf(req);
    const token = this.bearerToken(req);

    if (!token) {
      throw this.rejection(401, 'unauthorized', 'A bearer token is required', {});
    }

    const payload = verifyJwt(token, process.env.JWT_SECRET ?? '');
    if (!payload) {
      throw this.rejection(401, 'unauthorized', 'The bearer token is invalid or expired', {});
    }

    const hostTenant = await this.tenants.findByDomain(host);
    if (!hostTenant) {
      throw this.rejection(404, 'tenant_not_found', `No tenant is registered for host "${host}"`, { host });
    }

    // Both sources must resolve to the same tenant; a mismatch is rejected,
    // never resolved in favour of one side.
    const org = typeof payload.org === 'string' ? payload.org : undefined;
    if (org !== hostTenant.slug) {
      throw this.rejection(
        403,
        'tenant_mismatch',
        'The host and the token org claim do not resolve to the same tenant',
        { host, hostTenant: hostTenant.slug, org: org ?? null },
      );
    }

    return { tenantId: hostTenant.id, slug: hostTenant.slug, domain: hostTenant.domain };
  }

  private hostOf(req: Request): string {
    return (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
  }

  private bearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const [scheme, ...rest] = header.split(' ');
    if (scheme.toLowerCase() !== 'bearer' || rest.length !== 1 || !rest[0]) return null;
    return rest[0];
  }

  private rejection(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): HttpException {
    return new HttpException({ error: { code, message, details } }, status);
  }
}
```

### src/customer/customer.repository.ts
```ts
import { Customer, Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CustomerCreateData {
  email: string;
  name?: string;
}

export interface CustomerUpdateData {
  email?: string;
  name?: string;
}

/**
 * The only layer that touches the database for customers. Note what is not
 * here: no tenantId in any query. Scoping and stamping happen structurally in
 * the tenant-aware Prisma client.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  create(data: CustomerCreateData): Promise<Customer> {
    return this.prisma.customer.create({
      data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
    });
  }

  update(id: string, data: CustomerUpdateData): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
    });
  }

  remove(id: string): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
```

### test/customer.spec.ts
```ts
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { runWithTenant, TenantContextError } from '../src/tenant/tenant-context.util.js';
import {
  bearer,
  bootstrapApp,
  raw,
  seedTenants,
  SeededTenants,
  TENANT_A,
  TENANT_B,
  wipeTenantData,
} from './helpers.js';

type TestTenant = { slug: string; domain: string };

describe('customer isolation across tenants', () => {
  let app: INestApplication;
  let server: Server;
  let tenants: SeededTenants;

  beforeAll(async () => {
    tenants = await seedTenants();
    app = await bootstrapApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    await raw.$disconnect();
  });

  beforeEach(async () => {
    await wipeTenantData();
  });

  const createAs = (tenant: TestTenant, body: object): request.Test =>
    request(server)
      .post('/customers')
      .set('Host', tenant.domain)
      .set('Authorization', bearer(tenant.slug))
      .send(body);

  const listAs = (tenant: TestTenant): request.Test =>
    request(server)
      .get('/customers')
      .set('Host', tenant.domain)
      .set('Authorization', bearer(tenant.slug));

  it('fetches its own customer by id and hides tenantId', async () => {
    const created = await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('tenantId');

    const res = await request(server)
      .get(`/customers/${created.body.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, email: 'alice@a.example', name: 'Alice' });
    expect(res.body).not.toHaveProperty('tenantId');
  });

  it('tenant B cannot list tenant A rows', async () => {
    const alice = await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' });
    expect(alice.status).toBe(201);
    const carol = await createAs(TENANT_B, { email: 'carol@b.example', name: 'Carol' });
    expect(carol.status).toBe(201);

    const asB = await listAs(TENANT_B);
    expect(asB.status).toBe(200);
    expect(Array.isArray(asB.body)).toBe(true);
    const bEmails = asB.body.map((c: { email: string }) => c.email);
    const bIds = asB.body.map((c: { id: string }) => c.id);
    expect(bEmails).toContain('carol@b.example');
    expect(bEmails).not.toContain('alice@a.example');
    expect(bIds).not.toContain(alice.body.id);

    const asA = await listAs(TENANT_A);
    const aEmails = asA.body.map((c: { email: string }) => c.email);
    expect(aEmails).toContain('alice@a.example');
    expect(aEmails).not.toContain('carol@b.example');
  });

  it("returns 404 with an identical body for another tenant's id and for a nonexistent id", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const foreign = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toMatchObject({ code: 'resource_not_found' });

    const missing = await request(server)
      .get(`/customers/${randomUUID()}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(missing.status).toBe(404);

    // "Not yours" and "not there" are indistinguishable: same status, code,
    // message and shape. A 403 would leak that the row exists.
    expect(foreign.body.error).toEqual(missing.body.error);
  });

  it("cannot update another tenant's row; the row stays unchanged, and its own update works", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const res = await request(server)
      .patch(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug))
      .send({ name: 'Hacked', email: 'hacker@b.example' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'resource_not_found' });

    const after = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ email: 'alice@a.example', name: 'Alice' });

    const own = await request(server)
      .patch(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug))
      .send({ name: 'Alice Updated' });
    expect(own.status).toBe(200);
    expect(own.body.name).toBe('Alice Updated');
  });

  it("cannot delete another tenant's row; the row still exists, and its own delete works", async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example', name: 'Alice' })).body;

    const res = await request(server)
      .delete(`/customers/${alice.id}`)
      .set('Host', TENANT_B.domain)
      .set('Authorization', bearer(TENANT_B.slug));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'resource_not_found' });

    const after = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(after.status).toBe(200);
    expect(after.body.email).toBe('alice@a.example');

    const own = await request(server)
      .delete(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(own.status).toBe(204);
    const gone = await request(server)
      .get(`/customers/${alice.id}`)
      .set('Host', TENANT_A.domain)
      .set('Authorization', bearer(TENANT_A.slug));
    expect(gone.status).toBe(404);
  });

  it('registers the same email in both tenants, and still rejects a duplicate within one tenant', async () => {
    const inA = await createAs(TENANT_A, { email: 'shared@both.example', name: 'Shared A' });
    expect(inA.status).toBe(201);
    const inB = await createAs(TENANT_B, { email: 'shared@both.example', name: 'Shared B' });
    expect(inB.status).toBe(201);
    expect(inA.body.id).not.toBe(inB.body.id);

    const duplicate = await createAs(TENANT_A, { email: 'shared@both.example' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: 'conflict' });

    const listA = await listAs(TENANT_A);
    const listB = await listAs(TENANT_B);
    expect(listA.body.filter((c: { email: string }) => c.email === 'shared@both.example')).toHaveLength(1);
    expect(listB.body.filter((c: { email: string }) => c.email === 'shared@both.example')).toHaveLength(1);
  });

  it('rejects an invalid create body with the error envelope', async () => {
    const res = await createAs(TENANT_A, { email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'validation_failed' });
    expect(res.body.error.details).toMatchObject({ email: expect.any(String) });
  });

  it('concurrent requests from two tenants do not cross contexts', async () => {
    const N = 10;
    const requests: Array<request.Test> = [];
    for (let i = 0; i < N; i += 1) {
      requests.push(createAs(TENANT_A, { email: `conc-a-${i}@load.example` }));
      requests.push(createAs(TENANT_B, { email: `conc-b-${i}@load.example` }));
    }
    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 201)).toBe(true);

    const asA = await listAs(TENANT_A);
    const asB = await listAs(TENANT_B);
    const aEmails = asA.body.map((c: { email: string }) => c.email).sort();
    const bEmails = asB.body.map((c: { email: string }) => c.email).sort();
    const expectedA = Array.from({ length: N }, (_, i) => `conc-a-${i}@load.example`).sort();
    const expectedB = Array.from({ length: N }, (_, i) => `conc-b-${i}@load.example`).sort();
    expect(aEmails).toEqual(expectedA);
    expect(bEmails).toEqual(expectedB);

    // Ground truth at the database level: exactly N rows per tenant, none crossed.
    expect(await raw.customer.count({ where: { tenantId: tenants.a.id } })).toBe(N);
    expect(await raw.customer.count({ where: { tenantId: tenants.b.id } })).toBe(N);
    expect(
      await raw.customer.count({ where: { tenantId: tenants.a.id, email: { startsWith: 'conc-b-' } } }),
    ).toBe(0);
    expect(
      await raw.customer.count({ where: { tenantId: tenants.b.id, email: { startsWith: 'conc-a-' } } }),
    ).toBe(0);
  });

  it('a query issued with no tenant in context fails rather than returning everything', async () => {
    await createAs(TENANT_A, { email: 'alice@a.example' });
    await createAs(TENANT_B, { email: 'carol@b.example' });

    const prisma = app.get(PrismaService);
    await expect(prisma.customer.findMany()).rejects.toBeInstanceOf(TenantContextError);
    await expect(prisma.customer.findUnique({ where: { id: randomUUID() } })).rejects.toBeInstanceOf(
      TenantContextError,
    );
    await expect(prisma.customer.count()).rejects.toBeInstanceOf(TenantContextError);
    await expect(
      prisma.customer.create({ data: { email: 'no-context@example.com' } as any }),
    ).rejects.toBeInstanceOf(TenantContextError);

    // The refused create added nothing; nothing was readable.
    expect(await raw.customer.count({ where: { email: 'no-context@example.com' } })).toBe(0);
    expect(await raw.customer.count()).toBe(2);
  });

  it('a caller-supplied tenantId is overwritten by the context tenant, never trusted', async () => {
    const alice = (await createAs(TENANT_A, { email: 'alice@a.example' })).body;
    const carol = (await createAs(TENANT_B, { email: 'carol@b.example' })).body;

    const prisma = app.get(PrismaService);
    const ctxA = { tenantId: tenants.a.id, slug: TENANT_A.slug, domain: TENANT_A.domain };
    const ctxB = { tenantId: tenants.b.id, slug: TENANT_B.slug, domain: TENANT_B.domain };

    // Read: a where tenantId aimed at the other tenant is replaced, not obeyed.
    const smuggled = await runWithTenant(ctxA, async () =>
      prisma.customer.findMany({ where: { tenantId: tenants.b.id } }),
    );
    expect(smuggled).toHaveLength(1);
    expect(smuggled[0].tenantId).toBe(tenants.a.id);
    expect(smuggled[0].id).toBe(alice.id);

    // A tenantId buried in AND cannot cancel the context scope either.
    const crossUnique = await runWithTenant(ctxA, async () =>
      prisma.customer.findUnique({ where: { id: alice.id, AND: [{ tenantId: tenants.b.id }] } }),
    );
    expect(crossUnique?.id).toBe(alice.id);

    // ...and cannot reach across: B's id under A's context is a miss.
    const crossTenant = await runWithTenant(ctxA, async () =>
      prisma.customer.findUnique({ where: { id: carol.id } }),
    );
    expect(crossTenant).toBeNull();

    // Write: a supplied tenantId is stamped over by the context tenant.
    const stamped = await runWithTenant(ctxB, async () =>
      prisma.customer.create({ data: { email: 'stamped@b.example', tenantId: tenants.a.id } }),
    );
    expect(stamped.tenantId).toBe(tenants.b.id);
    expect(await raw.customer.count({ where: { tenantId: tenants.a.id, email: 'stamped@b.example' } })).toBe(0);
  });
});
```
