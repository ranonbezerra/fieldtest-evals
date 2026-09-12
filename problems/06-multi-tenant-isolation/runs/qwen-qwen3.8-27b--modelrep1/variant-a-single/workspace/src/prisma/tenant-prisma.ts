import { PrismaClient } from '@prisma/client';
import { currentTenant } from '../common/tenant-context.js';

/**
 * Models whose rows are owned by a tenant. `Tenant` is intentionally
 * excluded: it defines the tenancy dimension, it is not tenant-owned data.
 */
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

/** Read/write operations whose `where` must be intersected with the tenant id. */
const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Write operations whose `data` payload must be stamped with the tenant id. */
const DATA_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
]);

interface ScopedArgs {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/**
 * Structural tenant isolation for the data layer.
 *
 * A query extension on PrismaClient that, for every tenant-scoped model:
 *   - intersects every read/update `where` clause with { tenantId } so a
 *     tenant can only ever see (or mutate) its own rows;
 *   - stamps every write `data` payload with { tenantId } so a new row can
 *     only ever belong to the current tenant.
 *
 * The tenant id is always read from the request-scoped context
 * (AsyncLocalStorage, see tenant-context.ts). Application code therefore
 * never passes tenantId manually, and raw queries are not used anywhere in
 * the codebase, so no unscoped path exists.
 */
export function createTenantAwarePrisma(): PrismaClient {
  const base = new PrismaClient();
  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = currentTenant().id;
          const scoped = args as ScopedArgs;

          if (WHERE_OPERATIONS.has(operation)) {
            scoped.where = { ...scoped.where, tenantId };
          }

          if (DATA_OPERATIONS.has(operation)) {
            if (operation === 'createMany') {
              scoped.data = Array.isArray(scoped.data)
                ? (scoped.data as Array<Record<string, unknown>>).map((row) => ({ ...row, tenantId }))
                : { ...(scoped.data as Record<string, unknown>), tenantId };
            } else if (operation === 'upsert') {
              scoped.create = { ...(scoped.create as Record<string, unknown>), tenantId };
              if (scoped.update) {
                scoped.update = { ...scoped.update, tenantId };
              }
            } else {
              scoped.data = { ...(scoped.data as Record<string, unknown>), tenantId };
            }
          }

          return query(scoped as typeof args);
        },
      },
    },
  }) as PrismaClient;
}
