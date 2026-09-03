# repair2-plan.repository.ts

## reasoning

```
Let me analyze the compiler errors that affect `src/plan/plan.repository.ts`:

1. `src/plan/plan.repository.ts(1,37): error TS2307: Cannot find module '../multi-tenant/tenant-prisma.service' or its corresponding type declarations.`
   - The import path is wrong. It's using `../multi-tenant/tenant-prisma.service` but the file structure shows it should be `../../multi-tenant/tenant-prisma.service.js` (going up two levels from `src/plan/` to `src/`, then into `multi-tenant/`).

Wait, let me re-read the layout:
```
src/<feature>/<feature>.repository.ts
```

So `src/plan/plan.repository.ts` is at `src/plan/plan.repository.ts`. The multi-tenant module is at `src/multi-tenant/`. So from `src/plan/`, to get to `src/multi-tenant/`, you go `../multi-tenant/`. That's correct path-wise.

But the error says "Cannot find module '../multi-tenant/tenant-prisma.service'" - this is because with `node16`/`nodenext` module resolution, you need explicit file extensions (`.js`). So it should be `../multi-tenant/tenant-prisma.service.js`.

2. `src/plan/plan.repository.ts(2,56): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto.js'?`
   - The import of `./dto` needs to be `./dto.js`.

So the fixes for `src/plan/plan.repository.ts` are:
- Change import of `../multi-tenant/tenant-prisma.service` to `../multi-tenant/tenant-prisma.service.js`
- Change import of `./dto` to `./dto.js`

Now, the TS2307 error for `'../multi-tenant/tenant-prisma.service'` - even with the `.js` extension, will it still fail? The error says "Cannot find module" which means the file doesn't exist or can't be resolved. But looking at the other errors, `src/multi-tenant/tenant-prisma.service.ts` exists (it has its own errors listed). So the file does exist, it's just that the import path needs the `.js` extension for `node16`/`nodenext`.

Wait, but if I add `.js` extension, will TypeScript resolve it? Yes - with `moduleResolution: node16` or `nodenext`, TypeScript expects `.js` extensions in imports and will resolve them to the corresponding `.ts` files.

Now let me write the file based on the PLAN.md:

From the plan:
```ts
// src/plan/plan.repository.ts
export declare class PlanRepository {
  constructor(private readonly db: TenantPrismaService);
  list(): Promise<Plan[]>;
  findById(id: string): Promise<Plan | null>;
  create(input: CreatePlanInput): Promise<Plan>;
  update(id: string, input: UpdatePlanInput): Promise<Plan>;
  delete(id: string): Promise<void>;
}
```

The repository never references `tenantId` in its parameters or bodies. It uses `TenantPrismaService` which transparently scopes everything.

For update/delete, if 0 rows are affected, throw `ResourceNotFoundError`.

Let me write this:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';
import { ResourceNotFoundError } from '../multi-tenant/errors.js';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    return this.db.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.db.plan.findUnique({ where: { id } });
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    return this.db.plan.create({ data: input });
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    const result = await this.db.plan.update({ where: { id }, data: input });
    if (!result) {
      throw new ResourceNotFoundError('plan');
    }
    return result;
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.plan.delete({ where: { id } });
    if (!result) {
      throw new ResourceNotFoundError('plan');
    }
  }
}
```

Wait, looking at the plan more carefully: "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is handled by the `TenantPrismaService` extension itself. So the repository just calls the methods and the extension handles the scoping. But what about the 404 case? The plan says the extension throws `ResourceNotFoundError` if row count is 0.

Hmm, but then the repository wouldn't need to check for null/undefined. Let me re-read:

"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

So the extension itself throws. But for `findUnique`, it would return null if not found (that's normal Prisma behavior). The service layer would then need to handle the null case.

Actually, looking at the plan again for the repository:
```
findById(id: string): Promise<Plan | null>;
```

So `findById` returns null, and the service handles converting that to a 404. For update/delete, the extension throws `ResourceNotFoundError` directly.

But wait - in a standard Prisma `update`, if the record doesn't exist, it throws `P2025` (Record to update not found). The extension would need to catch that and convert it. But the plan says the extension handles this by checking row count... Actually Prisma's `update` throws on not-found, it doesn't return 0. So the extension would need to catch the P2025 error.

For the repository, I'll keep it simple - just call the methods. The extension handles the tenant scoping and the not-found cases for update/delete. For `findById`, it returns null and the service layer handles it.

Actually, let me reconsider. The plan says:
"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is describing what the TenantPrismaService does internally. The repository just calls through to it. So the repository code is straightforward.

Let me also check - does the plan say the repository should handle the `ResourceNotFoundError` or the extension does? The plan says the extension does it. So the repository just passes through.

But wait, for `findUnique` returning null - that's fine, the service handles it. For `update` and `delete`, if the tenant-scoped where clause doesn't match, Prisma will throw P2025. The extension should catch that and rethrow as `ResourceNotFoundError`.

So my repository is correct - it just delegates to the TenantPrismaService methods. The extension handles the scoping and error conversion.

Let me finalize:
```

## reply

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    return this.db.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.db.plan.findUnique({ where: { id } });
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
