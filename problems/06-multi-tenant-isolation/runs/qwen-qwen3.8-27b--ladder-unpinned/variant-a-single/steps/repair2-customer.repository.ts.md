# repair2-customer.repository.ts

## reasoning

```
Let me analyze the compiler errors carefully:

1. The errors in `test/tenant.spec.ts` about `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'` — these are about `prisma.tenant.create({ data: { ... } })` where a string is being passed where a nested input object is expected. This is about the test file, not the repository.

2. The errors about `Type '{ default: SuperTestStatic; ... }' has no call signatures` — these are about `request` being imported incorrectly in the test file. This is about the test file, not the repository.

3. The errors about `Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | ...'` — these are about `prisma.tenant.findUnique({ where: 'string' })` or similar where a string is passed directly instead of `{ id: 'string' }`. Again, test file issues.

Wait, but the task says "Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file."

Let me re-read the errors. ALL the errors are in `test/tenant.spec.ts`. None of them are in `src/customer/customer.repository.ts` itself.

But the task says to rewrite `src/customer/customer.repository.ts` fixing what these messages require of this file.

Looking at the errors more carefully:
- `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'` — This suggests that in the test, they're doing something like `prisma.tenant.create({ data: { customers: tenantId } })` where `tenantId` is a string, but Prisma expects a nested create input object.

Wait, let me think about this differently. The test file is using `prisma.tenant.create()` directly (not through the tenant-scoped service). The `TenantCreateNestedOneWithoutCustomersInput` type is what Prisma expects for the `customers` field in a `TenantCreateInput`.

But the key question is: what does `src/customer/customer.repository.ts` need to look like to make these test errors go away?

Actually, wait. The task says "fixing what these messages require of this file." If the errors are all in the test file and not in the repository file, then maybe the repository file itself has no errors, but the test file's errors are caused by how the repository exposes things?

Let me think again. The errors are:
1. `test/tenant.spec.ts(90,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.`
2. `test/tenant.spec.ts(101,25): error TS2349: This expression is not callable. Type '{ default: SuperTestStatic; ... }' has no call signatures.`
3. `test/tenant.spec.ts(114,18): error TS2322: Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | ...'`

These are all in the test file. The task says to fix what these messages require of `src/customer/customer.repository.ts`.

Hmm, but if the errors are in the test file, how would changing the repository fix them? Unless...

Wait, I think I need to reconsider. The task says "These are the compiler's exact messages for the whole workspace — not a summary of them." And then says "Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file."

So the implication is that the repository file needs to be written in a way that makes the test file compile. But the errors in the test file are about:
1. `request` not being callable — this is a supertest import issue in the test
2. `prisma.tenant.create({ data: { ... } })` with wrong types
3. `prisma.tenant.findUnique({ where: 'string' })` with wrong types

None of these are directly caused by the customer repository file. They're about the test's own usage of Prisma and supertest.

But wait — maybe the issue is that the test file imports something from the repository, or the repository's types are being used in the test. Let me think about what the test might be doing...

Actually, I think I'm overcomplicating this. Let me re-read the task:

"Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file."

The key phrase is "fixing what these messages require of this file." If the messages don't require anything of this file (because they're all in the test file), then I just need to write the correct repository file based on what the service expects.

Looking at `customer.service.ts`, the repository needs:
- `create(data: { email: string; name: string | null })` → returns a customer
- `findMany()` → returns customers
- `findById(id: string)` → returns customer or null/undefined
- `update(id: string, data: { email: string; name: string | null })` → returns customer
- `delete(id: string)` → void/void

The repository should use the `TenantPrismaService` (the tenant-scoped Prisma client) rather than the raw `PrismaClient`, because the whole point is that the tenant scoping is handled by the extension.

Wait, but looking at the `TenantPrismaService`, it exposes `customer`, `plan`, `order`, and `tenant` getters. So the repository should inject `TenantPrismaService` and use `this.tenantPrisma.customer` for operations.

But wait — the `TenantPrismaService` is `Scope.REQUEST`. So the repository also needs to be request-scoped? Or does NestJS handle that?

Actually, in NestJS, if a provider depends on a request-scoped provider, it must itself be request-scoped (or transient). So the `CustomerRepository` should also be `@Injectable({ scope: Scope.REQUEST })`.

