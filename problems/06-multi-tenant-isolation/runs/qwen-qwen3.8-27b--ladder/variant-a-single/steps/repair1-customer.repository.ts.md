# repair1-customer.repository.ts

## reasoning

```
Let me analyze the compiler errors to understand what's needed in `src/customer/customer.repository.ts`:

1. From `customer.service.ts(26,42)`: The `update` method is called with `CustomerInput` which has `name?: string | null` (optional), but the repository expects `{ email: string; name: string | null; }` (required, not undefined). So the repository's `update` method signature needs to accept `name` as `string | null` (not `string | null | undefined`).

Wait, let me re-read. The service does:
```typescript
return this.customerRepository.update(id, {
  email: input.email,
  name: input.name ?? null,
});
```

So the service is already converting `undefined` to `null` before passing to the repository. The error says:
```
src/customer/customer.service.ts(26,42): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
```

Wait, line 26 column 42... Let me count. The service file shown is:
```
1: import { Injectable, NotFoundException } from '@nestjs/common';
2: import { CustomerRepository } from './customer.repository';
3: 
4: export interface CustomerInput {
5:   email: string;
6:   name?: string | null;
7: }
8: 
9: @Injectable()
10: export class CustomerService {
11:   constructor(private readonly customerRepository: CustomerRepository) {}
12: 
13:   async create(input: CustomerInput) {
14:     return this.customerRepository.create({
15:       email: input.email,
16:       name: input.name ?? null,
17:     });
18:   }
19: 
20:   async findAll() {
21:     return this.customerRepository.findMany();
22:   }
23: 
24:   async findById(id: string) {
25:     const customer = await this.customerRepository.findById(id);
26:     if (!customer) {
27:       throw new NotFoundException();
28:     }
29:     return customer;
30:   }
31: 
32:   async update(id: string, input: CustomerInput) {
33:     const existing = await this.customerRepository.findById(id);
34:     if (!existing) {
35:       throw new NotFoundException();
36:     }
37:     return this.customerRepository.update(id, {
38:       email: input.email,
39:       name: input.name ?? null,
40:     });
41:   }
42: 
43:   async remove(id: string) {
44:     const existing = await this.customerRepository.findById(id);
45:     if (!existing) {
46:       throw new NotFoundException();
47:     }
48:     await this.customerRepository.delete(id);
49:   }
50: }
```

Wait, the error says line 26, column 42. But line 26 is `if (!customer) {`. That doesn't make sense for the error message about `CustomerInput` not being assignable.

Hmm, maybe the line numbers in the error refer to a different version of the file. Let me re-read the error:

```
src/customer/customer.service.ts(26,42): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
  Types of property 'name' are incompatible.
    Type 'string | null | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
```

So the error is in `customer.service.ts` at line 26, column 42. The error says an argument of type `CustomerInput` is being passed where `{ email: string; name: string | null; }` is expected. This means the repository's `update` method (or `create` method) has a parameter typed as `{ email: string; name: string | null; }` and the service is passing `CustomerInput` which has `name?: string | null`.

But wait - the service code shown already does `input.name ?? null`. So either:
1. The actual file in the workspace is different from what's shown (the shown version is a reference, not the actual current state)
2. The line numbers point to a different method

Actually, re-reading the task: "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

And: "Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file."

So I need to fix `customer.repository.ts` to resolve the errors. The errors that relate to this file are:

1. The first truncated error: `ame: string | null; }' but required in type 'CustomerCreateInput'.` - This seems to be about `tenant` being required in `CustomerCreateInput` but not provided.

2. `src/customer/customer.service.ts(26,42)` - This is about the repository method accepting `{ email: string; name: string | null; }` but the service passing `CustomerInput` (which has optional name).

Wait, but the task says "Change nothing the messages do not name." So I should only fix things that the errors reference. The errors reference:
- `customer.service.ts(26,42)` - this is in the service file, not the repository
- `tenant-prisma.service.ts(178,7)` - this is in the tenant prisma service
- `test/helpers.ts(125,9)` and `(126,9)` - in test helpers
- `test/tenant.spec.ts` - multiple lines

