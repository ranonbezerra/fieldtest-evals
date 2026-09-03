# 15-plan.service.ts

## reasoning

```
Let me analyze what's needed for `src/plan/plan.service.ts` based on the plan and references.

From the PLAN.md manifest:
- `src/plan/plan.service.ts` reads: `src/plan/plan.repository.ts`, `src/plan/dto.ts`, `src/multi-tenant/errors.ts`
- PlanService

From the plan section on ordering rules:
- Service calls repository method(s); maps domain errors (not-found → 404, conflict → 409)
- No Prisma imports
- Unique constraint violations (e.g., same email twice in one tenant): the repository lets Prisma throw `P2002`; the service catches it and rethrows a `ConflictError` → 409

From the references:
- `PlanRepository` has methods: `list()`, `findById(id)`, `create(input)`, `update(id, input)`, `delete(id)`
- DTOs: `CreatePlanInput`, `UpdatePlanInput`, `Plan`
- Errors: `ResourceNotFoundError`, `ConflictError`

The service should:
1. Delegate to repository
2. For `findById`, `update`, `delete` — if the result is null (not found), throw `ResourceNotFoundError`
3. For `create` — catch Prisma P2002 unique constraint violations and rethrow as `ConflictError`

Wait, looking at the plan more carefully:
- "Read-by-id cannot cross tenants" → 404 when tenant B fetches tenant A's plan
- The repository's `findById` uses `findFirst` which returns null if no match
- So the service needs to check for null and throw `ResourceNotFoundError`

For update/delete:
- The plan says "if the resulting row count is 0, throw `ResourceNotFoundError`" in the TenantPrismaService section
- But looking at the repository, it just calls `this.db.plan.update({ where: { id }, data: input })` and `this.db.plan.delete({ where: { id } })`
- The plan says the TenantPrismaService handles this: "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

Wait, but that's at the TenantPrismaService level. So if the tenant doesn't match, the extension would throw `ResourceNotFoundError` already? Let me re-read...

Actually looking more carefully at the plan:
- "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is in the TenantPrismaService description. So the extension itself handles the not-found for update/delete. But for `findById` (which uses `findFirst`), it returns null.

So in the service:
- `list()` → just delegate
- `findById(id)` → delegate, if null throw `ResourceNotFoundError`
- `create(input)` → delegate, catch P2002 → throw `ConflictError`
- `update(id, input)` → delegate (the extension handles not-found for update, throwing ResourceNotFoundError). But wait, does the repository return null or does the extension throw? Let me look at the repository again...

The repository's `update` just does `return this.db.plan.update({ where: { id }, data: input })`. If the extension throws `ResourceNotFoundError` when 0 rows affected, then the service doesn't need to handle it for update/delete. But if the extension just lets Prisma throw its own error (P2025), then the service needs to catch it.

Hmm, the plan says the TenantPrismaService "if the resulting row count is 0, throw `ResourceNotFoundError`". This suggests the extension itself throws. But that's in the TenantPrismaService which I'm not writing here.

Actually wait - let me re-read the plan section about TenantPrismaService more carefully:

"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is describing what the TenantPrismaService does. So when you call `this.db.plan.update(...)`, if no row matches (because tenant scoping means the where clause includes both id and tenantId), it throws `ResourceNotFoundError`.

But for `findFirst` (used by `findById`), the plan says:
"Read ops (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`): merge `{ tenantId }` into `args.where`."

It doesn't say it throws on null for reads. So `findById` would return null if not found.

So the service needs to:
- `findById`: check for null, throw `ResourceNotFoundError`
- `update`: The extension already throws `ResourceNotFoundError` if no row found. But wait, what if the repository returns null instead? Let me look at the repository's return type: `async update(id: string, input: UpdatePlanInput): Promise<Plan>` - it returns Plan, not Plan | null. So either the extension throws or Prisma throws. The service probably doesn't need to handle this case specially since the extension handles it.

Actually, I think the safest approach given the plan is:
- The service should handle the not-found case for `findById` (since it returns `Plan | null`)
- For `update` and `delete`, the plan says the TenantPrismaService throws `ResourceNotFoundError` when 0 rows affected. But what if it doesn't and instead the repository just lets Prisma throw P2025? In that case, the service should catch it.

Let me think about this differently. The plan says:
- Service: "call repository method(s); map domain errors (not-found → 404, conflict → 409). No Prisma imports."

So the service is responsible for mapping errors. This suggests:
- For `findById`: if null → throw ResourceNotFoundError
- For `update`/`delete`: if the repository somehow indicates not found → throw ResourceNotFoundError. But the repository signatures don't return null for update/delete...

I think the cleanest interpretation is:
- The TenantPrismaService extension throws `ResourceNotFoundError` for update/delete when 0 rows affected (as stated in the plan)
- For `findFirst` (findById), it returns null, so the service checks and throws
- For `create`, Prisma throws P2002 on unique constraint violation, and the service catches it

But wait - "No Prisma imports" in the service. How do I catch P2002 without importing Prisma? I can check the error code by looking at the error object's properties without importing Prisma. The Prisma client throws errors with a `code` property. I can do:

```ts
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
    throw new ConflictError();
  }
  throw err;
}
```

This doesn't require importing from Prisma.

Let me write the service:

```ts
import { Injectable } from '@nestjs/common';
import { PlanRepository } from './plan.repository.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class PlanService {
  constructor(private readonly repo: PlanRepository) {}

  async list(): Promise<Plan[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Plan> {
    const plan = await this.repo.findById(id);
    if (!plan) {
      throw new ResourceNotFoundError('plan');
    }
    return plan;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
```

Wait, but for update and delete, should the service also handle the not-found case? The plan says the TenantPrismaService throws ResourceNotFoundError for 0-row update/delete. So if that's implemented correctly, the error propagates up naturally and NestJS handles it (since ResourceNotFoundError extends HttpException with 404).

But what if the TenantPrismaService doesn't actually do that (since I'm not writing it)? The plan is my spec, so I should trust that the TenantPrismaService handles it. The service just delegates.

Actually, let me reconsider. Looking at the plan's error handling description:
"Service: call repository method(s); map domain errors (not-found → 404, conflict → 409). No Prisma imports."

This says the service maps domain errors. For update/delete, if the TenantPrismaService already throws `ResourceNotFoundError` (which is an HttpException), it would just propagate up. The service doesn't need to do anything special.

For `findById`, the repository returns `Plan | null`, so the service must check and throw.

For `create`, the service catches P2002 and throws ConflictError.

I think my implementation above is correct. Let me also consider: should `update` and `delete` in the service catch any errors from the repository? If the TenantPrismaService properly throws `ResourceNotFoundError`, then no. The error is already in the right format.

I'll go with my implementation. Let me also make sure I'm using `.js` extensions in imports since this is ESM.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { PlanRepository } from './plan.repository.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class PlanService {
  constructor(private readonly repo: PlanRepository) {}

  async list(): Promise<Plan[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Plan> {
    const plan = await this.repo.findById(id);
    if (!plan) {
      throw new ResourceNotFoundError('plan');
    }
    return plan;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
```
