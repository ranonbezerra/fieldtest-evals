# repair2-customer.service.ts

## reasoning

```
The user wants me to fix `src/customer/customer.service.ts`. Let me look at the compiler errors that pertain to this file:

```
src/customer/customer.service.ts(27,27): error TS7006: Parameter 'c' implicitly has an 'any' type.
```

That's the only error in `customer.service.ts`. The other errors are in other files.

So I need to see what's on line 27, column 27 of `customer.service.ts`. The error says parameter 'c' implicitly has an 'any' type. This is likely a `.map()` callback or similar where the parameter `c` isn't typed.

Looking at the PLAN.md, the service has:
```ts
list(): Promise<CustomerDto[]>;
create(input: CreateCustomerDto): Promise<CustomerDto>;
getById(id: string): Promise<CustomerDto>;   // throws AppException.resourceNotFound(id)
update(id: string, input: UpdateCustomerDto): Promise<CustomerDto>; // throws resourceNotFound
remove(id: string): Promise<{ deleted: boolean }>; // throws resourceNotFound
```

And the DTOs:
```ts
export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string | null; }
export interface CustomerDto { id: string; email: string; name: string | null; }
```

The `list()` method returns `Promise<CustomerDto[]>`. The repository's `list()` returns `Promise<Customer[]>` where `Customer` is the Prisma model. So in the service, we'd map from the Prisma `Customer` type to `CustomerDto`.

The issue is that in a `.map((c) => ...)` callback, the type of `c` might not be inferred properly if there's an import issue or the repository return type isn't properly typed.

Wait, but the only error for this file is the implicit `any` on parameter `c`. This suggests that the repository's `list()` return type isn't being resolved properly, or there's a typing issue with the map callback.

Let me think about what the file likely looks like based on the plan:

```ts
import { Injectable } from '@nestjs/common';
import { AppException } from '../errors/app-exception.js';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';

export interface CreateCustomerDto { email: string; name?: string; }
export interface UpdateCustomerDto { email?: string; name?: string | null; }
export interface CustomerDto { id: string; email: string; name: string | null; }

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<CustomerDto[]> {
    const customers = await this.repo.list();
    return customers.map((c) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(row);
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

The error is on line 27, column 27: `Parameter 'c' implicitly has an 'any' type.`

This is in the `.map((c) => ...)` call. The issue is that `this.repo.list()` returns `Promise<Customer[]>` where `Customer` is the Prisma type. If for some reason the type isn't being resolved (maybe because of the other compilation errors in the workspace affecting type resolution), TypeScript might not be able to infer the type of `c`.

But wait - the instructions say "Change nothing the messages do not name." The only message for this file is the implicit `any` on `c`. So I need to add an explicit type annotation to `c`.

The simplest fix is to type the parameter explicitly: `.map((c: Customer) => ...)` where `Customer` is the Prisma type, or we can type it based on what properties we access.

Actually, looking more carefully - the repository returns `Promise<Customer[]>` where `Customer` is from `@prisma/client`. So I should import that type and use it.

Let me write the complete file with the fix. The parameter `c` in the `.map()` needs an explicit type annotation.

Let me write the complete file:

```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';

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
    return customers.map((c: Customer) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(row);
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

This fixes the implicit `any` by adding an explicit type annotation to the `c` parameter. The import of `Customer` from `@prisma/client` gives us the type. This is the minimal change needed to fix the named error without changing anything else.

Wait, I need to double-check: the plan says the repository uses `prisma.scoped.customer` which returns the Prisma model type. The Prisma model type for `customers` table would be `Customer` from `@prisma/client`. So importing that type and using it as the annotation is correct.

This should be the complete fix. Let me make sure I'm not changing anything the messages don't name - I'm only adding a type annotation to `c` and the corresponding import. Everything else matches what the plan specifies.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';

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
    return customers.map((c: Customer) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(row);
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
