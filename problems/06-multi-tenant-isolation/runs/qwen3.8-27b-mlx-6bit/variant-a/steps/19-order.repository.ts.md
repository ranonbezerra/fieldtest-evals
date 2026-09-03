# 19-order.repository.ts

## reasoning

```
Let me analyze what I need to write for `src/order/order.repository.ts`.

From the plan:
- The repository pattern is applied to customer, plan, order
- `OrderRepository` has the same shape as `CustomerRepository`:
  ```ts
  export declare class OrderRepository {
    constructor(private readonly db: TenantPrismaService);
    list(): Promise<Order[]>;
    findById(id: string): Promise<Order | null>;
    create(input: CreateOrderInput): Promise<Order>;
    update(id: string, input: UpdateOrderInput): Promise<Order>;
    delete(id: string): Promise<void>;
  }
  ```

- Repositories never reference `tenantId` in their parameters or bodies.
- The repository calls `TenantPrismaService` model methods. The extension transparently injects `tenantId`.

From the order DTO (read-only reference):
```ts
export interface CreateOrderInput {
  customerId: string;
  planId: string;
  status?: string;
  totalCents: number;
}

export interface UpdateOrderInput {
  customerId?: string;
  planId?: string;
  status?: string;
  totalCents?: number;
}

export interface Order {
  id: string;
  customerId: string;
  planId: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
}
```

From the tenant-prisma service (read-only reference), it exposes `customer`, `plan`, `order` getters that return the extended model delegates.

Now, looking at the plan more carefully:
- The repository uses `TenantPrismaService` (imported as `db`)
- For orders, the model delegate would be `this.db.order`

The plan says:
- `list()` → `findMany`
- `findById(id)` → `findUnique` (returns null if not found)
- `create(input)` → `create`
- `update(id, input)` → `update`
- `delete(id)` → `delete`

Wait, looking at the plan's description of TenantPrismaService:
- "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

But looking at the actual implementation in the read-only reference, the `TenantPrismaService` handles P2025 errors (record not found for update/delete) and converts them to `ResourceNotFoundError`. So the repository can just call the methods and let the service handle the error.

Wait, but `findUnique` returns null if not found - it doesn't throw P2025. So `findById` should just return the result of `findUnique` (which will be null if not found).

For `update` and `delete`, the tenant-prisma service catches P2025 and throws `ResourceNotFoundError`. So the repository just calls the method.

Let me think about what imports I need:
- `Injectable` from `@nestjs/common`
- `TenantPrismaService` from `../multi-tenant/tenant-prisma.service.js`
- Types from `./dto.js`: `CreateOrderInput`, `UpdateOrderInput`, `Order`

Now for the actual Prisma calls:
- `list()`: `this.db.order.findMany()` - returns all orders for the tenant (tenantId injected by extension)
- `findById(id)`: `this.db.order.findUnique({ where: { id } })` - returns Order or null
- `create(input)`: `this.db.order.create({ data: input })` - tenantId injected by extension
- `update(id, input)`: `this.db.order.update({ where: { id }, data: input })` - tenantId injected by extension into where
- `delete(id)`: `this.db.order.delete({ where: { id } })` - tenantId injected by extension into where

Wait, but the plan says "Repositories never reference `tenantId` in their parameters or bodies." So I should NOT explicitly pass tenantId. The extension handles it.

Let me also think about whether the return types need to be mapped. Looking at the Prisma schema, the fields are:
- id, tenantId, customerId, planId, status, totalCents, createdAt, updatedAt

The DTO `Order` interface has: id, customerId, planId, status, totalCents, createdAt, updatedAt (no tenantId).

Hmm, but the plan's repository signature says:
```ts
list(): Promise<Order[]>;
findById(id: string): Promise<Order | null>;
create(input: CreateOrderInput): Promise<Order>;
update(id: string, input: UpdateOrderInput): Promise<Order>;
delete(id: string): Promise<void>;
```

The Prisma client will return the full model including `tenantId`. But the DTO `Order` doesn't include `tenantId`. 

Looking at this more carefully - in a real implementation, the repository would either:
1. Return the Prisma model directly (which includes tenantId), or
2. Map it to the DTO shape

But the plan says the repository returns `Order` (the DTO type). However, the Prisma client returns a type that includes `tenantId`. 

Actually, looking at this pragmatically - the plan defines the return type as `Order` from the DTO. In TypeScript, if the Prisma model has extra fields, it's still structurally compatible with `Order` (extra properties are fine in TypeScript for return types). So I can just return the Prisma result directly and it will be assignable to `Order`.

Wait, actually that's not quite right. TypeScript structural typing means that a type with MORE properties IS assignable to a type with FEWER properties. So `{ id: string, tenantId: string, customerId: string, ... }` IS assignable to `{ id: string, customerId: string, ... }`. So returning the Prisma result directly works.

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Order[]> {
    return this.db.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.db.order.findUnique({ where: { id } });
  }

  async create(input: CreateOrderInput): Promise<Order> {
    return this.db.order.create({ data: input });
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.db.order.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.order.delete({ where: { id } });
  }
}
```

Wait, I need to think about whether `TenantPrismaService` methods return properly typed results. Looking at the read-only reference:

```ts
get order() {
  return this.getExtendedClient().order;
}
```

And `getExtendedClient()` returns `ReturnType<PrismaService['$extends']>`. The `$extends` method in Prisma returns a client with the same model delegates. So `this.db.order.findMany()` should return `Promise<Prisma.Order[]>` or similar.

The issue is that the return type of `this.db.order.findMany()` from Prisma's perspective includes `tenantId`, but our DTO `Order` doesn't. As I discussed, TypeScript allows this due to structural typing (a type with more properties is assignable to one with fewer).

Actually wait - let me reconsider. The `TenantPrismaService` getters return the extended model delegates. The type of these delegates would be whatever Prisma's `$extends` produces. In practice, with Prisma's `$extends`, the returned delegates maintain the same types as the original. So `this.db.order.findMany()` returns `Promise<Prisma.OrderGetPayload<...>[]>` which includes all fields including `tenantId`.

Since TypeScript is structurally typed, returning a value with extra properties where fewer are expected is fine. So `return this.db.order.findMany()` is assignable to `Promise<Order[]>` as long as all required properties of `Order` are present in the Prisma result.

Let me verify: `Order` requires `id`, `customerId`, `planId`, `status`, `totalCents`, `createdAt`, `updatedAt`. The Prisma model has all of these plus `tenantId`. So it's assignable.

This looks correct. Let me also consider if I need any special handling for the `delete` method. The plan says:
- "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

But looking at the actual implementation, it's P2025 that triggers `ResourceNotFoundError` for update/delete. The repository doesn't need to do anything special - it just calls the method and if the record isn't found (cross-tenant), the extension throws `ResourceNotFoundError`.

For `findById`, `findUnique` returns `null` if not found (it doesn't throw). So the repository just returns whatever `findUnique` gives back.

I think my implementation is correct. Let me finalize it.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Order[]> {
    return this.db.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.db.order.findUnique({ where: { id } });
  }

  async create(input: CreateOrderInput): Promise<Order> {
    return this.db.order.create({ data: input });
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.db.order.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.order.delete({ where: { id } });
  }
}
```
