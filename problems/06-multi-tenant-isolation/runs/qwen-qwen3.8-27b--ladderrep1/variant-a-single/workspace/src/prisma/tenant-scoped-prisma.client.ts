import type { PrismaClient } from '@prisma/client';
import { AppException } from '../common/app-exception.js';
import { tenantContext } from '../tenant/tenant-context.js';

// ASSUMPTION: Tenant is the only model that is not tenant-scoped.
const TENANTLESS_MODELS = new Set(['Tenant']);

const READ_OPERATIONS = new Set([
  'findUnique',
  'findFirst',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createTenantScopedClient(base: PrismaClient): PrismaClient {
  const dynamicBase = base as unknown as Record<string, any>;

  return base.$extends({
    query: {
      $allModels: {
        $allOperations: async ({ model, operation, args, query }: any) => {
          if (TENANTLESS_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = tenantContext.getTenantId();
          if (!tenantId) {
            throw new AppException(
              500,
              'tenant_context_missing',
              'A tenant-scoped query was issued without a tenant in context',
              { model, operation },
            );
          }

          const scopedArgs = args ? { ...args } : {};

          if (READ_OPERATIONS.has(operation)) {
            scopedArgs.where = { ...asObject(scopedArgs.where), tenantId };

            if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              const result = await dynamicBase[model].findFirst({ ...scopedArgs, where: scopedArgs.where });
              if (operation === 'findUniqueOrThrow' && result === null) {
                throw new AppException(404, 'resource_not_found', 'Record not found', { model });
              }
              return result;
            }

            return query(scopedArgs);
          }

          if (operation === 'create') {
            scopedArgs.data = { ...asObject(scopedArgs.data), tenantId };
            return query(scopedArgs);
          }

          if (operation === 'createMany') {
            const data = scopedArgs.data;
            scopedArgs.data = Array.isArray(data)
              ? data.map((item: unknown) => ({ ...asObject(item), tenantId }))
              : { ...asObject(data), tenantId };
            return query(scopedArgs);
          }

          if (operation === 'updateMany' || operation === 'deleteMany') {
            scopedArgs.where = { ...asObject(scopedArgs.where), tenantId };
            if (operation === 'updateMany') {
              scopedArgs.data = { ...asObject(scopedArgs.data), tenantId };
            }
            return query(scopedArgs);
          }

          if (operation === 'update') {
            const where = { ...asObject(scopedArgs.where), tenantId };
            const data = { ...asObject(scopedArgs.data), tenantId };
            const result = await dynamicBase[model].updateMany({ where, data });
            if (result.count === 0) {
              return null;
            }
            const lookup: Record<string, unknown> = { where };
            if (scopedArgs.include) lookup.include = scopedArgs.include;
            if (scopedArgs.select) lookup.select = scopedArgs.select;
            return dynamicBase[model].findFirst(lookup);
          }

          if (operation === 'delete') {
            const where = { ...asObject(scopedArgs.where), tenantId };
            const lookup: Record<string, unknown> = { where };
            if (scopedArgs.include) lookup.include = scopedArgs.include;
            if (scopedArgs.select) lookup.select = scopedArgs.select;
            const record = await dynamicBase[model].findFirst(lookup);
            if (record === null) {
              return null;
            }
            await dynamicBase[model].deleteMany({ where });
            return record;
          }

          if (operation === 'upsert') {
            const where = { ...asObject(scopedArgs.where), tenantId };
            scopedArgs.where = where;
            scopedArgs.create = { ...asObject(scopedArgs.create), tenantId };
            if (scopedArgs.update) {
              scopedArgs.update = { ...asObject(scopedArgs.update), tenantId };
            }
            return query(scopedArgs);
          }

          throw new AppException(
            500,
            'tenant_scoping_unsupported',
            `Tenant-aware Prisma client does not support operation ${operation} on ${model}`,
            { model, operation },
          );
        },
      },
    },
  } as any) as unknown as PrismaClient;
}
