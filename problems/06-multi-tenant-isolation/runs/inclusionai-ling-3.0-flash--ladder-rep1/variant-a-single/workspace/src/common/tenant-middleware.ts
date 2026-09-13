import { getTenantId } from './tenant-context.js';

const READ_OPERATIONS = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'];
const WRITE_OPERATIONS = ['create', 'update', 'upsert', 'createMany', 'updateMany', 'deleteMany'];

export function tenantMiddleware(skipModels: string[]) {
  return async (params: any, next: (params: any) => Promise<any>) => {
    const tenantId = getTenantId();
    const { operation, model, args } = params;

    // Allow system-level model queries without tenant context
    if (skipModels.includes(model)) {
      return next(params);
    }

    // Fail fast: no tenant in context for any data operation
    if (!tenantId) {
      throw new Error('No tenant in context');
    }

    // Overwrite any caller-supplied tenantId — never trust it
    if (READ_OPERATIONS.includes(operation)) {
      if (args.where && typeof args.where === 'object') {
        args.where = { ...args.where, tenantId };
      } else {
        args.where = { tenantId };
      }
    }

    if (WRITE_OPERATIONS.includes(operation)) {
      if (operation === 'create') {
        args.data = { ...(args.data || {}), tenantId };
      } else if (operation === 'update') {
        if (args.data) {
          args.data = { ...args.data, tenantId };
        }
        if (args.where && typeof args.where === 'object') {
          args.where = { ...args.where, tenantId };
        } else {
          args.where = { tenantId };
        }
      } else if (operation === 'upsert') {
        if (args.create) {
          args.create = { ...args.create, tenantId };
        }
        if (args.update) {
          args.update = { ...args.update, tenantId };
        }
        if (args.where && typeof args.where === 'object') {
          args.where = { ...args.where, tenantId };
        } else {
          args.where = { tenantId };
        }
      } else if (operation === 'createMany') {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((d: Record<string, any>) => ({ ...d, tenantId }));
        }
      } else if (operation === 'updateMany' || operation === 'deleteMany') {
        if (args.where && typeof args.where === 'object') {
          args.where = { ...args.where, tenantId };
        } else {
          args.where = { tenantId };
        }
      }
    }

    return next(params);
  };
}
