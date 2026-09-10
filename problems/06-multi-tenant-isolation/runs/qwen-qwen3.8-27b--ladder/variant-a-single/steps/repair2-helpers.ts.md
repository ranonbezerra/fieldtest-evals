# repair2-helpers.ts

## reasoning

```
Let me analyze the compiler errors to understand what `test/helpers.ts` needs to export and how.

The errors are all in `test/tenant.spec.ts`, but the task says to fix `test/helpers.ts`. Let me look at the error patterns:

1. `Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ... }' has no call signatures.` — This means the test file is importing `supertest` in a way that doesn't work with ESM. The import is likely `import request from 'supertest'` but supertest doesn't have a proper ESM default export. The fix in `test/helpers.ts` would be to re-export supertest in a way that works, like `import request from 'supertest'` → but that's the problem. The fix would be to use `import { default as request } from 'supertest'` or use a CJS interop pattern.

Wait, actually the issue is that the test file is doing `import request from 'supertest'` and getting the module namespace object instead of the callable function. In ESM, `supertest` doesn't export a default properly. The fix in `helpers.ts` would be to provide a properly typed callable.

Actually, looking more carefully - the error says the type is `{ default: SuperTestStatic; Test: typeof Test; agent: ... }` which is the module namespace. So the import in the test file is likely `import request from 'supertest'` and in ESM context, this gives the namespace object.

The fix in `helpers.ts` would be to re-export supertest in a way that the test file can use it correctly. Something like:

```typescript
import request from 'supertest';
export { request };
```

Wait, but if the test file imports directly from 'supertest', then fixing helpers.ts won't help unless the test file imports from helpers.ts.

Let me re-read the task: "Rewrite `test/helpers.ts` complete, fixing what these messages require of this file."

So the test file `test/tenant.spec.ts` imports from `test/helpers.ts`, and the errors are manifesting there. The helpers file must be re-exporting supertest (or providing a wrapper), and the way it does so is causing the type error.

Looking at the errors:
- Lines with "has no call signatures" — these are all `request(...)` calls. So `request` is being imported from helpers.ts and it's the wrong type.
- Lines 90, 93, 96, 208, 211: `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'` — These are likely passing a string where a nested create input is expected. This suggests the helpers file has a function that creates tenants with customers, and the parameter type is wrong.
- Lines 114, 128, 149: `Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | ...'` — These are passing a string where a Prisma where input is expected. This suggests the helpers file has a function that takes a `where` parameter typed as the Prisma input, but the test passes a string (like a tenant ID).

So `test/helpers.ts` likely:
1. Re-exports or wraps `supertest` — needs to be callable
2. Has a helper to create a tenant (with optional customer relation) — the customer parameter should accept a string (email or id) not the full nested input
3. Has a helper that takes a `where` or `id` parameter — should accept a string, not the full Prisma where type

Let me think about what the helpers file probably looks like based on the errors:

The test file probably does something like:
```typescript
import { request, createTenant, seedCustomer, ... } from './helpers';
```

And the helpers file currently:
1. Exports `request` as the supertest module namespace (not callable)
2. Has a function like `createTenant(branding, customer?)` where `customer` is typed as `TenantCreateNestedOneWithoutCustomersInput` instead of `string`
3. Has a function like `getCustomerByWhere(where)` where `where` is typed as the full Prisma where input instead of `string`

Let me reconstruct what `test/helpers.ts` should look like:

```typescript
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
// or
import request from 'supertest';
```

Wait, in ESM with TypeScript strict, the issue with supertest is well-known. The proper way is:

```typescript
import request from 'supertest';
```

But in ESM, this might not work. The common fix is:

```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const request = require('supertest');
```

Or using the `default` property:
```typescript
import supertest from 'supertest';
const request: typeof supertest.default = supertest.default;
```

Hmm, but looking at the error type: `{ default: SuperTestStatic; Test: typeof Test; agent: ... }` — this is the CJS module namespace. In ESM, when you `import request from 'supertest'`, if supertest is CJS, you get the module namespace as the default. So `request` becomes the namespace object, not the callable.

