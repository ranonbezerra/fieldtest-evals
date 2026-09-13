import { Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context.js';

export function createTenantExtension(getTenantIdFn: () => string | undefined) {
  return (Prisma as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: any; operation: any; args: any; query: any }) {
          const tenantId = getTenantIdFn();

          if (!tenantId) {
            throw new Error('No tenant in context');
          }

          return handleOperation(
            { model, operation, args, query, tenantId },
          );
        },
      },
    },
  });
}

async function handleOperation(ctx: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  tenantId: string;
}) {
  const { operation, args, query, tenantId } = ctx;

  const readOps = new Set([
    'findMany',
    'findFirst',
    'findUnique',
    'findFirstOrThrow',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ]);

  if (readOps.has(operation)) {
    const modifiedArgs = {
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    };
    return query(modifiedArgs);
  }

  if (operation === 'create') {
    return query({
      ...args,
      data: addTenantToCreateData(args.data, tenantId),
    });
  }

  if (operation === 'createMany') {
    const originalData = args.data;
    const newData =
      Array.isArray(originalData)
        ? originalData.map((d) => addTenantToCreateData(d, tenantId))
        : addTenantToCreateData(originalData, tenantId);
    return query({ ...args, data: newData });
  }

  if (operation === 'upsert') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      create: addTenantToCreateData(args.create, tenantId),
      update: addTenantToUpdateData(args.update, tenantId),
    });
  }

  if (operation === 'update' || operation === 'updateMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      data: addTenantToUpdateData(args.data, tenantId),
    });
  }

  if (operation === 'delete' || operation === 'deleteMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    });
  }

  return query(args);
}

function addTenantToWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = where as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId: { set: tenantId } };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId: { set: tenantId } };
}
