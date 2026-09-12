import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { TenantContext } from '../tenant/tenant-context.js';

/**
 * Models whose rows belong to exactly one tenant. `tenantScopeMiddleware`
 * rewrites every query on these models so handlers never pass `tenantId`:
 *   - every read is filtered to the current request's tenant,
 *   - every write is stamped with the current request's tenant.
 */
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);

/** Operations whose `where` clause must be scoped to the tenant. */
const WHERE_SCOPED_OPERATIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

const tenantScopeMiddleware: Prisma.Middleware = (params, next) => {
  const { model, operation } = params;
  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return next(params);
  }

  const tenantId = TenantContext.getTenantId();
  if (!tenantId) {
    // Fail closed: a tenant-scoped query must never run without a tenant.
    throw new ApiError(500, 'tenant_context_missing', `Refused ${model}.${operation} outside of a tenant request context`);
  }

  const args = (params.args ?? {}) as Record<string, any>;
  if (WHERE_SCOPED_OPERATIONS.has(operation)) {
    args.where = { ...((args.where as Record<string, any>) ?? {}), tenantId };
  }
  switch (operation) {
    case 'create':
      args.data = { ...((args.data as Record<string, any>) ?? {}), tenantId };
      break;
    case 'createMany':
      args.data = Array.isArray(args.data)
        ? (args.data as Array<Record<string, any>>).map((row) => ({ ...row, tenantId }))
        : { ...((args.data as Record<string, any>) ?? {}), tenantId };
      break;
    case 'upsert':
      args.where = { ...((args.where as Record<string, any>) ?? {}), tenantId };
      args.create = { ...((args.create as Record<string, any>) ?? {}), tenantId };
      break;
    default:
      break;
  }
  return next(params);
};

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly _client: PrismaClient;

  constructor() {
    this._client = new PrismaClient();
    this._client.$use(tenantScopeMiddleware);
  }

  /**
   * The only Prisma client exposed to repositories. Tenant-scoped models are
   * always read/written through the current request's tenant context; the
   * shared `Tenant` model passes through untouched (it is what the context is
   * built from, so it must stay queryable before a tenant is resolved).
   */
  get client(): PrismaClient {
    return this._client;
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.$disconnect();
  }
}