The fix in helpers.ts would be:
```typescript
import supertest from 'supertest';
const request: supertest.SuperTestStatic = supertest as any;
// or
export const request = (supertest as any).default ?? supertest;
```

Actually, the cleanest fix that's commonly used:
```typescript
import request from 'supertest';
export const testRequest: typeof request = request as any;
```

Hmm, but that's hacky. Let me think differently.

Actually, the most common pattern for supertest in ESM TypeScript projects is:

```typescript
import * as supertest from 'supertest';
// supertest.default is the actual function
export const request = supertest.default;
```

Wait no. Let me look at the error type again: `{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ... }`

This means the imported value has a `default` property that IS the `SuperTestStatic` (the callable). So the fix is:

```typescript
import supertest from 'supertest';
export const request = (supertest as any).default;
```

Or better, if we can access it properly:
```typescript
import { default as request } from 'supertest';
export { request };
```

Wait, `import { default as request } from 'supertest'` — would that work? If supertest is CJS and we're in ESM, `import x from 'supertest'` gives us the module.exports (which is the function). But the error shows the type is the namespace object with `default` as a property...

This is confusing. Let me look at it from the TypeScript type perspective. The type shown is:
```
{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ... }
```

This is the type of the module when you do `import * as request from 'supertest'` in a CJS module context, OR it's what you get when the module's types are declared as a namespace with a default export.

Looking at supertest's type definitions, they typically do:
```typescript
declare function supertest(app: any): SuperTest;
declare namespace supertest { ... }
export = supertest;
```

With `export =`, in ESM with `esModuleInterop`, `import request from 'supertest'` should work. But without `esModuleInterop` or with certain tsconfig settings, you might get the namespace.

Given the error, it seems like the current `test/helpers.ts` is doing something like:
```typescript
import * as request from 'supertest';
export { request };
```

And the fix would be:
```typescript
import request from 'supertest';
export { request };
```

OR the file is doing:
```typescript
import supertest from 'supertest';
export const request = supertest;
```

But the type shows it's getting the namespace. So maybe the issue is that `helpers.ts` does:
```typescript
import * as supertest from 'supertest';
export { supertest as request };
```

The fix: change to `import supertest from 'supertest'` (default import).

Now for the other errors:

Lines 90, 93, 96, 208, 211: `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'`

This suggests the helpers file has a function signature like:
```typescript
export async function createTenant(app: INestApplication, name: string, customer?: TenantCreateNestedOneWithoutCustomersInput) { ... }
```

But the test passes a string (like an email). So the fix is to change the parameter type to `string | TenantCreateNestedOneWithoutCustomersInput` or just `string`.

Lines 114, 128, 149: `Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | ...'`

This suggests a function like:
```typescript
export async function findCustomerByWhere(app: INestApplication, where: TenantWhereInput) { ... }
```

But the test passes a string (an ID). The fix would be to type it as `string` or a more appropriate type.

Now, I need to figure out what the full helpers file looks like. Since I can only see the errors, I need to infer the structure. Let me think about what a test helpers file for this multi-tenant system would need:

1. `request` — supertest wrapper
2. A function to create/seed a tenant
3. A function to create/seed a customer (possibly linked to a tenant)
4. A function to fetch resources
5. Maybe an app bootstrap function

Given the error lines in the test file (up to line 222), the test file is fairly long. Let me try to reconstruct what helpers.ts should export based on the error patterns:

- `request` (callable) — used at lines 101, 117, 131, 152, 167, 176, 187, 217, 222
- A function that creates a tenant with an optional customer parameter (string) — used at lines 90, 93, 96, 208, 211
- A function that takes a `where` parameter (string) — used at lines 114, 128, 149

Let me think about what makes sense for a multi-tenant test:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

export async function createTenant(prisma: PrismaClient, name: string, customer?: string) {
  const tenant = await prisma.tenant.create({
    data: { name },
  });
  if (customer) {
    await prisma.customer.create({
      data: {
        email: customer,
        tenantId: tenant.id, // or whatever the field is
      },
    });
  }
  return tenant;
}

