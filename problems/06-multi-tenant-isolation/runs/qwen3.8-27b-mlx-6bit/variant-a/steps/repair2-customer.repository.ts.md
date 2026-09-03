# repair2-customer.repository.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/customer/customer.repository.ts`:

1. `src/customer/customer.repository.ts(1,37): error TS2307: Cannot find module '../multi-tenant/tenant-prisma.service' or its corresponding type declarations.`
2. `src/customer/customer.repository.ts(2,68): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto.js'?`

So the issues in this file are:
1. The import path `'../multi-tenant/tenant-prisma.service'` needs a `.js` extension → `'../multi-tenant/tenant-prisma.service.js'`
2. The import path `'./dto'` needs a `.js` extension → `'./dto.js'`

The first error (TS2307 - Cannot find module) is likely a cascading effect of the missing `.js` extension. When the compiler can't resolve `../multi-tenant/tenant-prisma.service` (without extension), it reports "Cannot find module". Adding the `.js` extension should fix both.

Now let me think about what the repository needs to contain based on the plan:

From the plan:
```ts
// src/customer/customer.repository.ts
export declare class CustomerRepository {
  constructor(private readonly db: TenantPrismaService);
  list(): Promise<Customer[]>;
  findById(id: string): Promise<Customer | null>;
  create(input: CreateCustomerInput): Promise<Customer>;
  update(id: string, input: UpdateCustomerInput): Promise<Customer>;
  delete(id: string): Promise<void>;
}
```

The repository:
- Uses `TenantPrismaService` for all DB access
- Never references `tenantId` manually (the extension handles scoping)
- Let's Prisma throw P2002 for unique violations (service catches and converts)
- For `update`/`delete`, if 0 rows affected, the TenantPrismaService throws `ResourceNotFoundError`

Let me write the repository:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } });
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return this.db.customer.create({ data: input });
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.db.customer.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.customer.delete({ where: { id } });
  }
}
```

Wait, let me check the plan more carefully. The plan says:

"Unique constraint violations (e.g., same email twice in one tenant): the repository lets Prisma throw P2002; the service catches it and rethrows a ConflictError → 409"

So the repository just lets P2002 bubble up. Good, no try/catch needed in the repository.

"Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is handled by the TenantPrismaService extension, not the repository. So the repository just calls the methods and if the resource doesn't exist (cross-tenant), the TenantPrismaService will throw ResourceNotFoundError.

The plan says repositories "never reference `tenantId` in their parameters or bodies." So I'm good.

Now, about the return types - the plan shows `Customer` as:
```ts
export interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

But the Prisma model will return `tenantId` as well. The repository should probably just return what Prisma gives (which includes tenantId) or cast. Actually, looking at the plan more carefully, it says the repository methods return `Customer` types. But in practice, the Prisma client will return the full model shape including `tenantId`. 

For compilation purposes, since the `TenantPrismaService` uses `unknown` return types per the plan (`Promise<unknown[]>`, `Promise<unknown | null>`, etc.), I'll need to cast. But wait - the plan says:

```ts
export interface TenantScopedModel<T> {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findUnique(args: Record<string, unknown>): Promise<unknown | null>;
  ...
}
```

So the return types are `unknown`. I'll need to cast to the DTO types in the repository.

Actually, let me reconsider. The plan is a design document. The actual `TenantPrismaService` implementation (which I can see has errors) likely uses `$extends` which would give proper types. But since I'm only fixing `customer.repository.ts` and the errors are about import paths, let me just write clean code that compiles.

Given that the `TenantPrismaService` delegates return `unknown` types per the plan, I'll cast:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany() as Promise<Customer[]>;
  }

  async findById(id: string): Promise<Customer | null> {
    return (await this.db.customer.findUnique({ where: { id } })) as Customer | null;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return (await this.db.customer.create({ data: input })) as Customer;
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return (await this.db.customer.update({ where: { id }, data: input })) as Customer;
  }

  async delete(id: string): Promise<void> {
    await this.db.customer.delete({ where: { id } });
  }
}
```

Hmm, but actually if the TenantPrismaService uses `$extends` properly, the types would be inferred from Prisma and wouldn't need casts. The plan's interface with `unknown` was just a simplified declaration for the plan document. In practice, if the service properly exposes typed delegates, no casts are needed.

But I need to write code that compiles given the errors. The errors only mention import path issues for this file. Let me write it cleanly without unnecessary casts, assuming the TenantPrismaService properly types its delegates (which it should if using `$extends` correctly). If the types don't match, that would be a separate error not listed here.

Actually wait - the errors listed are ALL the compiler errors in the workspace. So if I write `this.db.customer.findMany()` and it returns `unknown[]`, that would produce a type error when I return it as `Customer[]`. But that error isn't listed... which means either:
1. The TenantPrismaService properly types its delegates (via `$extends`), OR
2. The file doesn't currently have those method calls yet

Since the task says "These are the compiler's exact messages for the whole workspace", and there's no type mismatch error for customer.repository.ts beyond the import issues, I should write the code assuming the types work out. The `$extends` from Prisma does preserve types, so if TenantPrismaService properly wraps an extended client, the delegates would be typed.

Let me write it without casts:

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } });
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return this.db.customer.create({ data: input });
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.db.customer.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.customer.delete({ where: { id } });
  }
}
```

This is clean and follows the plan. The only changes needed are:
1. Add `.js` to `../multi-tenant/tenant-prisma.service` → `../multi-tenant/tenant-prisma.service.js`
2. Add `.js` to `./dto` → `./dto.js`

That should be all. Let me finalize this.
```

## reply

```ts
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } });
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return this.db.customer.create({ data: input });
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.db.customer.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.customer.delete({ where: { id } });
  }
}
```
