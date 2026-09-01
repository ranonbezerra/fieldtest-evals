# 06-operations.repository.ts-retry

## reasoning

```
The plan specifies `OperationsRepository` in `src/operations/operations.repository.ts`:

```ts
class OperationsRepository {
  constructor(prisma: PrismaClient);
  findPage(params: OperationQueryParams): Promise<OperationPage>;
}
```

It's the read-path Prisma query on `operation_read_models`. It needs to:
- Query `operation_read_models` with filters for `companyId`, optional `status`, optional date range (`from`/`to`)
- Sort by `created_at DESC`
- Paginate with `page` (1-based) and `pageSize`
- Return `OperationPage` with `items`, `total`, `page`, `pageSize`

The projection table is `operation_read_models` mapped from a Prisma model. Looking at the plan's schema, the model would be `OperationReadModel` (PascalCase of `operation_read_models`).

I need to use `@Injectable()` decorator for NestJS DI, and inject `PrismaClient`.

The Prisma model name would be `OperationReadModel` based on the table name `operation_read_models`. The fields map to:
- `id` → String
- `companyId` → String (mapped from `company_id`)
- `workerId` → String (mapped from `worker_id`)
- `workerName` → String (mapped from `worker_name`)
- `eventId` → String (mapped from `event_id`)
- `eventTitle` → String (mapped from `event_title`)
- `eventLocation` → String (mapped from `event_location`)
- `status` → OrderStatus
- `amountCents` → Int (mapped from `amount_cents`)
- `createdAt` → DateTime (mapped from `created_at`)
- `updatedAt` → DateTime (mapped from `updated_at`)

For the query, I need to build a Prisma `where` clause based on the params:
- `companyId` is always required
- `status` is optional
- `from` and `to` are optional (for `createdAt` range)

The query should use `orderBy: { createdAt: 'desc' }`, `skip: (page - 1) * pageSize`, `take: pageSize`.

I also need a `count` query for the total.

Let me write this:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { OperationPage, OperationQueryParams, OperationRow } from '../projections/projections.types.js';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPage(params: OperationQueryParams): Promise<OperationPage> {
    const { companyId, status, from, to, page, pageSize } = params;

    const where: Prisma.OperationReadModelWhereInput = {
      companyId,
      ...(status !== undefined && { status }),
      ...(from !== undefined || to !== undefined
        ? {
            createdAt: {
              ...(from !== undefined && { gte: from }),
              ...(to !== undefined && { lt: to }),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
```

Wait, I need to think about the Prisma client accessor name. With the model `OperationReadModel`, the Prisma client property would be `operationReadModel` (camelCase of the model name).

For the import path, since this is ESM with `"type": "module"`, I should use `.js` extension. But wait, looking at the plan's manifest, it says this file reads `src/projections/projections.types.ts`. In ESM TypeScript with NestJS, the convention is typically to use `.js` extensions in imports. Let me use that.

Actually, let me reconsider. The project uses ESM with `"type": "module"`. In TypeScript ESM, you typically import with `.js` extensions. But some projects use path aliases or other conventions. Since I don't have more info, I'll use relative paths with `.js` extension which is the standard ESM TypeScript convention.

Let me also think about whether `status` in the Prisma where clause should be the string or an enum. Looking at the plan, `OrderStatus` is defined as a Prisma enum (`enum OrderStatus { pending approved rejected }`). In Prisma, when you use an enum in a where clause, you can just pass the string value and it works. So `{ status }` where `status` is `'pending' | 'approved' | 'rejected'` should work fine with Prisma's type system since the enum values match.

Actually, to be safe and type-correct, I might need to cast it. But Prisma enums in TypeScript are typically represented as string literal unions, so it should be fine.

Let me finalize the file.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPage(params: OperationQueryParams): Promise<OperationPage> {
    const { companyId, status, from, to, page, pageSize } = params;

    const where: Prisma.OperationReadModelWhereInput = {
      companyId,
      ...(status !== undefined && { status }),
      ...((from !== undefined || to !== undefined) && {
        createdAt: {
          ...(from !== undefined && { gte: from }),
          ...(to !== undefined && { lt: to }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
```