export async function findCustomerByWhere(prisma: PrismaClient, where: string) {
  return prisma.customer.findFirst({ where: { id: where } });
}
```

Hmm, but I'm guessing at the shapes. Let me re-read the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

Let me look at the errors more carefully to deduce the exact signatures:

1. `request` needs to be callable (SuperTestStatic)
2. At lines 90, 93, 96, 208, 211: a parameter of type `TenantCreateNestedOneWithoutCustomersInput` is being passed a `string`. This means the helper function has a parameter typed as `TenantCreateNestedOneWithoutCustomersInput` (or something that resolves to it) where the test passes a string.

Wait, actually `TenantCreateNestedOneWithoutCustomersInput` is the type for the `customer` field in `TenantCreateInput` (the nested create for a one-to-many relation from Tenant to Customer). So the helper might be:

```typescript
export async function seedTenant(prisma: PrismaClient, data: { name: string; customer?: TenantCreateNestedOneWithoutCustomersInput }) {
  return prisma.tenant.create({ data });
}
```

And the test does:
```typescript
await seedTenant(prisma, { name: 'Acme', customer: 'user@example.com' });
```

The fix would be to change the type to accept `string | TenantCreateNestedOneWithoutCustomersInput` or to make the helper accept a string and construct the proper input internally.

3. At lines 114, 128, 149: a parameter typed as `TenantWhereInput` (or the full where union type) is being passed a `string`. The helper might be:

```typescript
export async function getTenant(prisma: PrismaClient, where: TenantWhereInput) {
  return prisma.tenant.findFirst({ where });
}
```

And the test does:
```typescript
await getTenant(prisma, tenantA.id);
```

The fix: change the parameter to `string` and construct the where internally, or accept `string | TenantWhereInput`.

Now, I need to be careful. The task says "Change nothing the messages do not name." So I should only fix what the errors point to.

But I also need to produce a COMPLETE file. So I need to reconstruct the whole thing.

Let me think about what a reasonable `test/helpers.ts` would contain for this multi-tenant system:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

// Seed a tenant with optional initial customer
export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
) {
  const tenant = await prisma.tenant.create({ data: { name } });
  if (customerEmail) {
    await prisma.customer.create({
      data: { email: customerEmail, tenantId: tenant.id },
    });
  }
  return tenant;
}

// Find a customer by where clause (string id)
export async function findCustomer(prisma: PrismaClient, id: string) {
  return prisma.customer.findFirst({ where: { id } });
}
```

Wait, but I'm guessing at field names. Let me look at what I know:
- From the tenant-prisma.service.ts reference, the models are: `tenant`, `customer`, `plan`, `order`
- The tenant field on models is called `tenant` (from `args.where = { ...args.where, tenant: tenantId }`)
- Wait, that's the relation field name. The actual column might be `tenantId`.

Looking at the Prisma extension code: `args.where = { ...args.where, tenant: tenantId }` — this uses the relation field name `tenant` in the where clause. In Prisma, you can filter by relation: `where: { tenant: { id: 'xxx' } }` or by the foreign key: `where: { tenantId: 'xxx' }`.

Actually wait, in Prisma extensions, when you do `args.where = { ...args.where, tenant: tenantId }`, this would be setting `tenant` as a scalar in the where, which would only work if `tenant` is a scalar field on the model (like a `String` field named `tenant`). But that's unusual for a relation.

Actually, looking more carefully at the Prisma extension code, it's using `args.where = { ...args.where, tenant: tenantId }` where `tenantId` is a string. If `tenant` is a relation field, this would need to be `tenant: { id: tenantId }`. But the code just does `tenant: tenantId`. This suggests either:
1. There's a scalar column `tenant` (or `tenant_id` mapped to `tenant`) on each model
2. Or the extension code has a bug

Given that this is reference code from a previous run (possibly buggy), I'll assume the schema uses a scalar `tenantId` field or a relation. For the helpers, I'll need to work with what makes sense.

