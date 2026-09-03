# 10-customer.service.ts

## reasoning

```
Let me analyze what the CustomerService needs to do based on the plan and references.

From PLAN.md:
- `src/customer/customer.service.ts` reads: `src/customer/customer.repository.ts`, `src/customer/dto.ts`, `src/multi-tenant/errors.ts`
- The service holds the logic. Zero raw SQL, zero Prisma client calls.
- It maps domain errors: not-found → 404, conflict → 409.

From the plan's control flow section:
- **Service**: call repository method(s); map domain errors (not-found → 404, conflict → 409). No Prisma imports.

Looking at the repository:
- `list(): Promise<Customer[]>`
- `findById(id: string): Promise<Customer | null>`
- `create(input: CreateCustomerInput): Promise<Customer>`
- `update(id: string, input: UpdateCustomerInput): Promise<Customer>`
- `delete(id: string): Promise<void>`

The service needs to:
1. Call repository methods
2. For `findById` - if null, throw `ResourceNotFoundError`
3. For `update` - the repository returns a Customer or throws ResourceNotFoundError (from the plan: "if the resulting row count is 0, throw ResourceNotFoundError")
4. For `delete` - similar, the repository handles it
5. For `create` - catch P2002 (unique constraint violation) and rethrow as `ConflictError`

Wait, let me re-read the plan more carefully:

"**Unique constraint violations** (e.g., same email twice in one tenant): the repository lets Prisma throw `P2002`; the service catches it and rethrows a `ConflictError` → 409 `{ error: { code: "conflict", ... } }`."

So the service catches the P2002 error from the repository's create call and converts it to ConflictError.

For update and delete, the plan says: "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

So the repository (via TenantPrismaService) will throw ResourceNotFoundError when update/delete affects 0 rows. The service just needs to propagate that.

Actually wait - let me reconsider. The repository's `update` and `delete` methods call the TenantPrismaService which handles the 0-row case by throwing ResourceNotFoundError. So the service doesn't need to do anything special for update/delete - it just calls the repo and the error propagates.

For `findById`, the repository returns `Customer | null`. The service needs to check for null and throw ResourceNotFoundError.

For `create`, the service needs to catch P2002 and throw ConflictError.

Let me write the service:

```ts
import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<Customer[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new ResourceNotFoundError('Customer');
    }
    return customer;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002';
  }
}
```

Wait, I need to think about how P2002 is thrown. In Prisma, when a unique constraint is violated, it throws a `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'`. The error object has a `code` property.

Let me check if I need to import anything from Prisma for the error check. The plan says "No Prisma imports" in the service. So I should just check for the error code without importing from Prisma.

The check `err instanceof Error && 'code' in err` should work for detecting P2002 since Prisma errors extend Error and have a `code` property.

Actually, let me think about this more carefully. The Prisma error is a `PrismaClientKnownRequestError` which extends `Error`. It has a `code` property. So checking `'code' in err` and then casting should work.

But wait - could the error be wrapped? In NestJS, errors thrown in a service propagate up. The repository throws the raw Prisma error. So the service should see the raw Prisma error.

I think my implementation is correct. Let me also consider: should `update` and `delete` in the service do anything special? 

Looking at the plan again: "Update/delete: merge `{ tenantId }` into `args.where`; if the resulting row count is 0, throw `ResourceNotFoundError`."

This is handled at the TenantPrismaService level. So when the repository calls `this.db.customer.update(...)`, if no row is found, the TenantPrismaService throws ResourceNotFoundError. This propagates through the repository to the service to the controller. The service doesn't need to do anything special.

But wait - should the service explicitly handle this? The plan says the service "maps domain errors (not-found → 404, conflict → 409)". The not-found for update/delete is already thrown as ResourceNotFoundError by the TenantPrismaService. So it's already mapped.

For `findById`, the repository returns null (because it uses `findUnique` which returns null, not throws). So the service needs to convert null → ResourceNotFoundError.

I think my implementation is correct. Let me finalize it.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<Customer[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new ResourceNotFoundError('Customer');
    }
    return customer;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002';
  }
}
```
