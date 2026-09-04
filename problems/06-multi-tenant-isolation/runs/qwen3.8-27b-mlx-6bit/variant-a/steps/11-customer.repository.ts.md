# 11-customer.repository.ts

## reasoning

```
Let me analyze what's needed for `src/customer/customer.repository.ts` based on the plan.

From the plan, section 3:

```ts
export interface NewCustomerRow { email: string; name: string | null; }
export interface UpdateCustomerRow { email?: string; name?: string | null; }

export class CustomerRepository {
  constructor(prisma: PrismaService);   // uses prisma.scoped.customer
  list(): Promise<Customer[]>;
  create(data: NewCustomerRow): Promise<Customer>;          // tenantId omitted; guard stamps it
  findById(id: string): Promise<Customer | undefined>;      // findFirst { where:{ id } }
  update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>;
  delete(id: string): Promise<number>;                       // rows deleted, 0 if none in tenant
}
```

Key points:
- Uses `prisma.scoped.customer` (the tenant-aware client)
- Never passes tenantId manually (the guard handles it)
- `findById` uses `findFirst` with `{ where: { id } }` (not `findUnique`) because the guard injects `where.tenantId` and Prisma forbids non-unique fields in `findUnique` where
- `list()` calls `findMany`
- `create(data)` calls `create({ data })` — tenantId is omitted, the guard stamps it
- `update(id, data)` calls `findFirst` or `update`? Let me think... The plan says `update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>`. It should return the updated row or undefined. So it could do an `update` and if not found (P2025), return undefined. Or it could do a `findFirst` then check. But the plan says the guard handles scoping for `update` action by injecting `where.tenantId`. So calling `prisma.scoped.customer.update({ where: { id }, data })` would have the guard add `tenantId` to the where clause. But if no row is found, Prisma throws P2025. So we need to catch that and return undefined.

Actually, looking more carefully at the plan:
- `update` action in the guard: `args.where = { ...args.where, tenantId: ctx.tenantId }` — so the guard handles `update` by adding tenantId to where.
- The repository method should call `prisma.scoped.customer.update({ where: { id }, data })` and if it throws P2025 (record not found), return undefined.

Wait, but the plan says `update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>`. It returns undefined if not found. So we need to handle the case where the row doesn't exist in this tenant.

For `delete`: returns `Promise<number>` — "rows deleted, 0 if none in tenant". This suggests using `deleteMany` or catching the error from `delete`. Actually, looking at the guard table:
- `delete` action: `args.where = { ...args.where, tenantId: ctx.tenantId }`
- `deleteMany` action: same

If we use `delete`, it throws P2025 if not found. If we use `deleteMany`, it returns a count. Since the plan says "rows deleted, 0 if none in tenant", `deleteMany` makes more sense — it returns `{ count }`.

Wait, but the plan lists both `delete` and `deleteMany` in the guard. Let me re-read: "scope-by-id writes | `update`, `updateMany`, `upsert`, `delete`, `deleteMany`". So both are supported.

Given the return type is `Promise<number>` and "rows deleted, 0 if none in tenant", I'll use `deleteMany` which naturally returns a count without throwing.

Actually wait — `deleteMany` with `{ where: { id } }` would work fine. The guard adds `tenantId` to the where, and it returns `{ count: 0 }` if no matching row exists in this tenant.

For `update`, I need to handle the not-found case. I could:
1. Use `update` and catch P2025
2. Use `findFirst` first to check existence, then `update`

Option 1 is simpler and more atomic. Let me use that — call `prisma.scoped.customer.update({ where: { id }, data })` and catch the Prisma P2025 error, returning undefined.

Actually, let me reconsider. The plan says the service layer handles the "not found" logic (it throws `resourceNotFound`). But the repository returns `Customer | undefined`. So the repository should return undefined for not-found cases, and the service decides what to do with that.

For `update`, I'll use `update` and catch P2025 to return undefined.
For `delete`, I'll use `deleteMany` to get the count naturally.

Let me also think about imports:
- `PrismaService` from `../db/prisma.service`
- `Injectable` from `@nestjs/common`
- The `Customer` type — this would come from `@prisma/client`. Let me check... The plan references `Customer` as a type. In Prisma, after generating the client, you can import `Customer` from `@prisma/client`.

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';

export interface NewCustomerRow {
  email: string;
  name: string | null;
}

export interface UpdateCustomerRow {
  email?: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Customer[]> {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow): Promise<Customer> {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string): Promise<Customer | undefined> {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined> {
    try {
      return await this.prisma.scoped.customer.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return undefined;
      }
      throw e;
    }
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```

Wait, I need to think about whether `Prisma` is actually exported from `@prisma/client`. Yes, it is — `Prisma.PrismaClientKnownRequestError` is the standard way to check for Prisma errors.

Let me double-check the plan's signature: `update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>` — yes, returns the row or undefined.

And `delete(id: string): Promise<number>` — "rows deleted, 0 if none in tenant" — using `deleteMany` is the cleanest way to get a count without error handling.

This looks good. Let me finalize it.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';

export interface NewCustomerRow {
  email: string;
  name: string | null;
}

export interface UpdateCustomerRow {
  email?: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Customer[]> {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow): Promise<Customer> {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string): Promise<Customer | undefined> {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined> {
    try {
      return await this.prisma.scoped.customer.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return undefined;
      }
      throw e;
    }
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```
