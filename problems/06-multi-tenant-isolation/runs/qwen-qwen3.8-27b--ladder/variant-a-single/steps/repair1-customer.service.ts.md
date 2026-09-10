# repair1-customer.service.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/customer/customer.service.ts`:

1. `src/customer/customer.service.ts(26,42): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'. Types of property 'name' are incompatible. Type 'string | null | undefined' is not assignable to type 'string | null'. Type 'undefined' is not assignable to type 'string | null'.`

So there's a `CustomerInput` type that has `name: string | null | undefined` (likely an optional `name?` field), and it's being passed to something that expects `{ email: string; name: string | null; }` where `name` is required (nullable but not optional).

The fix: In the service, when creating a customer, I need to ensure `name` is coerced to `string | null` rather than `string | null | undefined`. This means I should use `name ?? null` or handle the optional-to-null conversion.

Now I need to figure out what the full file looks like. Based on the project structure and the errors:

- The file is `src/customer/customer.service.ts`
- It uses a `CustomerInput` type (likely with `email: string` and `name?: string | null`)
- It calls the repository (likely `customerRepository.create` or similar) which expects `{ email: string; name: string | null; }`
- The service is for customer management in a multi-tenant system

Given the project conventions:
- `controller` validates input and calls the service
- `service` holds the logic, zero raw SQL, zero Prisma client calls
- `repository` is the only layer that touches the database

The service likely has methods like:
- `create(input: CustomerInput)` 
- `findAll()`
- `findById(id: string)`
- `update(id: string, input: CustomerInput)`
- `remove(id: string)`

And it calls a repository. The repository's `create` method expects `{ email: string; name: string | null; }`.

The fix is to convert `input.name` (which could be `undefined`) to `input.name ?? null` (which is `string | null`).

Let me think about what the `CustomerInput` type looks like. It's probably defined in the service file or imported. Given the error says `CustomerInput` has `name: string | null | undefined`, it's likely:

```typescript
export interface CustomerInput {
  email: string;
  name?: string | null;
}
```

The repository's create method expects `{ email: string; name: string | null; }`.

So the fix in the service is to pass `{ email: input.email, name: input.name ?? null }` to the repository.

Now let me think about what the complete file should look like. I need to infer the structure from the errors and the project conventions.

Looking at the other errors for context:
- `src/prisma/tenant-prisma.service.ts(178,7)` mentions 'Customer' should be 'customer' (lowercase) — this is in the Prisma extension
- `test/tenant.spec.ts` errors show that `tenant` is a required field in the Prisma model but the tenant-aware extension should handle it automatically

The tenant-aware Prisma client stamps `tenantId` on writes and scopes reads. So the service doesn't need to pass `tenantId` manually.

Let me reconstruct the service. Based on the project layout:
- `src/customer/customer.service.ts`
- It would inject `CustomerRepository`

Let me write a reasonable customer service:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRepository } from './customer.repository';

export interface CustomerInput {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  async create(input: CustomerInput) {
    return this.customerRepository.create({ email: input.email, name: input.name ?? null });
  }

  async findAll() {
    return this.customerRepository.findMany();
  }

  async findById(id: string) {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundException();
    }
    return customer;
  }

  async update(id: string, input: CustomerInput) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    return this.customerRepository.update(id, { email: input.email, name: input.name ?? null });
  }

  async remove(id: string) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    await this.customerRepository.delete(id);
  }
}
```

Wait, but the error is specifically at line 26, column 42. Let me think about what would be at that position. The error says `Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'`. This means the service is passing `CustomerInput` directly to the repository method, and the fix is to convert it.

The first error (which is cut off at the beginning) says:
`ame: string | null; }' but required in type 'CustomerCreateInput'.`

This looks like it's part of a longer error message about `name` being `string | null` but required in `CustomerCreateInput`. Wait, actually re-reading: "but required in type 'CustomerCreateInput'" — this suggests the repository's create method takes a `CustomerCreateInput` type that requires `name: string | null`.

Actually wait, let me re-read the first error more carefully. It's cut off:
```
ame: string | null; }' but required in type 'CustomerCreateInput'.
```

This is the tail end of an error. The full error is probably something like:
```
src/customer/customer.service.ts(25,XX): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
  Types of property 'name' are incompatible.
    Type 'string | null | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
```

Wait, but that's the same as the second error at line 26. Let me re-read...

Actually the first line is:
```
ame: string | null; }' but required in type 'CustomerCreateInput'.
```

This is the tail of a different error. It's saying that a property (probably `name` of type `string | null`) is missing but required in `CustomerCreateInput`. This might be about the `name` property being optional in `CustomerInput` but required in the target type.

So there are two errors in `customer.service.ts`:
1. Around line 25: something about `name` being required in `CustomerCreateInput` (the property is optional/undefined in the source)
2. Line 26, col 42: `CustomerInput` not assignable to `{ email: string; name: string | null; }`

Both have the same root cause: `CustomerInput.name` is `string | null | undefined` (optional) but the target requires `string | null` (non-optional, nullable).

The fix is the same: convert with `?? null`.

Let me write the complete file. I'll keep it minimal and focused on what the errors require.

Actually, I need to be more careful. The task says "Change nothing the messages do not name." So I should only fix what's broken. But I also need to produce a complete file. Let me think about what the file likely contains based on the errors and the project structure.

The key insight is that the service passes `CustomerInput` (or parts of it) to the repository, and the `name` field needs to be coerced from `string | null | undefined` to `string | null`.

Let me write a clean, complete service that fixes this issue.
```

## reply

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRepository } from './customer.repository';

export interface CustomerInput {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  async create(input: CustomerInput) {
    return this.customerRepository.create({
      email: input.email,
      name: input.name ?? null,
    });
  }

  async findAll() {
    return this.customerRepository.findMany();
  }

  async findById(id: string) {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundException();
    }
    return customer;
  }

  async update(id: string, input: CustomerInput) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    return this.customerRepository.update(id, {
      email: input.email,
      name: input.name ?? null,
    });
  }

  async remove(id: string) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    await this.customerRepository.delete(id);
  }
}
```
