import type { PrismaClient } from '@prisma/client';
import { AppException } from '../errors/app-exception';
import { currentTenant } from '../tenant/tenant-context';

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

export interface TenantGuardArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

const READ_ACTIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
]);

const SCOPE_BY_ID_ACTIONS = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const CREATE_ACTIONS = new Set(['create', 'createMany']);

export function tenantQueryGuard<T>(
  action: string,
  args: TenantGuardArgs,
  query: (args: TenantGuardArgs) => Promise<T>,
  model: { modelName: string },
): Promise<T> {
  if (!TENANT_SCOPED_MODELS.has(model.modelName)) {
    return query(args);
  }

  const ctx = currentTenant();
  if (!ctx) {
    throw AppException.tenantContextMissing();
  }

  const tenantId = ctx.tenantId;

  if (READ_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
  } else if (SCOPE_BY_ID_ACTIONS.has(action)) {
    args.where = { ...args.where, tenantId };
    if (action === 'upsert') {
      const upsertArgs = args as unknown as { create: Record<string, unknown> };
      upsertArgs.create = { ...upsertArgs.create, tenantId };
    }
  } else if (CREATE_ACTIONS.has(action)) {
    if (action === 'createMany') {
      const data = args.data as ReadonlyArray<Record<string, unknown>>;
      args.data = data.map((item) => ({ ...item, tenantId }));
    } else {
      const data = args.data as Record<string, unknown>;
      args.data = { ...data, tenantId };
    }
  }

  return query(args);
}

export interface TenantAwarePrisma extends PrismaClient {}

export function createTenantAwareClient(base: PrismaClient): TenantAwarePrisma {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ action, args, query, model }) {
          return tenantQueryGuard(
            action,
            args as TenantGuardArgs,
            (a) => query(a as TenantGuardArgs),
            model,
          );
        },
      },
    },
  }) as unknown as TenantAwarePrisma;
}
