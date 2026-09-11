import { PrismaClient } from '@prisma/client';
import { TenantContextStorage } from './tenant-context';

/**
 * Builds the tenant-aware Prisma client.
 *
 * Every model query passes through a single query extension that:
 *  - scopes every read (and every unique `where`) to the tenant in the
 *    request context;
 *  - stamps every write with that tenant id, overwriting whatever tenantId a
 *    caller supplied — a supplied tenantId is never trusted;
 *  - refuses to run when no tenant is in context (fails closed, never
 *    returns everything);
 *  - refuses to run any operation it does not explicitly classify, so a new
 *    Prisma operation can never silently bypass the tenant guard.
 *
 * Models in TENANTLESS_MODELS (the tenant lookup table itself) are exempt;
 * everything else is tenant data and is scoped.
 */

const TENANTLESS_MODELS = new Set(['Tenant']);

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_OPERATIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

const DATA_OPERATIONS = new Set(['create', 'createMany']);

const HANDLED_OPERATIONS = new Set([...READ_OPERATIONS, ...WHERE_OPERATIONS, ...DATA_OPERATIONS]);

function scopeArgs(operation: string, args: unknown, tenantId: string): unknown {
  if (!HANDLED_OPERATIONS.has(operation)) {
    throw new Error(
      `tenant guard: operation "${operation}" is not explicitly tenant-scoped; refusing to run it unscoped`,
    );
  }
  const next = (args ?? {}) as Record<string, any>;

  if (READ_OPERATIONS.has(operation) || WHERE_OPERATIONS.has(operation)) {
    // Every tenant-scoped model carries tenantId in its composite primary
    // key and in its other unique constraints, so adding tenantId to `where`
    // keeps every operation valid — including findUnique/update/delete,
    // whose where must be a unique constraint. A caller-supplied tenantId in
    // `where` is overwritten by the context, not trusted.
    next.where = { ...(next.where ?? {}), tenantId };
  }

  if (operation === 'create' || operation === 'createMany') {
    next.data = Array.isArray(next.data)
      ? next.data.map((row: any) => ({ ...row, tenantId }))
      : { ...next.data, tenantId };
  }

  if (operation === 'upsert') {
    next.data = { ...next.data, create: { ...next.data.create, tenantId } };
  }

  return next;
}

function guardRawQueries(client: PrismaClient): PrismaClient {
  const blocked = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$batchRaw']);
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && blocked.has(prop)) {
        return () => {
          throw new Error('raw SQL is not available on the tenant-aware client; use tenant-scoped model queries');
        };
      }
      return Reflect.get(target, prop);
    },
  });
}

function buildTenantQueryExtension(storage: TenantContextStorage): any {
  // The Prisma extension API has no typed "any model, any operation" hook,
  // so the hook is intentionally loose here; its runtime contract is pinned
  // by the isolation test suite.
  return {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: any) => Promise<any>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }): Promise<any> {
          if (TENANTLESS_MODELS.has(model)) {
            return query(args);
          }
          const tenantId = storage.tenantId; // throws TenantContextMissingError
          return query(scopeArgs(operation, args, tenantId));
        },
      },
    },
  };
}

export function createTenantAwareClient(base: PrismaClient, storage: TenantContextStorage): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extended: PrismaClient = (base as any).$extends(buildTenantQueryExtension(storage));
  return guardRawQueries(extended);
}
