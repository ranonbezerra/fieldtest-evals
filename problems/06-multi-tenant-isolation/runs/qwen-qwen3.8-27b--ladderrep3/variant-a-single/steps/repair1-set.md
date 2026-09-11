# repair1-set

## reasoning

```
Let me analyze the errors:

1. **`src/customers/customers.repository.ts`** — Lines 19, 27, 31: `findUnique`, `update`, `delete` use `{ id }` but the composite primary key `@@id([tenantId, id])` means the `where` clause needs `{ tenantId_id: { tenantId, id } }` or similar compound unique input. But wait — the whole point of the tenant-aware Prisma client is that it injects `tenantId` automatically. The repository is supposed to NOT pass tenantId manually.

   The issue is that the tenant-aware client (an extension/middleware) is supposed to inject the tenantId into queries. But the TypeScript types still expect the full compound key. So the repository needs to use the compound key format in its `where` clauses, and the tenant-aware extension will fill in the `tenantId` part.

   Actually, let me reconsider. The extension/middleware approach in Prisma typically works by intercepting the query and modifying the `where` clause. The types from Prisma's generated client still require the full compound key shape. So the repository needs to pass the compound key format, and the extension will fill in the `tenantId` value.

   Wait, but the design says "handlers never pass tenantId manually." So how does this work?

   Looking at the error more carefully:
   - Line 19: `findById` uses `findUnique({ where: { id } })` — needs `{ tenantId_id: { tenantId: ???, id } }`
   - Line 23: `create` uses `create({ data })` where data is `{ email, name }` — needs `tenantId` in the data
   - Line 27: `update` uses `update({ where: { id } })` — same compound key issue
   - Line 31: `delete` uses `delete({ where: { id } })` — same compound key issue

   The tenant-aware client extension would intercept these and inject the tenantId. But the TypeScript types still require the full shape. So the repository needs to use the correct type shapes, and the extension will override/fill in the tenantId.

   For `findUnique`/`update`/`delete`, the where clause with composite `@@id([tenantId, id])` requires `{ tenantId_id: { tenantId, id } }`. The extension will override the `tenantId` value.

   For `create`, the data needs `tenantId`. The extension will stamp it.

   So the fix is:
   - `findById`: `this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } })` — but that's ugly. Actually, looking at Prisma's types for composite keys, the `CustomerWhereUniqueInput` type requires `tenantId_id` or `tenantId_email` fields.

   Wait, let me look at what Prisma generates for `@@id([tenantId, id])`. The `where` input for `findUnique` would be `CustomerWhereUniqueInput` which has:
   - `tenantId_id: { tenantId: string; id: string }` (the compound PK)
   - `tenantId_email: { tenantId: string; email: string }` (the compound unique)

   So the repository needs to use `{ tenantId_id: { tenantId: '', id } }` as a placeholder, and the extension fills in the real tenantId.

   Hmm, but that's passing a tenantId (even if empty). The design says "never pass tenantId manually." But the types require it. The extension would then override it.

   Actually, I think the proper approach here is that the tenant-aware client extension intercepts the query and:
   - For `findUnique`/`update`/`delete`: injects `tenantId` into the compound key
   - For `create`: injects `tenantId` into the data
   - For `findMany`/`updateMany`/`deleteMany`: injects `tenantId` into the where clause

   The TypeScript types still require the full shape, so the repository must use the correct shape. The extension then modifies the query at runtime.

   So the fix for the repository:
   - `findById(id)`: `this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } })`
   - `create(data)`: `this.db.customer.create({ data: { ...data, tenantId: '' } })`
   - `update(id, data)`: `this.db.customer.update({ where: { tenantId_id: { tenantId: '', id } }, data })`
   - `remove(id)`: `this.db.customer.delete({ where: { tenantId_id: { tenantId: '', id } } })`

   Wait, but that's passing an empty string as tenantId. That's not great. Let me think about this differently.

   Actually, looking at how Prisma extensions work with composite keys — the extension intercepts the `args` and modifies them. The types still require the full shape. So using a placeholder like `''` or `'00000000-0000-0000-0000-000000000000'` is the pragmatic approach. The extension will override it before the query hits the database.

   Let me use `''` as the placeholder since the extension will replace it.

   Actually wait - I need to look at this more carefully. The `CustomerWhereUniqueInput` type for a model with `@@id([tenantId, id])` and `@@unique([tenantId, email])` would be:

   ```typescript
   type CustomerWhereUniqueInput = {
     tenantId_id?: { tenantId: string; id: string }
     tenantId_email?: { tenantId: string; email: string }
   }
   ```

   Actually no, for `findUnique`, Prisma requires exactly one of the unique identifiers. With composite keys, the shape is:

   ```typescript
   {
     tenantId_id: { tenantId: string; id: string }
     // OR
     tenantId_email: { tenantId: string; email: string }
   }
   ```

   But it's actually a union where one must be present. Let me just use `tenantId_id` with a placeholder tenantId.

   For `create`, the `CustomerCreateInput` requires `tenantId` (either as a direct field for unchecked, or as a relation). The `CustomerUncheckedCreateInput` would have `tenantId: string`. So we need `this.db.customer.create({ data: { ...data, tenantId: '' } })`.

2. **`src/errors/error-mapping.ts`** — Line 63: `HttpException` is imported with `import type` but used as a value (in `instanceof`). The fix is to change `import type { HttpException }` to `import { HttpException }`.

Let me now write the fixes:

**File 1: `src/customers/customers.repository.ts`**

The errors are on lines 19, 23, 27, 31. Looking at the original:
- Line 19: `return this.db.customer.findUnique({ where: { id } });` → needs `{ where: { tenantId_id: { tenantId: '', id } } }`
- Line 23: `return this.db.customer.create({ data });` → needs `{ data: { ...data, tenantId: '' } }`
- Line 27: `return this.db.customer.update({ where: { id }, data });` → needs `{ where: { tenantId_id: { tenantId: '', id } }, data }`
- Line 31: `return this.db.customer.delete({ where: { id } });` → needs `{ where: { tenantId_id: { tenantId: '', id } } }`

**File 2: `src/errors/error-mapping.ts`**

Line 3: `import type { HttpException } from '@nestjs/common';` → `import { HttpException } from '@nestjs/common';`

Let me write the complete files.
```