But the task says to rewrite `src/customer/customer.repository.ts` fixing what these messages require of this file.

Let me think about what the repository file needs to look like based on the errors:

The error at `customer.service.ts(26,42)` says the repository expects `{ email: string; name: string | null; }` but the service passes `CustomerInput` which has `name?: string | null`. 

Wait, but the service code shown already does `input.name ?? null`. So if the service is already converting, the repository should accept `string | null` for name. The error suggests the service is NOT doing the conversion (passing `CustomerInput` directly), which means the actual service file in the workspace might be different from the reference.

Hmm, but the task says "Rely on them" - so I should trust the reference material. Let me re-read...

Actually wait. The task says the blocks are reference material and I should rely on them. The error message says the service is passing `CustomerInput` type (with optional name) to the repository. If the service file is as shown (with `input.name ?? null`), then the repository's parameter type would need to be `{ email: string; name: string | null; }` and it would work fine because `input.name ?? null` produces `string | null`.

But the error says the argument is of type `CustomerInput` (the interface with optional name). This means the actual service code in the workspace is passing `input` directly (the whole `CustomerInput` object) rather than destructuring with `?? null`.

So the actual service file in the workspace must be different from the reference. The reference shows the "intended" code, but the actual code that's failing has a different implementation.

Given that I can only modify `customer.repository.ts`, I need to make the repository accept the `CustomerInput` type (with optional `name`). So the repository's parameter types should use `name?: string | null` or accept the interface.

Actually wait - let me re-read more carefully. The task says:

"Rewrite `src/customer/customer.repository.ts` complete, fixing what these messages require of this file."

So I need to figure out what the repository should look like. Based on the errors:

1. The repository's `create` and `update` methods need to accept `name` as optional (or `string | null | undefined`) because the service is passing `CustomerInput` directly.

2. The first truncated error mentions `CustomerCreateInput` requiring `tenant` - this is about the Prisma client. The repository should NOT pass `tenant` manually because the tenant-aware Prisma client handles that (per the plan: "handlers never pass tenantId manually").

3. The `test/tenant.spec.ts` errors show that in tests, they're creating customers with just `{ email: string }` or `{ email: string; name: string; }` without `tenant` - this means the repository's interface should NOT require `tenant`.

So the repository should:
- Have methods: `create`, `findMany`, `findById`, `update`, `delete`
- Accept input without `tenant` (the tenant-aware Prisma client handles scoping)
- The `create` method should accept `{ email: string; name?: string | null }` (matching `CustomerInput`)
- The `update` method should accept `{ email: string; name?: string | null }` (matching `CustomerInput`)

Now, for the Prisma model, based on the errors mentioning `CustomerCreateInput` requiring `tenant`, the Prisma model likely has a `tenant` field (or relation). But the repository should NOT pass it - the tenant-aware extension handles it.

Let me think about what the Prisma model looks like. Based on the errors:
- There's a `Customer` model with `tenant` field (or relation to a Tenant model)
- The `CustomerCreateInput` requires `tenant`

The repository should use the tenant-aware Prisma client which auto-scopes queries and stamps writes with the tenant.

Let me think about the Prisma client usage. The tenant-aware service likely provides a `PrismaClient` (or extended client) that already has tenant scoping built in. The repository injects this service and uses it.

Looking at the error from `tenant-prisma.service.ts(178,7)`:
```
error TS2561: Object literal may only specify known properties, but 'Customer' does not exist in type 'DynamicQueryExtensionArgs<...>'. Did you mean to write 'customer'?
```

This is in the tenant-prisma service, not in the repository. It's about using `Customer` (capital C) instead of `customer` (lowercase) in the extension args. This is a bug in `tenant-prisma.service.ts`, not in the repository. Since I'm only fixing the repository, I'll ignore this.