Actually, I think the most likely schema design for multi-tenant with Prisma is:
- `Tenant` model with `id`, `name`, `branding`, etc.
- `Customer` model with `id`, `email`, `name`, `tenantId` (FK to Tenant)
- The relation would be `@relation(fields: [tenantId], references: [id])`

For the Prisma extension to work with `args.where = { ...args.where, tenant: tenantId }`, it would need to be `tenantId: tenantId` (the scalar FK). The fact that it says `tenant: tenantId` suggests either the column is named `tenant` or there's a bug in the reference code.

For the helpers file, I'll use `tenantId` as the field name since that's the conventional Prisma pattern.

Now let me think about what the test file likely does based on the error line numbers:

Lines 90, 93, 96: Creating tenants (probably in a `beforeAll` or test setup)
Lines 101, 114, 117, 128, 131, 149, 152: Making requests and checking isolation
Lines 167, 176, 187: More requests
Lines 208, 211: More tenant creation
Lines 217, 222: More requests

The test file likely:
1. Sets up an app
2. Creates tenant A and tenant B
3. Creates customers in each tenant
4. Tests that tenant B can't access tenant A's data
5. Tests that same email can exist in both tenants
6. Tests concurrent requests

For the helpers, I think the structure is:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
) { ... }

export async function getCustomerById(prisma: PrismaClient, id: string) { ... }
```

But I'm still guessing. Let me look at the error messages one more time:

The `TenantCreateNestedOneWithoutCustomersInput` type — this is specifically the input type for creating a nested Customer relation in a Tenant create. It has properties like `id`, `email`, `name`, etc. The fact that a `string` is being passed where this type is expected means the helper function's parameter is typed with this Prisma type.

The where type error: `'(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | (Without<TenantWhereInput, TenantRelationFilter> & TenantRelationFilter) | undefined'` — this is the full `CustomerWhereInput` type (the union of scalar and relation filters). A string is being passed where this is expected.

So the helpers likely have:
1. A function with a parameter typed as `TenantCreateNestedOneWithoutCustomersInput` (or it's part of a larger data object)
2. A function with a parameter typed as `CustomerWhereInput` (or similar)

Let me construct the most likely helpers file:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, TenantCreateNestedOneWithoutCustomersInput, CustomerWhereInput } from '@prisma/client';

export { request };

export async function seedTenant(
  prisma: PrismaClient,
  data: { name: string; customer?: TenantCreateNestedOneWithoutCustomersInput },
) {
  return prisma.tenant.create({ data });
}

export async function findCustomer(
  prisma: PrismaClient,
  where: CustomerWhereInput,
) {
  return prisma.customer.findFirst({ where });
}
```

And the test does:
```typescript
await seedTenant(prisma, { name: 'Acme', customer: 'user@example.com' });
await findCustomer(prisma, 'some-id');
```

The fixes:
1. `request` — change from `import * as request from 'supertest'` to `import request from 'supertest'`
2. `seedTenant` — change `customer` param type to `string | TenantCreateNestedOneWithoutCustomersInput` and handle both cases
3. `findCustomer` — change `where` param type to `string` (and construct the where internally) or `string | CustomerWhereInput`

Actually, I realize I should think about this differently. The task says "Rewrite `test/helpers.ts` complete, fixing what these messages require of this file." So I need to produce the complete file that would make these errors go away.

The key question is: what does the test file import from helpers.ts? I can infer:
- It imports something callable as `request` (or uses `request` from helpers)
- It imports a function that creates tenants (with customer param)
- It imports a function that finds/gets customers (with where/id param)

Let me also consider: the test file might import `request` directly from helpers, or it might import it and use it. Given all the "not callable" errors are on `request(...)` calls, the test file is calling `request` directly.

I think the most reasonable reconstruction is:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
): Promise<{ id: string; name: string }> {
  const tenant = await prisma.tenant.create({
    data: { name },
  });
  if (customerEmail) {
    await prisma.customer.create({
      data: {
        email: customerEmail,
        tenantId: tenant.id,
      },
    });
  }
  return tenant;
}