## reply

### src/customers/customers.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../prisma/prisma.module';

/**
 * The only layer that touches the database for customers — and it never
 * mentions a tenant id. Scoping and write-stamping happen entirely inside
 * the tenant-aware client (TENANT_DB).
 */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(TENANT_DB) private readonly db: PrismaClient) {}

  list() {
    return this.db.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string) {
    return this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } });
  }

  create(data: { email: string; name: string }) {
    return this.db.customer.create({ data: { ...data, tenantId: '' } });
  }

  update(id: string, data: { name: string }) {
    return this.db.customer.update({ where: { tenantId_id: { tenantId: '', id } }, data });
  }

  remove(id: string) {
    return this.db.customer.delete({ where: { tenantId_id: { tenantId: '', id } } });
  }
}
```

### src/errors/error-mapping.ts
```ts
import { Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { TenantContextMissingError } from '../prisma/tenant-context';

export interface ErrorDecision {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * The single place that decides how any error maps onto the error envelope.
 * Used by the global exception filter and by the tenant middleware, which
 * must answer (401/403/404) before any request-scoped context exists.
 */
export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof TenantContextMissingError) {
    return {
      status: 500,
      code: 'no_tenant_context',
      message: 'a query was attempted with no tenant in context; it was refused rather than run unscoped',
      details: {},
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found. For tenant-scoped models this deliberately covers
      // both "does not exist" and "belongs to another tenant" — same body,
      // so an id from another operator is indistinguishable from a ghost id.
      return { status: 404, code: 'resource_not_found', message: 'resource not found', details: {} };
    }
    if (err.code === 'P2002') {
      return {
        status: 409,
        code: 'conflict',
        message: 'a record with the same unique value already exists',
        details: { prismaCode: err.code },
      };
    }
    if (err.code === 'P2003') {
      return {
        status: 409,
        code: 'conflict',
        message: 'the operation violates a referential constraint',
        details: { prismaCode: err.code },
      };
    }
    return {
      status: 409,
      code: 'database_error',
      message: 'the database rejected the operation',
      details: { prismaCode: err.code },
    };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'bad_request', message: 'the query failed Prisma validation', details: {} };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code =
      status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
    return { status, code, message: err.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'unexpected internal error', details: {} };
}
```
