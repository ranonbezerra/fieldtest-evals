import { TenantContextService } from './tenant-context.service.js';

const TENANT_SCOPED_MODELS = ['customer', 'plan', 'order'] as const;

export type ModelDelegate = Record<string, any>;
export type BasePrismaClient = Record<string, any>;

export interface TenantAwarePrismaClient {
  customer: ModelDelegate;
  plan: ModelDelegate;
  order: ModelDelegate;
}

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export function createTenantAwareClient(
  base: BasePrismaClient,
  context: TenantContextService,
): TenantAwarePrismaClient {
  const client = {} as TenantAwarePrismaClient;

  for (const model of TENANT_SCOPED_MODELS) {
    const target = (base[model] ?? {}) as ModelDelegate;

    client[model] = new Proxy(target, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        return wrapOperation(String(property), target, context);
      },
    });
  }

  return client;
}

function wrapOperation(operation: string, target: ModelDelegate, context: TenantContextService) {
  if (operation === 'findUnique') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirst', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'findUniqueOrThrow') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'findFirstOrThrow', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (READ_OPERATIONS.has(operation)) {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, operation, {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'create') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'create', {
        ...args,
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'createMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'createMany', {
        ...args,
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'update') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const data = withTenantData(args.data, tenantId);

      const updated = await invoke(target, 'updateMany', { where, data }) as { count: number };
      if (!updated || updated.count === 0) {
        throw prismaNotFound();
      }

      return invoke(target, 'findFirst', { where });
    };
  }

  if (operation === 'updateMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'updateMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
        data: withTenantData(args.data, tenantId),
      });
    };
  }

  if (operation === 'delete') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);

      const existing = await invoke(target, 'findFirst', { where });
      if (!existing) {
        throw prismaNotFound();
      }

      const deleted = await invoke(target, 'deleteMany', { where }) as { count: number };
      if (!deleted || deleted.count === 0) {
        throw prismaNotFound();
      }

      return existing;
    };
  }

  if (operation === 'deleteMany') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      return invoke(target, 'deleteMany', {
        ...args,
        where: withTenantWhere(args.where, tenantId),
      });
    };
  }

  if (operation === 'upsert') {
    return async (args: Record<string, any> = {}) => {
      const tenantId = context.getTenantId();
      const where = withTenantWhere(args.where, tenantId);
      const existing = await invoke(target, 'findFirst', { where });

      if (existing) {
        await invoke(target, 'updateMany', {
          where,
          data: withTenantData(args.update, tenantId),
        });
        return invoke(target, 'findFirst', { where });
      }

      return invoke(target, 'create', {
        data: withTenantData(args.create, tenantId),
      });
    };
  }

  const fn = target[operation] as (...callArgs: any[]) => any;
  return (...callArgs: any[]) => fn.apply(target, callArgs);
}

function invoke(target: ModelDelegate, operation: string, args: Record<string, any>): Promise<any> {
  const fn = target[operation] as ((input: Record<string, any>) => any) | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`Prisma operation "${operation}" is not available on the base client.`);
  }
  return Promise.resolve(fn.call(target, args));
}

function withTenantWhere(where: any, tenantId: string): Record<string, any> {
  const existing =
    where && typeof where === 'object' && !Array.isArray(where) ? { ...where } : {};
  return { ...existing, tenantId };
}

function withTenantData(data: any, tenantId: string): any {
  if (Array.isArray(data)) {
    return data.map((item) => withTenantData(item, tenantId));
  }
  if (data && typeof data === 'object') {
    return { ...data, tenantId };
  }
  return { tenantId };
}

function prismaNotFound(): Error {
  const error = new Error('Record to update or delete not found.') as Error & { code: string };
  error.code = 'P2025';
  return error;
}
