# 20-order.service.ts

## reasoning

```
Let me analyze what I need to write: `src/order/order.service.ts`

From the plan:
- `src/order/order.service.ts | reads: src/order/order.repository.ts, src/order/order.dto.ts, src/multi-tenant/errors.ts | OrderService`
- The service holds the logic. Zero raw SQL, zero Prisma client calls.
- From the control flow section: "Service: call repository method(s); map domain errors (not-found → 404, conflict → 409). No Prisma imports."
- From the ordering rules: "Unique constraint violations (e.g., same email twice in one tenant): the repository lets Prisma throw P2002; the service catches it and rethrows a ConflictError → 409"

So OrderService needs:
- Inject CustomerRepository (no wait, OrderRepository)
- Methods: list, findById, create, update, delete
- For findById/update/delete: if repository returns null or throws, handle the 404 case
- For create: catch P2002 unique constraint violations and throw ConflictError

Wait, let me look at the repository more carefully. The `findById` returns `Order | null`. The `update` and `delete` methods - the plan says "Update/delete: merge { tenantId } into args.where; if the resulting row count is 0, throw ResourceNotFoundError." But that's about TenantPrismaService behavior.

Actually wait - looking at the repository code shown:
- `findById` returns `this.db.order.findUnique({ where: { id } })` which returns `Order | null`
- `update` returns `this.db.order.update({ where: { id }, data: input })` 
- `delete` returns `this.db.order.delete({ where: { id } })`

The plan says for the TenantPrismaService: "Update/delete: merge { tenantId } into args.where; if the resulting row count is 0, throw ResourceNotFoundError."

So the TenantPrismaService handles the 404 for update/delete by throwing ResourceNotFoundError. But for findById, it returns null.

So in the service:
- `list()`: just delegate to repository
- `findById(id)`: call repo, if null throw ResourceNotFoundError('order'), else return
- `create(input)`: call repo, catch P2002 → ConflictError
- `update(id, input)`: call repo (the TenantPrismaService will throw ResourceNotFoundError if not found). Actually wait - does the service need to catch it? The plan says the TenantPrismaService throws ResourceNotFoundError. Since ResourceNotFoundError is an HttpException, it will propagate up and NestJS will handle it. So the service might just delegate.

But wait - actually, looking more carefully at the plan's description of TenantPrismaService: "Update/delete: merge { tenantId } into args.where; if the resulting row count is 0, throw ResourceNotFoundError."

So the TenantPrismaService already throws ResourceNotFoundError for update/delete when no row is affected. The service doesn't need to handle that case - it will propagate as an HttpException.

For `findById`, the repository returns null, so the service needs to check and throw.

For `create`, we need to catch P2002 (unique constraint violation). In Prisma, this would be a `Prisma.PrismaClientKnownRequestError` with code `P2002`. But the plan says "Zero Prisma client calls" in the service. However, catching an error by checking its properties isn't really a "Prisma client call" - it's error handling.

Actually, let me reconsider. The plan says the service catches P2002 and rethrows ConflictError. But how do we identify P2002 without importing Prisma? We can check the error's `code` property.

Let me write the service:

```ts
import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository.js';
import { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async list(): Promise<Order[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Order> {
    const order = await this.repo.findById(id);
    if (!order) {
      throw new ResourceNotFoundError('Order');
    }
    return order;
  }

  async create(input: CreateOrderInput): Promise<Order> {
    try {
      return await this.repo.create(input);
    } catch (err: unknown) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}
```

Wait, but the plan says for update/delete in TenantPrismaService: "if the resulting row count is 0, throw ResourceNotFoundError." So the TenantPrismaService handles the not-found case for update/delete. The service just delegates.

But actually, I need to think about this more carefully. If the TenantPrismaService throws ResourceNotFoundError (which is an HttpException with 404), it will propagate through the repository and service up to the NestJS error handler. So the service doesn't need to do anything special for update/delete.

However, there's a subtlety: what if the resource doesn't exist at all (not just in this tenant)? The TenantPrismaService scopes the query to the tenant, so if the id belongs to another tenant, the scoped query will find 0 rows and throw ResourceNotFoundError. This is correct behavior - we don't want to reveal that the resource exists in another tenant.

Let me also consider: should `update` and `delete` in the service do anything? The plan's control flow says "Service: call repository method(s); map domain errors (not-found → 404, conflict → 409)." But for update/delete, the TenantPrismaService already handles not-found. So the service is just a pass-through for those.

Actually, I realize I should double-check: does the plan say the service should handle the case where update/delete throws ResourceNotFoundError? Looking at the plan again: "Update/delete: merge { tenantId } into args.where; if the resulting row count is 0, throw ResourceNotFoundError." - This is in the TenantPrismaService section. So yes, it's handled at that layer.

The service just needs to:
1. Delegate list
2. For findById, check null and throw
3. For create, catch P2002 → ConflictError
4. For update/delete, just delegate (TenantPrismaService handles 404)

This looks correct. Let me finalize.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository.js';
import { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async list(): Promise<Order[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Order> {
    const order = await this.repo.findById(id);
    if (!order) {
      throw new ResourceNotFoundError('Order');
    }
    return order;
  }

  async create(input: CreateOrderInput): Promise<Order> {
    try {
      return await this.repo.create(input);
    } catch (err: unknown) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}
```