export async function findCustomerById(
  prisma: PrismaClient,
  id: string,
) {
  return prisma.customer.findFirst({ where: { id } });
}
```

Wait, but the error says the parameter type is `TenantCreateNestedOneWithoutCustomersInput`. If the helper just took a `string` for the email, the error wouldn't reference that type. The error means the CURRENT helpers.ts has the parameter typed as `TenantCreateNestedOneWithoutCustomersInput`.

So the current (broken) helpers.ts probably looks like:

```typescript
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';  // ← wrong import
import { PrismaClient, TenantCreateNestedOneWithoutCustomersInput, CustomerWhereInput } from '@prisma/client';

export { request };  // ← exports the namespace, not callable

export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customer?: TenantCreateNestedOneWithoutCustomersInput,  // ← too strict
) {
  return prisma.tenant.create({
    data: {
      name,
      customer: customer ? { create: customer } : undefined,
    },
  });
}

export async function findCustomer(
  prisma: PrismaClient,
  where: CustomerWhereInput,  // ← too strict
) {
  return prisma.customer.findFirst({ where });
}
```

And the test calls:
```typescript
await seedTenant(prisma, 'Acme', 'user@example.com');  // string, not the nested input
await findCustomer(prisma, 'customer-id');  // string, not the where input
```

So my fix should:
1. Fix the supertest import to be callable
2. Change the `customer` parameter to accept `string` (or `string | TenantCreateNestedOneWithoutCustomersInput`)
3. Change the `where`/`id` parameter to accept `string`

Let me write the fixed version. I'll make the customer parameter accept a string (email) and construct the proper input internally. I'll make the find function accept a string id.

Actually, I want to be more careful. Let me re-examine: the error at line 90 says `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'`. This is at a specific call site. The test is passing a string where the function expects `TenantCreateNestedOneWithoutCustomersInput`.

The simplest fix that satisfies the compiler: change the parameter type to accept `string`.

For the where errors: change the parameter to accept `string`.

Let me also think about whether there might be other exports in helpers that I'm not seeing errors for. The task says "Change nothing the messages do not name." So I should only include what the errors reference.

But I need to produce a COMPLETE file. If there are other exports that the test uses but don't cause errors, I won't know about them. However, the task says to fix "what these messages require of this file" — so I should focus on what the messages tell me.

Let me also consider: maybe the test file doesn't import `request` from helpers but imports it directly. In that case, the error would be in the test file itself, not in helpers. But the task says to fix helpers.ts, so the test must be importing from helpers.

Actually wait - re-reading the task: "Rewrite `test/helpers.ts` complete, fixing what these messages require of this file." This implies the errors are caused by something in helpers.ts. If the test file imported supertest directly, the error would be in the test file, not related to helpers.ts. So the test must be importing `request` from helpers.ts.

Let me finalize my answer:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
) {
  const tenant = await prisma.tenant.create({
    data: { name },
  });
  if (customerEmail) {
    await prisma.customer.create({
      data: {
        email: customerEmail,
        tenantId: tenant.id,
      },
    });
  }
  return tenant;
}

export async function findCustomer(
  prisma: PrismaClient,
  id: string,
) {
  return prisma.customer.findFirst({ where: { id } });
}
```

Hmm, but I'm not 100% sure about the function names or the exact structure. Let me add ASSUMPTION comments where I'm guessing.

Actually, let me reconsider. The error messages tell me:
1. `request` is exported from helpers and is not callable → fix the import
2. A function has a parameter typed as `TenantCreateNestedOneWithoutCustomersInput` → change to `string`
3. A function has a parameter typed as the full where input → change to `string`

I don't know the exact function names. But I need to produce a complete file. Let me make reasonable assumptions and note them.

Looking at the line numbers in the test file:
- Lines 90, 93, 96: three calls to the tenant creation function (with customer param as string)
- Lines 101, 114, 117: a request call, then a find/get call with string param, then another request
- Lines 128, 131: similar pattern
- Lines 149, 152: similar
- Lines 167, 176, 187: more request calls
- Lines 208, 211: more tenant creation
- Lines 217, 222: more request calls

The pattern suggests the test file has a structure like:
```
// setup (lines ~80-100)
const tenantA = await seedTenant(prisma, 'Tenant A', 'shared@example.com');
const tenantB = await seedTenant(prisma, 'Tenant B', 'shared@example.com');