Now let me construct the repository. Based on the service code (reference):
- `create({ email, name })` where name is `string | null`
- `findMany()` - no args
- `findById(id: string)` - returns customer or null/undefined
- `update(id: string, { email, name })` 
- `delete(id: string)`

But the error says the service is passing `CustomerInput` (with `name?: string | null`) directly. So the repository should accept `name` as optional.

Wait, I need to be more careful. Let me re-read the error:

```
src/customer/customer.service.ts(26,42): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
```

This tells me:
- The repository method's parameter is typed as `{ email: string; name: string | null; }` (name is required, can be string or null)
- The service is passing `CustomerInput` which is `{ email: string; name?: string | null; }` (name is optional)
- The fix: make the repository accept `name?: string | null`

But wait - I'm told to fix the repository. If I change the repository's parameter to accept `name?: string | null`, that fixes the type error.

Now, what about the `tenant` issue? The test errors show:
```
Property 'tenant' is missing in type '{ email: string; }' but required in type 'CustomerCreateInput'.
```

This means when the tests call the repository (or service) to create a customer, they're passing `{ email: string }` without `tenant`. The `CustomerCreateInput` (Prisma's type) requires `tenant`. 

But the plan says "handlers never pass tenantId manually" - the tenant-aware Prisma client should stamp it. So the repository should use the tenant-aware client which handles `tenant` automatically.

The issue is likely that the repository is using raw Prisma types (`CustomerCreateInput`) which require `tenant`, but it should be using the tenant-aware client that handles it.

Let me think about how the tenant-aware Prisma client works. It likely:
1. For reads: adds `WHERE tenant = <currentTenant>` automatically
2. For writes: adds `tenant = <currentTenant>` automatically

So the repository should use this extended client, and the types should work out. The extended client might have different types that don't require `tenant` in the input.

Actually, looking at this more carefully - if the tenant-aware extension handles stamping `tenant` on writes, then the Prisma types for the extended client might still require `tenant` in `CustomerCreateInput` because Prisma's types are generated from the schema. The extension just adds it at runtime.

In that case, the repository might need to cast or use `as any` for the `tenant` field, or the extension might provide its own types.

Hmm, but the task says I should only fix what the messages require of THIS file. Let me focus on what I can determine:

1. The repository needs methods: `create`, `findMany`, `findById`, `update`, `delete`
2. `create` and `update` should accept `name` as `string | null | undefined` (or optional) to match `CustomerInput`
3. The repository should NOT include `tenant` in its input types (the tenant-aware client handles it)

For the Prisma usage, since the tenant-aware client stamps `tenant` automatically, the repository just passes `{ email, name }` to the Prisma client. If Prisma's types require `tenant`, we might need a type assertion.

Let me write the repository:

```typescript
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface CustomerInput {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantPrismaService) {}

  async create(input: CustomerInput) {
    return this.prisma.customer.create({
      data: {
        email: input.email,
        name: input.name ?? null,
      },
    });
  }

  async findMany() {
    return this.prisma.customer.findMany();
  }

  async findById(id: string) {
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  async update(id: string, input: CustomerInput) {
    return this.prisma.customer.update({
      where: { id },
      data: {
        email: input.email,
        name: input.name ?? null,
      },
    });
  }

  async delete(id: string) {
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
```

Wait, but I don't know the exact name of the tenant Prisma service or how to access the client through it. Let me look at the error again:

```
src/prisma/tenant-prisma.service.ts(178,7): error TS2561: ...
```

So the file is `src/prisma/tenant-prisma.service.ts`. The class is likely `TenantPrismaService`. But how does it expose the Prisma client? It might extend `PrismaService` or provide a `getTenantClient()` method, or it might BE the Prisma client.

Actually, looking at common patterns for tenant-aware Prisma in NestJS, the `TenantPrismaService` might:
- Extend `PrismaService` and override methods
- Or provide a method to get a tenant-scoped client
- Or use `AsyncLocalStorage` to store the tenant and have the Prisma extension read from it

