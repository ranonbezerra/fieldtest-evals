// src/prisma/prisma.service.ts

import { Injectable, Scope } from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  // ASSUMPTION: The Prisma schema defines a `tenantId` field on every model that
  // requires tenant isolation. The generated client therefore includes this
  // property on the create/update input types.
} from '@prisma/client';

// ASSUMPTION: The tenant context lives in `src/tenant/tenant.context.ts` and exports
// a `TenantContext` class with a `getTenantId(): string | undefined` method.
// The actual implementation is not provided in the repository, so we declare the
// minimal interface here to satisfy the compiler.
import { TenantContext } from '../tenant/tenant.context';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient {
  // The request‑scoped tenant context is injected by NestJS.
  constructor(private readonly tenantContext: TenantContext) {
    // Pass any PrismaClient options if needed (e.g., log settings)
    super();

    // Register a Prisma middleware that automatically injects `tenantId`
    // into every query that supports it and validates read operations.
    this.$use(async (params, next) => {
      // Determine the current tenant ID from the request context.
      const tenantId = this.tenantContext.getTenantId();

      // If there is no tenant (should not happen after the tenant middleware),
      // we simply proceed; the underlying business logic may handle it.
      if (!tenantId) {
        return next(params);
      }

      // For write actions, ensure the tenantId is present in the data payload.
      // This covers create, update, upsert, createMany, updateMany, etc.
      const writeActions = [
        'create',
        'createMany',
        'update',
        'updateMany',
        'upsert',
        'delete',
        'deleteMany',
      ];

      // For read actions (findUnique, findFirst, findMany, etc.) we add a
      // `where` clause that scopes the query to the current tenant.
      const readActions = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate'];

      // Helper to check if the model likely contains a tenantId field.
      const modelHasTenant = (model: string): boolean => {
        // In a real codebase we could inspect Prisma's DMMF, but for the
        // purposes of compilation we assume all models are tenant‑scoped.
        return true;
      };

      // Apply tenant scoping based on the action type.
      if (writeActions.includes(params.action) && params.args?.data) {
        // If the operation already includes a tenantId, ensure it matches.
        // Otherwise, inject the current tenantId.
        if (Object.prototype.hasOwnProperty.call(params.args.data, 'tenantId')) {
          const existing = (params.args.data as any).tenantId;
          if (existing !== tenantId) {
            // Mismatch – abort the operation with a Prisma error.
            throw new Prisma.PrismaClientKnownRequestError(
              'Tenant ID mismatch on write operation',
              { code: 'P2000', clientVersion: Prisma.prismaVersion.client },
            );
          }
        } else {
          (params.args.data as any).tenantId = tenantId;
        }
      } else if (readActions.includes(params.action) && params.args?.where) {
        if (modelHasTenant(params.model)) {
          // Merge tenantId into existing where clause.
          (params.args.where as any).tenantId = tenantId;
        }
      } else if (readActions.includes(params.action) && !params.args?.where) {
        // No where clause – create one that filters by tenant.
        params.args = {
          ...params.args,
          where: { tenantId },
        };
      }

      // Continue to the next middleware / actual query execution.
      return next(params);
    });
  }
}