// test isolation (lines ~100-200)
const res = await request(app).get('/customers').set('Host', 'app.tenant-a.com')...
const customer = await findCustomer(prisma, someId);
// ...

// more tests (lines ~200-222)
const tenantC = await seedTenant(prisma, 'Tenant C', 'another@example.com');
```

I think my reconstruction is reasonable. Let me also consider: does the test need `INestApplication` to be imported in helpers? Probably the test creates the app itself and passes it to `request`. So helpers probably doesn't need to import `INestApplication` unless it has a bootstrap function.

Let me keep it minimal: just export `request` and the two helper functions that the errors reference.

Wait, I should also consider: maybe there's a `createApp` or `bootstrap` function in helpers that the test uses. But since no error references it, and the task says "Change nothing the messages do not name," I should be conservative.

But I also need the file to be COMPLETE and compilable. If the test imports other things from helpers that I don't include, the test won't compile. But the task only gives me these specific errors to fix. If there were other errors (like "module has no exported member 'X'"), they would be in the error list. Since they're not, either:
1. The test doesn't import anything else from helpers, OR
2. The other imports are fine and don't cause errors

I'll go with what the errors tell me and add ASSUMPTION notes for what I'm guessing.

Let me also reconsider the supertest import. In an ESM project with `"type": "module"`, the correct way to import supertest (which is CJS) depends on the tsconfig:
- With `esModuleInterop: true`: `import request from 'supertest'` works
- Without: `import * as request from 'supertest'` gives the namespace

The error shows the type is the namespace (`{ default: SuperTestStatic; ... }`), which means the current code is getting the namespace. The fix is to use a default import or destructure the default.

In a typical NestJS + ESM setup, `esModuleInterop` is usually true. But the fact that the error occurs suggests it might not be, or the current code uses `import * as`.

The safest fix that works regardless of `esModuleInterop`:
```typescript
import request from 'supertest';
```

If `esModuleInterop` is true (which it should be for a NestJS project), this will give the callable function.

Actually, I just realized: if `esModuleInterop` is true and the current code does `import request from 'supertest'`, it should already work. The fact that it doesn't suggests either:
1. The current code does `import * as request from 'supertest'`
2. Or `esModuleInterop` is not set

For a NestJS project, `esModuleInterop` is typically set to true in tsconfig. So the most likely issue is that the current code uses `import * as request from 'supertest'`.

My fix: use `import request from 'supertest'`.

Let me write the final version:
```

## reply

```typescript
// ASSUMPTION: The test file imports `request`, a tenant-seeding helper, and a
// customer lookup helper from this module. Function names and the exact
// parameter list (beyond what the compiler errors constrain) are inferred
// from the error line numbers and the multi-tenant isolation test shape.

import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

// ASSUMPTION: `seedTenant` accepts the customer email as a plain string;
// the previous signature typed it as TenantCreateNestedOneWithoutCustomersInput
// which the test does not satisfy.
export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
) {
  const tenant = await prisma.tenant.create({
    data: { name },
  });
  if (customerEmail) {
    await prisma.customer.create({
      data: {
        email: customerEmail,
        tenantId: tenant.id,
      },
    });
  }
  return tenant;
}

// ASSUMPTION: `findCustomer` accepts a string id; the previous signature
// typed the parameter as the full Prisma where-input union which the test
// does not satisfy.
export async function findCustomer(
  prisma: PrismaClient,
  id: string,
) {
  return prisma.customer.findFirst({ where: { id } });
}
```
