# 09-customer.repository.ts

## reasoning

```
Let me analyze what's needed for `src/customer/customer.repository.ts` based on the plan and references.

From the plan:
- `CustomerRepository` class with constructor taking `TenantPrismaService`
- Methods: `list()`, `findById(id)`, `create(input)`, `update(id, input)`, `delete(id)`
- Repositories never reference `tenantId` in their parameters or bodies
- It reads from: `src/multi-tenant/tenant-prisma.service.ts` and `src/customer/dto.ts`

From the references:
- `TenantPrismaService` exposes `customer`, `plan`, `order` getters that return the extended model delegates
- The dto has: `CreateCustomerInput`, `UpdateCustomerInput`, `Customer`

Looking at the `TenantPrismaService`, it returns the Prisma model delegate (like `this.getExtendedClient().customer`). So `this.db.customer` would give me the Prisma `customer` delegate with tenant scoping already applied.

The repository methods should:
- `list()` → `this.db.customer.findMany()` 
- `findById(id: string)` → `this.db.customer.findUnique({ where: { id } })` - returns `Customer | null`
- `create(input: CreateCustomerInput)` → `this.db.customer.create({ data: input })`
- `update(id: string, input: UpdateCustomerInput)` → `this.db.customer.update({ where: { id }, data: input })`
- `delete(id: string)` → `this.db.customer.delete({ where: { id } })` - returns `Promise<void>`

Wait, looking at the plan more carefully:

```ts
export declare class CustomerRepository {
  constructor(private readonly db: TenantPrismaService);
  list(): Promise<Customer[]>;
  findById(id: string): Promise<Customer | null>;
  create(input: CreateCustomerInput): Promise<Customer>;
  update(id: string, input: UpdateCustomerInput): Promise<Customer>;
  delete(id: string): Promise<void>;
}
```

The plan says "repositories never reference `tenantId` in their parameters or bodies." This means the repository just calls the TenantPrismaService methods and the extension handles tenant scoping transparently.

For `delete`, the plan says it returns `Promise<void>`. The Prisma delete would return the deleted record, but the repository wraps it to just return void (or we can just call it and not return the value).

Actually, looking at the TenantPrismaService more carefully - the `delete` operation with P2025 (record not found) is caught and rethrown as `ResourceNotFoundError`. So the repository doesn't need to handle that - it's handled at the extension level.

Let me think about what imports I need:
- `Injectable` from `@nestjs/common`
- `TenantPrismaService` from `../multi-tenant/tenant-prisma.service.js`
- `CreateCustomerInput`, `UpdateCustomerInput`, `Customer` from `./dto.js`

Wait, the plan says the repository reads from `src/multi-tenant/tenant-prisma.service.ts` and `src/customer/dto.ts`. So the imports are:
- `TenantPrismaService` from the multi-tenant module
- DTOs from `./dto.js`

Now, looking at the TenantPrismaService - it exposes `.customer` which returns the extended Prisma model delegate. The delegate has methods like `findMany`, `findUnique`, `create`, `update`, `delete` that accept Prisma-style args.

For `findMany`, I'd call: `this.db.customer.findMany({})` or just `this.db.customer.findMany()`

For `findUnique`, I'd call: `this.db.customer.findUnique({ where: { id } })`

For `create`, I'd call: `this.db.customer.create({ data: input })`

For `update`, I'd call: `this.db.customer.update({ where: { id }, data: input })`

For `delete`, I'd call: `this.db.customer.delete({ where: { id } })`

The return types from Prisma would be the model type. The plan defines `Customer` in dto.ts with `id`, `email`, `name`, `createdAt`, `updatedAt`. The Prisma model should match this shape (with snake_case mapped to camelCase by Prisma).

Let me write the file now. I need to use ESM imports with `.js` extensions since the project uses `"type": "module"`.

Looking at the reference file `tenant-prisma.service.ts`, it uses imports like:
```ts
import { PrismaService } from './prisma.service.js';
```

So I should use `.js` extensions in imports.

Let me also check - does the plan say anything about `@Injectable()`? The plan shows:
```ts
export declare class CustomerRepository {
  constructor(private readonly db: TenantPrismaService);
  ...
}
```

It doesn't explicitly show `@Injectable()` but since it's a NestJS provider listed in the module, it needs the decorator. Let me include it.

Actually wait - looking at the manifest:
```
src/customer/customer.repository.ts | reads: src/multi-tenant/tenant-prisma.service.ts, src/customer/dto.ts | CustomerRepository
```

It only reads from those two files. But I still need `@Injectable` from `@nestjs/common` for NestJS DI. That's a framework import, not a project file dependency.

Let me write the complete file:
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany({});
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
