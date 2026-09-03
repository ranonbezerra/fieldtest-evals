# repair1-plan.repository.ts

## reasoning

```
Let me analyze the compiler errors for `src/plan/plan.repository.ts`:

```
src/plan/plan.repository.ts(10,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(14,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(18,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(22,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(26,11): error TS2571: Object is of type 'unknown'.
```

These are all "Object is of type 'unknown'" errors. This means the methods on `TenantPrismaService` are returning `unknown` (as defined in the PLAN.md's `TenantScopedModel` interface which returns `Promise<unknown>`).

Looking at the PLAN.md, the `TenantScopedModel<T>` interface is defined as:
```ts
export interface TenantScopedModel<T> {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findUnique(args: Record<string, unknown>): Promise<unknown | null>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
  count(args?: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
}
```

So `findMany` returns `Promise<unknown[]>`, `findUnique` returns `Promise<unknown | null>`, etc. When the repository tries to use these results (e.g., access `.id` or map them), TypeScript complains because they're `unknown`.

The fix is to cast the results to the appropriate DTO types in the repository. The repository should cast `unknown[]` to `Plan[]`, `unknown | null` to `Plan | null`, etc.

Let me look at what the plan repository needs:
- `list(): Promise<Plan[]>` — calls `this.db.plan.findMany()` which returns `Promise<unknown[]>`, needs to cast to `Plan[]`
- `findById(id: string): Promise<Plan | null>` — calls `this.db.plan.findUnique({ where: { id } })` which returns `Promise<unknown | null>`, needs to cast to `Plan | null`
- `create(input: CreatePlanInput): Promise<Plan>` — calls `this.db.plan.create({ data: input })` which returns `Promise<unknown>`, needs to cast to `Plan`
- `update(id: string, input: UpdatePlanInput): Promise<Plan>` — calls `this.db.plan.update({ where: { id }, data: input })` which returns `Promise<unknown>`, needs to cast to `Plan`
- `delete(id: string): Promise<void>` — calls `this.db.plan.delete({ where: { id } })` which returns `Promise<unknown>`, needs to handle

Looking at the line numbers:
- Line 10, col 12: likely `this.db.plan.findMany()` result being used
- Line 14, col 12: likely `this.db.plan.findUnique()` result
- Line 18, col 12: likely `this.db.plan.create()` result
- Line 22, col 12: likely `this.db.plan.update()` result
- Line 26, col 11: likely `this.db.plan.delete()` result

The fix is straightforward: cast the results with type assertions. Let me write the complete file:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service';
import { Plan, CreatePlanInput, UpdatePlanInput } from './dto';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    const rows = await this.db.plan.findMany();
    return rows as Plan[];
  }

  async findById(id: string): Promise<Plan | null> {
    const row = await this.db.plan.findUnique({ where: { id } });
    return row as Plan | null;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    const row = await this.db.plan.create({ data: input });
    return row as Plan;
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    const row = await this.db.plan.update({ where: { id }, data: input });
    return row as Plan;
  }

  async delete(id: string): Promise<void> {
    await this.db.plan.delete({ where: { id } });
  }
}
```

Wait, let me think about line numbers more carefully. The errors are at lines 10, 14, 18, 22, 26. Let me count what a typical file would look like:

Line 1: import
Line 2: import
Line 3: (blank)
Line 4: export class PlanRepository {
Line 5:   constructor(...) {}
Line 6: (blank)
Line 7:   async list(): Promise<Plan[]> {
Line 8:     const rows = await this.db.plan.findMany();
Line 9:     ...
Line 10: (something with unknown)

Hmm, let me think differently. The column is 12 for most of them. That suggests something like `return this.db...` where the expression starts at column 12 (after `    return ` which is 4 spaces + "return " = 11 chars, so column 12). Or `const x = await` where the await result is at column 12.

Actually wait - if the original code was doing something like:
```ts
return this.db.plan.findMany();  // line with col 12 being the `this`
```

No, column 12... Let me count: `    return this.db.plan.findMany()` - that's 4 spaces (cols 1-4), `return` (cols 5-10), space (col 11), `this` (cols 12-15). So column 12 is where `this` starts. That means the error is on the expression `this.db.plan.findMany()` being of type `unknown`.

Wait no - TS2571 says "Object is of type 'unknown'" which means you're trying to access a property on something typed as `unknown`. So it's not the return itself, it's using the result.

Let me reconsider. If the code is:
```ts
async list(): Promise<Plan[]> {
  const rows = await this.db.plan.findMany();
  return rows.map(r => r); // accessing property on unknown
}
```

Or maybe:
```ts
async list(): Promise<Plan[]> {
  return this.db.plan.findMany(); // unknown[] not assignable to Plan[]
}
```

Actually TS2571 is specifically "Object is of type 'unknown'" - this happens when you try to access a member of `unknown`. So the code must be doing something like `result.something` where result is unknown.

Hmm, but if the return type is `Promise<unknown[]>` and you're returning it as `Promise<Plan[]>`, that would be TS2322 (type not assignable), not TS2571.

TS2571 means you're doing property access on an unknown value. So the original code probably does something like:
```ts
const rows = await this.db.plan.findMany();
return rows.map(r => ({ id: r.id, ... })); // r is unknown
```

Or for `findUnique`:
```ts
const row = await this.db.plan.findUnique({ where: { id } });
return row ? { id: row.id, ... } : null; // row is unknown
```

So the fix is to cast appropriately. Let me write it with casts:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service';
import { Plan, CreatePlanInput, UpdatePlanInput } from './dto';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    const rows = (await this.db.plan.findMany()) as Plan[];
    return rows;
  }

  async findById(id: string): Promise<Plan | null> {
    const row = (await this.db.plan.findUnique({ where: { id } })) as Plan | null;
    return row;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    const row = (await this.db.plan.create({ data: input })) as Plan;
    return row;
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    const row = (await this.db.plan.update({ where: { id }, data: input })) as Plan;
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.plan.delete({ where: { id } });
  }
}
```

Wait, for `delete` - the return type is `Promise<unknown>` from the interface. If we just do `await this.db.plan.delete(...)` and don't access any property on the result, there shouldn't be a TS2571 error. But the error at line 26, col 11 says there is one. Column 11... `    await this.db.plan.delete(...)` - 4 spaces + "await " = 10 chars, so col 11 is `this`. Hmm, but if we're just awaiting it and not accessing properties, why would there be a TS2571?

Unless the original code does something like:
```ts
async delete(id: string): Promise<void> {
  const result = await this.db.plan.delete({ where: { id } });
  // maybe checking something on result?
}
```

Or maybe the original code was:
```ts
async delete(id: string): Promise<void> {
  return this.db.plan.delete({ where: { id } });
}
```

And `Promise<unknown>` is not assignable to `Promise<void>`? No, that would be a different error.

Actually, I think the simplest interpretation is: the original code had all five methods accessing properties on the unknown results, and the fix is to cast them. For `delete`, maybe it was accessing the count or something.

Let me just write clean code that compiles. The key insight is: `TenantScopedModel` methods return `unknown` or `unknown[]`, so we need type assertions to get our DTO types back.

Let me write the final version:
```

## reply

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service';
import { Plan, CreatePlanInput, UpdatePlanInput } from './dto';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    const rows = (await this.db.plan.findMany()) as Plan[];
    return rows;
  }

  async findById(id: string): Promise<Plan | null> {
    const row = (await this.db.plan.findUnique({ where: { id } })) as Plan | null;
    return row;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    const row = (await this.db.plan.create({ data: input })) as Plan;
    return row;
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    const row = (await this.db.plan.update({ where: { id }, data: input })) as Plan;
    return row;
  }

  async delete(id: string): Promise<void> {
    await (this.db.plan.delete({ where: { id } }) as Promise<unknown>);
  }
}
```
