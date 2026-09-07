# repair1-prisma.service.ts

## reasoning

```
We need to write PrismaService that imports PrismaClient correctly. Likely need to install @prisma/client but assume exists. Use import { PrismaClient, Prisma } from '@prisma/client'; Also need TenantContext import path. Probably '../tenant/tenant.context' exists but missing; we assume it exports a class TenantContext with static getTenantId() maybe. We'll just import { TenantContext } from '../tenant/tenant.context'; Provide placeholder.

Implement class PrismaService extends PrismaClient with request-scoped? Use NestJS Injectable with Scope.REQUEST.

Add middleware to Prisma client using $use to inject tenantId into queries.

Implement $connect and $disconnect methods calling super.

Write code accordingly.
```

## reply

```typescript
// src/prisma/prisma.service.ts

import { Injectable, Scope } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant.context';

// ASSUMPTION: TenantContext provides a static method `getTenantId()` that returns the
// currently resolved tenant identifier (string). If the actual implementation differs,
// adjust the call accordingly.

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient {
  constructor() {
    super();

    // Prisma middleware that automatically scopes every query to the current tenant.
    // It injects `tenantId` into `where` clauses for reads and adds it to `data`
    // for creates/updates. This implements the “tenant‑aware Prisma client” requirement.
    this.$use(async (params: Prisma.MiddlewareParams, next) => {
      const tenantId = TenantContext.getTenantId();

      // If there is no tenant (e.g., during early bootstrap), just proceed.
      if (!tenantId) {
        return next(params);
      }

      // Helper to ensure the tenant filter is present.
      const addTenantFilter = (where: any) => ({
        AND: [{ tenantId }, ...(where ? [where] : [])],
      });

      // Helper to inject tenantId into data payloads.
      const addTenantToData = (data: any) => ({
        ...data,
        tenantId,
      });

      // Adjust the query based on its action type.
      switch (params.action) {
        // READ operations – enforce tenant filter.
        case 'findUnique':
        case 'findFirst':
        case 'findMany':
          if (params.model) {
            params.args = {
              ...params.args,
              where: addTenantFilter(params.args.where),
            };
          }
          break;

        // CREATE operations – stamp tenantId.
        case 'create':
        case 'createMany':
          if (params.model) {
            params.args = {
              ...params.args,
              data: addTenantToData(params.args.data),
            };
          }
          break;

        // UPDATE operations – enforce tenant filter and stamp tenantId.
        case 'update':
        case 'updateMany':
        case 'upsert':
          if (params.model) {
            // Ensure we only affect rows belonging to the tenant.
            params.args = {
              ...params.args,
              where: addTenantFilter(params.args.where),
              data: addTenantToData(params.args.data),
            };
          }
          break;

        // DELETE operations – enforce tenant filter.
        case 'delete':
        case 'deleteMany':
          if (params.model) {
            params.args = {
              ...params.args,
              where: addTenantFilter(params.args.where),
            };
          }
          break;

        default:
          // No special handling for other actions.
          break;
      }

      return next(params);
    });
  }

  // Explicitly expose connect / disconnect so callers (e.g., app bootstrap) can
  // await them without TypeScript complaints about missing members.
  async $connect(): Promise<void> {
    // PrismaClient already implements $connect; we just forward the call.
    await super.$connect();
  }

  async $disconnect(): Promise<void> {
    await super.$disconnect();
  }
}
```