Given that the plan says "a tenant-aware Prisma client (extension/middleware) that scopes every read and stamps every write", it's likely using Prisma's `$extends` with a query extension that reads the tenant from an AsyncLocalStorage context.

In that case, the repository might just inject the regular `PrismaService` (which is already extended) or the `TenantPrismaService`.

Hmm, I'm making too many assumptions. Let me look at what I can infer:

From the service code, the repository is called as:
- `this.customerRepository.create({ email, name })`
- `this.customerRepository.findMany()`
- `this.customerRepository.findById(id)`
- `this.customerRepository.update(id, { email, name })`
- `this.customerRepository.delete(id)`

The error at service line 26 says the parameter type is `{ email: string; name: string | null; }`. So the current repository has this type. I need to change it to accept `name?: string | null` (optional).

Actually wait - I just realized something. The error says:
```
Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
```

This means the service is passing the `CustomerInput` object directly (not destructured). Looking at the reference service code:

```typescript
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
```

Here it's destructuring and using `?? null`. So the argument would be `{ email: string; name: string | null }` which IS assignable to `{ email: string; name: string | null; }`. No error.

But the error says the argument is of type `CustomerInput`. This means the ACTUAL code in the workspace is different - it's passing `input` directly:
```typescript
return this.customerRepository.update(id, input);
```

So the actual service code passes `CustomerInput` (with optional name) directly to the repository. The fix is to make the repository accept `CustomerInput` (with optional name).

OK so my fix is correct: the repository should accept `name` as optional (`string | null | undefined` or `?: string | null`).

Now for the Prisma call inside the repository, I need `name` to be `string | null` (not undefined) for Prisma. So inside the method, I'll do `input.name ?? null`.

For the `tenant` issue - the tests are failing because they're calling Prisma directly (not through the repository) with `{ email: string }` and Prisma requires `tenant`. But that's a test issue, not a repository issue. The task says to fix the repository only.

Wait, but the task says "fixing what these messages require of this file." The test errors are about test files, not the repository. The only error that directly affects the repository is the type mismatch in the service call.

Let me also consider: does the repository need to import `CustomerInput` from the service, or define its own interface? Looking at the reference service, it defines `CustomerInput` in the service file. The repository might import it or define its own.

Since the error says the repository's parameter is `{ email: string; name: string | null; }` (an inline type), the current repository probably defines its own inline type. I should change it to accept optional name.

Let me also think about whether the repository uses `TenantPrismaService` or `PrismaService`. Given the layout convention and the existence of `src/prisma/tenant-prisma.service.ts`, it's likely the repository injects `TenantPrismaService`.

But I don't know the exact interface of `TenantPrismaService`. It might:
- Be a class that extends PrismaService and has the tenant-aware extension
- Have a property like `client` or `prisma` that gives access to the extended client
- Or the repository might use it differently

Given the uncertainty, and that the task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line", I'll add an assumption about the TenantPrismaService interface.

Actually, let me reconsider. The most common pattern in NestJS + Prisma multi-tenant setups is:

1. `PrismaService` extends `PrismaClient` (standard NestJS pattern)
2. `TenantPrismaService` wraps or extends it with tenant-aware behavior

The repository would inject `TenantPrismaService` and call methods on it like `this.tenantPrisma.customer.findMany()`.

Alternatively, `TenantPrismaService` might provide a method like `getClient(tenantId)` or use AsyncLocalStorage internally.

Given the plan says "handlers never pass tenantId manually" and "Tenant lives in request-scoped context", it's likely using AsyncLocalStorage. The Prisma extension reads the tenant from the context and applies it automatically.

In that case, the repository just uses the Prisma client normally, and the extension handles tenant scoping. The repository would inject the service that provides the extended client.

Let me go with a reasonable assumption. I'll assume `TenantPrismaService` extends or wraps `PrismaClient` and can be used directly as a Prisma client (i.e., you can call `.customer.findMany()` on it).

Here's my final repository:

