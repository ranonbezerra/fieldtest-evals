# 14-plan.repository.ts

## reasoning

```
Let me analyze what's needed for `src/plan/plan.repository.ts` based on the plan and references.

From the plan:
- `PlanRepository` is in `src/plan/plan.repository.ts`
- It reads from: `src/multi-tenant/tenant-prisma.service.ts`, `src/plan/dto.ts`
- It has the shape:
  ```ts
  export declare class PlanRepository {
    constructor(private readonly db: TenantPrismaService);
    list(): Promise<Plan[]>;
    findById(id: string): Promise<Plan | null>;
    create(input: CreatePlanInput): Promise<Plan>;
    update(id: string, input: UpdatePlanInput): Promise<Plan>;
    delete(id: string): Promise<void>;
  }
  ```

From the DTO reference:
- `CreatePlanInput` has `name: string`, `priceCents: number`
- `UpdatePlanInput` has `name?: string`, `priceCents?: number`
- `Plan` has `id: string`, `name: string`, `priceCents: number`, `createdAt: Date`, `updatedAt: Date`

From the tenant-prisma.service.ts reference:
- It exposes `.plan` which is a scoped model delegate
- The plan delegate would have standard Prisma methods: `findMany`, `findFirst`, `create`, `update`, `delete`

The repository should:
- Use `TenantPrismaService` (imported from `src/multi-tenant/tenant-prisma.service.ts`)
- Never pass tenantId manually (the extension handles it)
- Use ESM imports with `.js` extension (as seen in the reference file)
- Follow the naming conventions (snake_case columns via Prisma @map)

Looking at the plan's model for plans:
- `price_cents` is mapped from `priceCents`

The repository methods:
1. `list()` → `this.db.plan.findMany()`
2. `findById(id)` → `this.db.plan.findFirst({ where: { id } })` or `findUnique`. Since the tenant extension injects tenantId into where, using `findUnique` with `{ id }` would become `{ id, tenantId }` which works. But `findFirst` is safer since `findUnique` with a non-unique field (after adding tenantId) might behave differently. Actually, looking at the extension code, for `findUnique` it does `args.where = { ...args.where, tenantId }`. So if we pass `{ where: { id } }`, it becomes `{ where: { id, tenantId } }`. But `findUnique` expects the where to be a unique identifier. Adding tenantId to it might cause issues because Prisma's `findUnique` expects only the unique fields. Actually, looking more carefully at the extension - it uses `$allOperations` which intercepts all operations. For `findUnique`, adding tenantId to where would make it `{ id: string, tenantId: string }` which is actually a valid unique lookup since we have `@@unique([tenantId, ...])`... wait, no. The plan says the unique constraint on plans is just the PK `id`. There's no composite unique on plans.

Actually, let me reconsider. The extension injects tenantId into `args.where` for findUnique. So if we call `findUnique({ where: { id } })`, it becomes `findUnique({ where: { id, tenantId } })`. In Prisma, `findUnique` requires the where clause to match a unique field or compound unique. Since `id` is the PK (unique) and we're adding `tenantId` which is not part of a unique constraint with `id`, this would actually fail at the Prisma level.

Wait, but looking at the extension code more carefully - it just spreads `tenantId` into the where object. For `findUnique`, Prisma validates that the where matches a unique input type. If we pass `{ id, tenantId }` and there's no composite unique `[id, tenantId]`, Prisma would throw a validation error.

So it's better to use `findFirst({ where: { id } })` which would become `findFirst({ where: { id, tenantId } })` - this works fine as a regular query.

Actually, let me look at the plan again. It says:
```
findById(id: string): Promise<Plan | null>;
```

The return type is `Plan | null`, which suggests using `findFirst` (returns null) rather than `findUniqueOrThrow`.

For `update` and `delete`, the extension handles P2025 (no record found) and throws ResourceNotFoundError. So the repository can just call them directly.

Let me also check - the plan says `delete(id: string): Promise<void>`. So we need to handle the return value.

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    return this.db.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.db.plan.findFirst({ where: { id } });
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    return this.db.plan.create({ data: input });
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.db.plan.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.order.delete({ where: { id } });
  }
}
```

Wait, that last line should be `this.db.plan.delete`. Let me fix that.

Also, I need to think about whether the DTO types match what Prisma returns. The `Plan` interface has `createdAt: Date` and `updatedAt: Date`. Prisma returns `Date` objects for DateTime fields, so that's fine.

The `CreatePlanInput` has `name` and `priceCents`. In the database, it's mapped to `name` and `price_cents`. Prisma's create takes the camelCase field names (as defined in the schema), so `priceCents` is correct for the input.

Similarly, `UpdatePlanInput` with optional fields maps directly to Prisma's update data.

One concern: the `update` method with `data: input` where input is `UpdatePlanInput` - if both fields are undefined, Prisma might complain about empty data. But that's a service-level validation concern, not a repository concern. The plan says the repository just passes through.

Let me also make sure I'm using `findFirst` vs `findUnique`. Looking at the extension:
- For `findUnique`: it adds tenantId to where. If the original where is `{ id }`, it becomes `{ id, tenantId }`. This would fail in Prisma unless there's a compound unique.
- For `findFirst`: it adds tenantId to where. `{ id, tenantId }` is a valid filter.

So `findFirst` is the safe choice for findById. The plan's signature returns `Plan | null` which aligns with `findFirst`.

For `update` and `delete`: the extension adds tenantId to where. For `update({ where: { id }, data })` it becomes `update({ where: { id, tenantId }, data })`. Same issue as findUnique - does Prisma's `update` accept non-unique where? Actually, `update` in Prisma requires a unique where clause too! It uses the same `WhereUniqueInput`.

Hmm, but looking at the reference implementation of tenant-prisma.service.ts, it does:
```ts
case 'update':
case 'updateMany':
case 'delete':
case 'deleteMany':
  args.where = { ...(args.where as object | undefined), tenantId };
  break;
```

So it's adding tenantId to the where for update/delete. If we pass `{ where: { id } }`, it becomes `{ where: { id, tenantId } }`. For Prisma's `update` and `delete`, the where must be a unique identifier. If there's no compound unique on `[id, tenantId]`, this would fail.

Wait, but looking at the schema in the plan - plans only has `id` as PK. There's no explicit compound unique mentioned for plans. However, since every row has a unique `id` (UUID), adding `tenantId` to the where should still work as a filter... but Prisma's type system for `update`/`delete` requires a `WhereUniqueInput`.

Actually, I think in practice this works because Prisma's runtime is more permissive than the type system in some cases, OR the extension is designed to work with this pattern where the tenant-scoping effectively makes the query safe. Since this is the reference implementation that was already written and presumably tested, I should just follow the same pattern.

Actually, I just realized - the `tenant-prisma.service.ts` is a reference file that was ALREADY written. It's part of the workspace. So I just need to use it as-is. The `findUnique`/`update`/`delete` with the injected tenantId is how the system works. I should just use `findUnique` for findById since that's the most natural Prisma pattern, OR use `findFirst` to be safe.

Looking at the plan's repository shape:
```
findById(id: string): Promise<Plan | null>;
```

The `| null` return suggests it could return null, which both `findFirst` and `findUnique` do. But given the extension adds tenantId to where, using `findFirst` is safer (no type validation issues with compound unique).

Let me go with `findFirst` for safety. The plan doesn't specify which Prisma method to use internally - it only specifies the public API.

Final answer:
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    return this.db.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.db.plan.findFirst({ where: { id } });
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    return this.db.plan.create({ data: input });
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.db.plan.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.plan.delete({ where: { id } });
  }
}
```
