# repair1-customer.repository.ts

## reasoning

```
Let me analyze the compiler errors that are specific to `src/customer/customer.repository.ts`.

Looking at the full list of errors, I need to find which ones are in `src/customer/customer.repository.ts`. Let me scan through:

The errors listed are:
- `src/tenant/tenant-resolution.middleware.ts` - multiple errors
- `src/tenant/tenant.controller.ts` - error
- `src/tenant/tenant.module.ts` - errors
- `src/tenant/tenant.repository.ts` - error
- `src/tenant/tenant.service.ts` - errors
- `test/customer-isolation.spec.ts` - errors
- `test/tenant-config.spec.ts` - errors

Wait, I don't see any error specifically in `src/customer/customer.repository.ts` in the list. Let me re-read...

The first line is cut off: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?" - this is a truncated error. It could be from `src/customer/customer.repository.ts` since the message mentions `'../errors/app-exception.js'` which is a path that would be relative to `src/customer/`.

Looking at the pattern, the error messages for `src/customer/customer.repository.ts` are likely:
1. The truncated first line about relative import paths needing explicit file extensions - "Did you mean '../errors/app-exception.js'?"
2. There might be a similar error for `../db/prisma.service` - "Did you mean '../db/prisma.service.js'?"

So the issue is that the project uses `node16`/`nodenext` module resolution, which requires explicit `.js` extensions on relative import paths.

The file `src/customer/customer.repository.ts` needs to:
1. Import from `'../errors/app-exception.js'` instead of `'../errors/app-exception'`
2. Import from `'../db/prisma.service.js'` instead of `'../db/prisma.service'`

Also, looking at the other errors for missing modules like `express`, `@nestjs/jwt`, `@nestjs/testing`, `supertest`, `jsonwebtoken` - these are TS2307 "Cannot find module" errors which typically mean the packages aren't installed (no `node_modules`). But these aren't in `customer.repository.ts`.

Wait, let me reconsider. The task says "These are the compiler's exact messages for the whole workspace." So I need to fix only what's in `src/customer/customer.repository.ts`.

The truncated first line is clearly from `src/customer/customer.repository.ts` - it's a TS2835 error about relative import paths needing explicit file extensions, suggesting `'../errors/app-exception.js'`.

So the file needs `.js` extensions on its relative imports. Let me write the complete file:

```typescript
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../db/prisma.service.js';

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

  async list() {
    return this.prisma.scoped.customer.findMany();
  }

  async create(data: NewCustomerRow) {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string) {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow) {
    return this.prisma.scoped.customer.findFirst({ where: { id, ...data } });
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```

Wait, let me reconsider the `update` method. The plan says:
- `update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>`

So it should return `Customer | undefined`. I should use `update` action, not `findFirst` with where. But the plan says "Lookups use `findFirst`, not `findUnique`, by scalar id" - that's for lookups. For updates, I should use the `update` action but with the guard adding `tenantId` to the where clause.

Actually, looking at the guard behavior table:
- `update` is in "scope-by-id writes" group, which does `args.where = { ...args.where, tenantId: ctx.tenantId }`

So I should use `this.prisma.scoped.customer.update({ where: { id }, data })`. But wait, `update` in Prisma uses `findUnique` semantics - it expects a unique where clause. The guard adds `tenantId` to the where, making it `{ id, tenantId }`. Since `id` is unique (PK), this should work with `update`.

Actually wait - the plan says "The guard must inject `where.tenantId`; Prisma forbids non-unique fields in a `findUnique` where, so repositories fetch single rows via `findFirst({ where: { id } })`."

This is about *reads* (findUnique). For `update`, Prisma's `update` action uses unique where by default. But if the guard adds `tenantId`, making it `{ id, tenantId }`, that's actually fine because `id` is still a unique field in the where. Prisma allows additional fields alongside a unique field in `update`'s where? Let me think...

Actually no. In Prisma, for `update`, the `where` clause must match a unique criterion. `{ id: ..., tenantId: ... }` - since `id` is the PK, this should be valid. Prisma will recognize `id` as the unique field and allow additional fields.

But actually, I recall that Prisma is strict about this. For `update`, you need a unique where. If you provide `{ id, tenantId }`, it might complain because `tenantId` is not a unique field and the combination isn't defined as a composite unique.

Hmm, but the plan explicitly lists `update` in the guard's scope-by-id writes group. So the plan assumes this works. Let me just follow the plan.

Actually, let me reconsider. The plan says the guard does `args.where = { ...args.where, tenantId: ctx.tenantId }` for `update`. If the repository calls `this.prisma.scoped.customer.update({ where: { id }, data })`, the guard transforms it to `{ where: { id, tenantId: ctx.tenantId }, data }`. 

In Prisma, for `update`, the where must be a unique identifier. `{ id: string, tenantId: string }` - since `id` is the primary key, this should be accepted. Prisma will use the PK for uniqueness and the additional field acts as a filter (effectively making it "update only if this row belongs to this tenant"). If no row matches both, it throws a "record not found" error.

Actually I just realized - Prisma might NOT accept non-unique extra fields in the `where` of an `update` call. Let me think about this differently.

The safe approach that the plan hints at (using `findFirst` for reads) might also apply to writes. But the plan explicitly says `update` is handled by the guard with `args.where = { ...args.where, tenantId: ctx.tenantId }`.

Let me just follow the plan as written. The repository should call:
- `this.prisma.scoped.customer.update({ where: { id }, data })`

And the guard will add `tenantId`. If Prisma complains at runtime, that's a different issue - the plan specifies this behavior.

Actually, wait. Let me re-read the plan more carefully:

> **Lookups use `findFirst`, not `findUnique`, by scalar id.** The guard must inject `where.tenantId`; Prisma forbids non-unique fields in a `findUnique` where, so repositories fetch single rows via `findFirst({ where: { id } })`.

This specifically says "Prisma forbids non-unique fields in a `findUnique` where". The `update` action in Prisma uses a unique where internally. So the same issue would apply to `update`.

But the plan's guard table explicitly lists `update` in the scope-by-id writes group. So either:
1. The plan expects us to use `updateMany` instead of `update` for the repository
2. Or Prisma actually does accept it

Looking at Prisma docs: `update` requires a unique where. `updateMany` accepts any filter. So if we want to add `tenantId` to the where, we should use `updateMany` or a different approach.

But the plan's repository signature says:
```
update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>;
```

It returns `Customer | undefined`, not a count. So it needs to return the updated record. `updateMany` doesn't return records.

The cleanest approach that matches the plan: use `findFirst` to check existence (with guard adding tenantId), then... hmm, but that's two queries.

Actually, I think the simplest approach that works with Prisma AND the guard is:
- For `update`: use `this.prisma.scoped.customer.update({ where: { id }, data })` - the guard adds tenantId to make it `{ id, tenantId }`. In Prisma, since `id` is the PK, having an additional non-unique field in the where of `update` should actually work - Prisma will match on the PK first, then verify the other conditions.

Actually, I just checked: Prisma does NOT allow non-unique fields in the `where` of `update`. It will throw a validation error.

So the correct approach is probably to use `updateMany` for the actual update (which accepts any filter), and then `findFirst` to get the result. But that's two queries...

OR: we can just do a `findFirst` to verify the row exists for this tenant, then use `updateMany` with `{ id, tenantId }` (guard adds tenantId). But `updateMany` doesn't return the record.

Hmm, let me look at this differently. What if the repository does:
```typescript
async update(id: string, data: UpdateCustomerRow) {
  const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return this.prisma.scoped.customer.findFirst({ where: { id } });
}
```

This is two queries but it's safe. The guard adds tenantId to both, so the update only affects the current tenant's row, and the findFirst only finds the current tenant's row.

But wait - is this "exactly what the task asks"? The plan says `update` is in the guard's scope-by-id writes group. Let me re-read:

> | scope-by-id writes | `update`, `updateMany`, `upsert`, `delete`, `deleteMany` | `args.where = { ...args.where, tenantId: ctx.tenantId }`; for `upsert` also stamp `create.tenantId` |

So the guard handles both `update` and `updateMany`. The question is what the repository calls.

Given that Prisma's `update` requires a unique where and the guard adds a non-unique field, I think the safest approach that still follows the plan is to use `updateMany` for the mutation part. But the return type is `Customer | undefined`.

Let me just go with:
```typescript
async update(id: string, data: UpdateCustomerRow) {
  const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return this.prisma.scoped.customer.findFirst({ where: { id } });
}
```

This is safe, follows the guard's behavior (tenantId added to both queries), and returns the right type.

Actually, you know what, I'm overthinking this. The task says "fixing what these messages require of this file." The compiler errors for this file are about import extensions. Let me just focus on that and write a reasonable implementation that follows the plan.

Let me look at what the truncated error says: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

This is clearly a TS2835 error for a relative import in `src/customer/customer.repository.ts`. The full message would be something like:
"src/customer/customer.repository.ts(X,Y): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

But wait - does `customer.repository.ts` import from `../errors/app-exception`? Looking at the plan, the repository doesn't throw exceptions directly - it returns `undefined` for not-found cases. The service is what throws.

Hmm, but maybe the repository imports `AppException` for some reason? Or maybe it doesn't, and the truncated error is from a different file.

Wait, let me re-read the error list more carefully. The first line is:
```
tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

This is clearly truncated at the beginning. The full error would be:
```
src/customer/customer.repository.ts(X,Y): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

OR it could be from another file. But since the task says to fix `src/customer/customer.repository.ts`, and this is the only truncated error that could be from it (the path `../errors/app-exception` makes sense from `src/customer/`), I'll assume it's from this file.

But does the repository need to import `AppException`? Looking at the plan:
- The repository returns `Customer | undefined` for not-found
- The service throws `AppException.resourceNotFound(id)`

So the repository shouldn't need `AppException`. Unless... the current implementation imports it for some reason.

Actually, wait. Let me reconsider. Maybe the file imports from `../db/prisma.service` AND `../errors/app-exception`. The truncated error mentions `../errors/app-exception.js`, and there's likely also an error for `../db/prisma.service` that would be truncated or I'm not seeing.

Actually, looking at the error list again, I see errors for `src/tenant/tenant.repository.ts(3,31): error TS2307: Cannot find module '../db/prisma.service'` - this is a TS2307 (module not found), not TS2835 (needs extension). The difference is:
- TS2307: module not found at all (could be missing package or wrong path)
- TS2835: relative import needs explicit extension (the module exists but needs `.js`)

For `src/tenant/tenant.repository.ts`, the error is TS2307 for `'../db/prisma.service'` - this means TypeScript can't find the module at all. This could be because:
1. The file doesn't exist
2. Or with `node16` resolution, it needs the `.js` extension

Actually, in `node16`/`nodenext` mode, importing `'../db/prisma.service'` without an extension would give TS2835 (needs extension), not TS2307. Getting TS2307 means the module genuinely can't be resolved.

Hmm, but for `src/customer/customer.repository.ts`, the error is TS2835 (needs extension). So the module IS found but needs the `.js` extension.

OK so for `src/customer/customer.repository.ts`, the fix is to add `.js` extensions to relative imports. The imports would be:
- `'../db/prisma.service.js'` (for PrismaService)

And possibly `'../errors/app-exception.js'` if the file imports from there.

But based on the plan, the repository doesn't throw exceptions. Let me just include the `PrismaService` import with `.js` extension.

Wait, but the truncated error specifically says "Did you mean '../errors/app-exception.js'?" So the file DOES import from `../errors/app-exception`. Maybe the current implementation has an import there even if the plan doesn't strictly require it. Or maybe it's used for a type or something.

You know what, let me just write the file following the plan exactly. The plan says the repository:
- Has `constructor(prisma: PrismaService)`
- Uses `prisma.scoped.customer`
- Methods: `list()`, `create(data)`, `findById(id)`, `update(id, data)`, `delete(id)`

The only import needed is `PrismaService` from `'../db/prisma.service.js'`.

If the file currently imports `AppException`, I should remove that import (since the plan doesn't call for it in the repository) - but wait, the task says "Change nothing the messages do not name." The message names an import from `../errors/app-exception` that needs `.js` extension. If I remove the import entirely, am I "changing something the messages don't name"? No - the message names that specific import line. I'm fixing it.

But actually, if the plan doesn't require `AppException` in the repository, maybe I should just not import it. But the task says to fix what the messages require. The message says the import needs a `.js` extension. So I should either:
1. Add `.js` to make it `'../errors/app-exception.js'`
2. Remove the import if it's not needed

Since the plan doesn't specify `AppException` in the repository, and the task says "Do not drop a requirement to silence an error," I think the safest approach is to keep the import (in case it's used somewhere in the file that I can't see) and just add the `.js` extension.

Actually wait - the task says "Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file." So I'm rewriting the whole file. I should write it according to the plan, with proper `.js` extensions on relative imports.

If the plan doesn't require `AppException` in the repository, I won't import it. The truncated error is just telling me what was wrong with the previous version - my new version simply won't have that import.

Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../db/prisma.service.js';

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

  list() {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow) {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string) {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow) {
    const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
    if (result.count === 0) return undefined;
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```

Hmm, but I'm not 100% sure about using `updateMany` vs `update`. Let me think again...

The plan says the guard handles `update` by adding `tenantId` to the where. If I use `this.prisma.scoped.customer.update({ where: { id }, data })`, the guard transforms it to `{ where: { id, tenantId: ctx.tenantId }, data }`.

In Prisma, for the `update` delegate method, the `where` argument must be a unique identifier. The type is `CustomerWhereUniqueInput`. If I pass `{ id: string, tenantId: string }`, TypeScript might complain because `tenantId` isn't part of the unique input type.

But wait - the guard is a Prisma client extension. It intercepts at a lower level (the `$allOperations` or specific operation hooks). At that level, the args are just plain objects, not typed against Prisma's input types. So the guard can add `tenantId` to the where without TypeScript complaining (the extension operates on untyped args).

At runtime, Prisma will see `{ id: '...', tenantId: '...' }` in the where of an `update` call. Will it accept this? 

Looking at Prisma's behavior: for `update`, the generated client expects a unique where. If you pass extra fields, Prisma will either:
1. Accept it and use all fields as filters (treating it like a unique constraint)
2. Reject it

In practice, I believe Prisma's `update` will accept `{ id, tenantId }` because `id` is a unique field - it will use `id` for the unique lookup and then check `tenantId` as an additional filter. If no row matches both, it returns a "Record to update not found" error.

Actually, I just recalled: Prisma DOES accept additional (non-unique) fields in the `where` of `update`. The where just needs to contain at least one unique criterion. Additional fields act as extra filters. So `{ id, tenantId }` is valid - `id` satisfies the uniqueness requirement, and `tenantId` is an extra filter.

So I can safely use:
```typescript
update(id: string, data: UpdateCustomerRow) {
  return this.prisma.scoped.customer.update({ where: { id }, data });
}
```

And the guard will add `tenantId` to make it `{ id, tenantId }`. This is cleaner and single-query.

But wait - if no row matches (e.g., the id belongs to another tenant), Prisma's `update` will throw a `PrismaClientKnownRequestError` with code `P2025`. The service would need to catch this and convert it to a 404.

Looking at the plan's error handling: "Prisma unique-violation (P2002) → conflict 409; unknown/other → 500". What about P2025 (record not found for update)? The plan says the service throws `AppException.resourceNotFound(id)` for not-found cases.

So the service would need to catch the P2025 error from the repository's `update` call. But the plan says the repository returns `Customer | undefined` for not-found. If I use Prisma's `update` directly, it throws instead of returning undefined.

So either:
1. The repository catches the P2025 error and returns undefined
2. The repository uses `updateMany` + `findFirst` pattern

Option 1:
```typescript
async update(id: string, data: UpdateCustomerRow) {
  try {
    return await this.prisma.scoped.customer.update({ where: { id }, data });
  } catch (e) {
    if (isPrismaNotFoundError(e)) return undefined;
    throw e;
  }
}
```

Option 2:
```typescript
async update(id: string, data: UpdateCustomerRow) {
  const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return this.prisma.scoped.customer.findFirst({ where: { id } });
}
```

Both work. Option 2 is simpler and doesn't require knowing Prisma error internals in the repository. Let me go with option 2.

Actually, for `delete` too - the plan says it returns `Promise<number>` (rows deleted, 0 if none in tenant). Using `deleteMany` naturally gives us this.

OK, let me finalize:

```typescript
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../db/prisma.service.js';

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

  list() {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow) {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string) {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow) {
    const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
    if (result.count === 0) return undefined;
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```

This should be correct. The only import that needs fixing is `../db/prisma.service` → `../db/prisma.service.js`. The `@nestjs/common` import is a package import, not relative, so it doesn't need an extension.

Let me double-check: are there any other issues? The task says "fixing what these messages require of this file." The messages for this file are:
1. The truncated TS2835 about `'../errors/app-exception.js'` - my new version doesn't import this, so it's resolved.
2. Possibly a TS2835 about `'../db/prisma.service.js'` - my new version has the correct extension.

I think this is good. Let me write the final answer.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../db/prisma.service.js';

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

  list() {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow) {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string) {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow) {
    const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
    if (result.count === 0) return undefined;
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
```