Now, about the test errors — they're in the test file and they're about:
1. supertest `request` not being callable — this is a test file issue (probably `import request from 'supertest'` vs `import * as request from 'supertest'` or similar)
2. Prisma type mismatches in the test's direct Prisma usage

None of these are fixable by changing `customer.repository.ts`. The test file has its own bugs.

So my task is simply: write the correct `customer.repository.ts` that:
1. Compiles without errors itself
2. Satisfies the interface expected by `CustomerService`
3. Uses the `TenantPrismaService` for tenant-scoped operations

Let me write it:

```typescript
import { Injectable, Scope } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface CustomerCreateInput {
  email: string;
  name: string | null;
}

export interface CustomerUpdateInput {
  email: string;
  name: string | null;
}

@Injectable({ scope: Scope.REQUEST })
export class CustomerRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(data: CustomerCreateInput) {
    return this.tenantPrisma.customer.create({ data });
  }

  async findMany() {
    return this.tenantPrisma.customer.findMany();
  }

  async findById(id: string) {
    return this.tenantPrisma.customer.findUnique({ where: { id } });
  }

  async update(id: string, data: CustomerUpdateInput) {
    return this.tenantPrisma.customer.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.tenantPrisma.customer.delete({ where: { id } });
  }
}
```

Wait, but will this compile? The `TenantPrismaService` exposes `customer` as a getter that returns `this.client.customer`. The `client` is typed as `PrismaClient` (via the `as unknown as PrismaClient` cast). So `this.client.customer` would be the standard Prisma delegate with all the standard methods.

But there's a subtlety: the Prisma extension modifies the behavior at runtime, but the TypeScript types remain those of the standard `PrismaClient`. So from a type perspective, `this.tenantPrisma.customer.create({ data })` would have the standard Prisma types.

The `TenantPrismaService` does `as unknown as PrismaClient`, so the types will be the standard Prisma client types. This means `customer.create({ data: { email, name } })` should work if the schema has those fields.

Now, the question is: does the test file's errors relate to the repository at all? Let me look again...

The test errors are:
- Lines 90, 93, 96: `Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'` — this is `prisma.tenant.create({ data: { customers: <string> } })` in the test
- Lines 101, 117, 131, 152, 167, 176, 187, 217, 222: `request` not callable — supertest import issue
- Lines 114, 128, 149: `Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput>...)'` — `prisma.tenant.findUnique({ where: <string> })` in the test

None of these are in `customer.repository.ts`. They're all in `test/tenant.spec.ts`.

So the task is asking me to write `customer.repository.ts` in a way that's correct, acknowledging that the test file has its own bugs that can't be fixed from the repository file.

Let me also consider: could the test file be importing something from the repository that causes type issues? For example, if the test imports a type from the repository and uses it incorrectly? That's possible but unlikely given the error messages don't reference the repository.

I'll write the repository file correctly based on what the service expects, and add an ASSUMPTION line about the test file errors being unrelated to this file.

Actually wait, let me reconsider. The `TenantPrismaService` has a `customer` getter. But the type of `this.client` is `PrismaClient` (due to the cast). So `this.client.customer` has the type of the standard Prisma `CustomerDelegate`. The methods would be:
- `create(args: { data: CustomerCreateInput })`
- `findMany(args?: { where?: CustomerWhereInput, ... })`
- `findUnique(args: { where: CustomerWhereUniqueInput, ... })`
- `update(args: { where: CustomerWhereUniqueInput, data: CustomerUpdateInput })`
- `delete(args: { where: CustomerWhereUniqueInput })`

This should all work fine.

One thing to note: since `TenantPrismaService` is request-scoped, the `CustomerRepository` must also be request-scoped.

Let me finalize my answer.
```

## reply

```typescript
import { Injectable, Scope } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface CustomerCreateInput {
  email: string;
  name: string | null;
}

export interface CustomerUpdateInput {
  email: string;
  name: string | null;
}

@Injectable({ scope: Scope.REQUEST })
export class CustomerRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(data: CustomerCreateInput) {
    return this.tenantPrisma.customer.create({ data });
  }

  async findMany() {
    return this.tenantPrisma.customer.findMany();
  }

  async findById(id: string) {
    return this.tenantPrisma.customer.findUnique({ where: { id } });
  }

  async update(id: string, data: CustomerUpdateInput) {
    return this.tenantPrisma.customer.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.tenantPrisma.customer.delete({ where: { id } });
  }
}
```
