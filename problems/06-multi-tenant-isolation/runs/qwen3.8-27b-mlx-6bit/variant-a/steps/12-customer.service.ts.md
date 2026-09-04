# 12-customer.service.ts

## reasoning

```
Let me analyze the plan to understand what `src/customer/customer.service.ts` needs to contain.

From the plan:

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

Key notes from the plan:
- `AppException.conflict(...)` is surfaced by the filter from Prisma P2002 on `create`/`update`, not thrown here directly.
- The service holds the logic, zero raw SQL, zero Prisma client calls.
- Controllers call the service; the controller validates input.

From the repository reference:
- `list(): Promise<Customer[]>`
- `create(data: NewCustomerRow): Promise<Customer>` where `NewCustomerRow = { email: string; name: string | null }`
- `findById(id: string): Promise<Customer | undefined>`
- `update(id: string, data: UpdateCustomerRow): Promise<Customer | undefined>` where `UpdateCustomerRow = { email?: string; name?: string | null }`
- `delete(id: string): Promise<number>`

Now let me write the service:

1. **`list()`** - calls `repo.list()`, maps to `CustomerDto[]`
2. **`create(input)`** - calls `repo.create({ email: input.email, name: input.name ?? null })`, maps to `CustomerDto`. Conflict is handled by the filter (P2002), not here.
3. **`getById(id)`** - calls `repo.findById(id)`, throws `AppException.resourceNotFound(id)` if undefined, else maps to `CustomerDto`.
4. **`update(id, input)`** - calls `repo.update(id, input)`, throws `AppException.resourceNotFound(id)` if undefined, else maps to `CustomerDto`.
5. **`remove(id)`** - calls `repo.delete(id)`, throws `AppException.resourceNotFound(id)` if 0, else returns `{ deleted: true }`.

I need a helper to map a Prisma `Customer` to `CustomerDto`. The Customer model has: id, tenantId, email, name, createdAt, updatedAt. The DTO only has id, email, name.

Let me write this cleanly:

```ts
import { Injectable } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { AppException } from '../errors/app-exception';
import { CustomerRepository, UpdateCustomerRow } from './customer.repository';

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

  list(): Promise<CustomerDto[]> {
    return this.repo.list().then((rows) => rows.map((r) => toDto(r)));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row = await this.repo.create({ email: input.email, name: input.name ?? null });
    return toDto(row);
  }

  async getById(id: string): Promise<CustomerDto> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw AppException.resourceNotFound(id);
    }
    return toDto(row);
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerDto> {
    const row = await this.repo.update(id, input);
    if (!row) {
      throw AppException.resourceNotFound(id);
    }
    return toDto(row);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const count = await this.repo.delete(id);
    if (count === 0) {
      throw AppException.resourceNotFound(id);
    }
    return { deleted: true };
  }
}

function toDto(row: Customer): CustomerDto {
  return { id: row.id, email: row.email, name: row.name };
}
```

Wait, let me check the `UpdateCustomerRow` type. From the repository:
```ts
export interface UpdateCustomerRow {
  email?: string;
  name?: string | null;
}
```

And `UpdateCustomerDto` is:
```ts
export interface UpdateCustomerDto {
  email?: string;
  name?: string | null;
}
```

These are structurally identical, so I can pass `input` directly to `repo.update(id, input)`. Good.

For `CreateCustomerDto`, the `name` is optional (`string | undefined`), but `NewCustomerRow.name` is `string | null`. So I need to convert: `name: input.name ?? null`.

This looks correct. Let me also make sure I'm not importing `UpdateCustomerRow` from the repository since I don't need it explicitly — the types are structurally compatible.

Actually, I should double-check: do I need to import `Customer` from `@prisma/client`? Yes, for the `toDto` helper parameter type.

Let me finalize.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { AppException } from '../errors/app-exception';
import { CustomerRepository } from './customer.repository';

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
    const rows = await this.repo.list();
    return rows.map(toDto);
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row = await this.repo.create({ email: input.email, name: input.name ?? null });
    return toDto(row);
  }

  async getById(id: string): Promise<CustomerDto> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw AppException.resourceNotFound(id);
    }
    return toDto(row);
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerDto> {
    const row = await this.repo.update(id, input);
    if (!row) {
      throw AppException.resourceNotFound(id);
    }
    return toDto(row);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const count = await this.repo.delete(id);
    if (count === 0) {
      throw AppException.resourceNotFound(id);
    }
    return { deleted: true };
  }
}

function toDto(row: Customer): CustomerDto {
  return { id: row.id, email: row.email, name: row.name };
}
```
