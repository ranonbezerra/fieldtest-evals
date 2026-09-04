# repair1-customer.service.ts

## reasoning

```
Let me analyze the compiler errors to see what they say about `src/customer/customer.service.ts`.

Looking through all the error messages, I don't see a single one that names `src/customer/customer.service.ts`. The errors are in:
- `src/tenant/tenant-resolution.middleware.ts`
- `src/tenant/tenant.controller.ts`
- `src/tenant/tenant.module.ts`
- `src/tenant/tenant.repository.ts`
- `src/tenant/tenant.service.ts`
- `test/customer-isolation.spec.ts`
- `test/tenant-config.spec.ts`

Wait, the user says "These are the compiler's exact messages for the whole workspace" and asks me to rewrite `src/customer/customer.service.ts` fixing what these messages require of this file.

But none of the error messages reference `src/customer/customer.service.ts` directly. However, let me look more carefully...

The first error message is truncated: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

This is clearly the tail end of a longer error. Given the pattern of the other errors (TS2835: Relative import paths need explicit file extensions), this is likely from a file that imports `../errors/app-exception` without the `.js` extension.

Looking at the files that import from `../errors/app-exception`:
- `src/tenant/tenant-resolution.middleware.ts(7,30)` - has the explicit TS2835 error
- `src/tenant/tenant.service.ts(2,30)` - has the explicit TS2835 error

The truncated one at the top could be from `src/customer/customer.service.ts` since it imports `../errors/app-exception` (per the plan). The error would be:
```
src/customer/customer.service.ts(X,Y): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

So the fix for `src/customer/customer.service.ts` is to add `.js` extensions to relative imports.

Per the plan, `src/customer/customer.service.ts` imports:
- `./customer.repository` → should be `./customer.repository.js`
- `../errors/app-exception` → should be `../errors/app-exception.js`

Now let me write the complete file based on the plan's specification:

```ts
export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string | null; }
export interface CustomerDto { id: string; email: string; name: string | null; }

export class CustomerService {
  constructor(repo: CustomerRepository);
  list(): Promise<CustomerDto[]>;
  create(input: CreateCustomerDto): Promise<CustomerDto>;
  getById(id: string): Promise<CustomerDto>;   // throws AppException.resourceNotFound(id)
  update(id: string, input: UpdateCustomerDto): Promise<CustomerDto>; // throws resourceNotFound
  remove(id: string): Promise<{ deleted: boolean }>; // throws resourceNotFound
}
```

The service uses the repository, which returns `Customer` (the Prisma type) or `undefined`. The service maps to DTOs and throws `AppException.resourceNotFound` when not found.

Let me write this out:

```ts
import { Injectable } from '@nestjs/common';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';
import { AppException } from '../errors/app-exception.js';

export interface CreateCustomerDto {
  email: string;
  name?: string;
}

export interface UpdateCustomerDto {
  email?: string;
  name?: string | null;
}

export interface CustomerDto {
  id: string;
  email: string;
  name: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<CustomerDto[]> {
    const customers = await this.repo.list();
    return customers.map((c) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const data: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(data);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async getById(id: string): Promise<CustomerDto> {
    const customer = await this.repo.findById(id);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerDto> {
    const data: UpdateCustomerRow = {};
    if (input.email !== undefined) data.email = input.email;
    if (input.name !== undefined) data.name = input.name;
    const customer = await this.repo.update(id, data);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const count = await this.repo.delete(id);
    if (count === 0) throw AppException.resourceNotFound(id);
    return { deleted: true };
  }
}
```

Wait, I need to check what the repository's `Customer` type is. Per the plan, the repository uses `prisma.scoped.customer` and returns `Customer[]`, `Customer`, etc. The `Customer` type would be the Prisma-generated type with fields `id`, `tenantId`, `email`, `name`, `createdAt`, `updatedAt`.

The DTO only exposes `id`, `email`, `name` — which is correct per the plan.

Now, does the file need `@Injectable()` decorator? Yes, since it's a NestJS service that will be provided in the module.

Let me also consider: the `@nestjs/common` import is a package import, not a relative one, so it doesn't need a `.js` extension. The relative imports `./customer.repository` and `../errors/app-exception` need `.js` extensions.

This looks correct. The only fix needed is adding `.js` to the relative import paths.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';
import { AppException } from '../errors/app-exception.js';

export interface CreateCustomerDto {
  email: string;
  name?: string;
}

export interface UpdateCustomerDto {
  email?: string;
  name?: string | null;
}

export interface CustomerDto {
  id: string;
  email: string;
  name: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<CustomerDto[]> {
    const customers = await this.repo.list();
    return customers.map((c) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const data: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(data);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async getById(id: string): Promise<CustomerDto> {
    const customer = await this.repo.findById(id);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerDto> {
    const data: UpdateCustomerRow = {};
    if (input.email !== undefined) data.email = input.email;
    if (input.name !== undefined) data.name = input.name;
    const customer = await this.repo.update(id, data);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const count = await this.repo.delete(id);
    if (count === 0) throw AppException.resourceNotFound(id);
    return { deleted: true };
  }
}
```