```typescript
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

// ASSUMPTION: TenantPrismaService exposes the extended Prisma client directly (i.e., can be used as a PrismaClient instance with .customer, .plan, .order models).

export interface CustomerData {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(data: CustomerData) {
    return this.tenantPrisma.customer.create({
      data: {
        email: data.email,
        name: data.name ?? null,
      },
    });
  }

  async findMany() {
    return this.tenantPrisma.customer.findMany();
  }

  async findById(id: string) {
    return this.tenantPrisma.customer.findUnique({
      where: { id },
    });
  }

  async update(id: string, data: CustomerData) {
    return this.tenantPrisma.customer.update({
      where: { id },
      data: {
        email: data.email,
        name: data.name ?? null,
      },
    });
  }

  async delete(id: string) {
    return this.tenantPrisma.customer.delete({
      where: { id },
    });
  }
}
```

Wait, but the error mentions `CustomerCreateInput` requiring `tenant`. If I call `this.tenantPrisma.customer.create({ data: { email, name } })`, TypeScript will complain that `tenant` is missing from `CustomerCreateInput` because Prisma's generated types require it.

This is the core tension: Prisma's types require `tenant`, but the tenant-aware extension adds it at runtime. The solution is typically one of:
1. Use a type assertion: `as any`
2. The extension provides its own types
3. Make `tenant` optional in the Prisma schema (but that defeats the purpose)
4. The tenant-aware service overrides the types

Since the test errors also show this issue (`Property 'tenant' is missing`), and the plan says the tenant-aware client handles it, I think the intended approach is that the `TenantPrismaService` provides a client whose types don't require `tenant` (because the extension handles it).

But if that's the case, then `this.tenantPrisma.customer.create({ data: { email, name } })` would work type-wise.

Alternatively, if `TenantPrismaService` is just a wrapper around the standard `PrismaClient`, then we'd need type assertions.

Given the uncertainty, let me add an assumption and use a type-safe approach. I'll assume the `TenantPrismaService` provides the extended client with proper types that don't require manual `tenant`.

Actually, you know what, let me reconsider the whole thing. The task says "fixing what these messages require of this file." The messages that affect THIS file (the repository) are:

1. The type mismatch: repository expects `{ email: string; name: string | null; }` but gets `CustomerInput` (with optional name). Fix: make name optional in the repository's parameter.

That's it. The other errors are in other files. The task says "Change nothing the messages do not name."

So I just need to:
1. Make the `name` field optional in the repository's input types
2. Keep everything else the same

But I don't have the current repository file! I only have the service file (reference) and the error messages. I need to reconstruct the repository.

From the service calls, I can infer the repository interface:
- `create(input: { email: string; name: string | null; })` → needs to be `{ email: string; name?: string | null; }`
- `findMany(): Promise<Customer[]>`
- `findById(id: string): Promise<Customer | null>`
- `update(id: string, input: { email: string; name: string | null; })` → needs to be `{ email: string; name?: string | null; }`
- `delete(id: string): Promise<Customer>`

For the Prisma usage inside, I'll assume the standard pattern with `TenantPrismaService`.

Let me finalize my answer. I'll keep it clean and focused on what the errors require.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

// ASSUMPTION: TenantPrismaService exposes the tenant-scoped Prisma client directly, so model delegates (e.g. .customer) are available as properties and their generated input types no longer require a manual `tenant` field (the extension stamps it at runtime).

export interface CustomerData {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(data: CustomerData) {
    return this.tenantPrisma.customer.create({
      data: {
        email: data.email,
        name: data.name ?? null,
      },
    });
  }

  async findMany() {
    return this.tenantPrisma.customer.findMany();
  }

  async findById(id: string) {
    return this.tenantPrisma.customer.findUnique({
      where: { id },
    });
  }

  async update(id: string, data: CustomerData) {
    return this.tenantPrisma.customer.update({
      where: { id },
      data: {
        email: data.email,
        name: data.name ?? null,
      },
    });
  }

  async delete(id: string) {
    return this.tenantPrisma.customer.delete({
      where: { id },
    });
  }
}
```
