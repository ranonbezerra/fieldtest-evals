import { getTenantContext } from './tenant-context.util.js';

/**
 * Tenant-aware Prisma extension. For every tenant-scoped model (Customer,
 * Plan, Order) this guarantees:
 *  - every read is scoped by the context tenant's tenantId
 *  - every write is stamped with the context tenant's tenantId
 *  - a tenantId supplied by a caller, at the top level or nested in AND or
 *    relation filters, is replaced by the context value, never trusted
 *  - with no tenant in the request context the operation is refused instead
 *    of running unscoped
 *
 * The Tenant model itself is deliberately not scoped: it is the tenant, and
 * it is only read by the resolution middleware, before any context exists.
 */

const SCOPED_MODELS: ReadonlySet<string> = new Set(['Customer', 'Plan', 'Order']);
const TENANT_FIELD = 'tenantId';

type Filter = Record<string, unknown>;

interface OperationContext {
  model: string;
  operation: string;
  args: Filter;
  query: (args: unknown) => Promise<unknown>;
}

export class TenantScopeRefusedError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Prisma operation "${operation}" on "${model}" is not covered by the tenant scope; refusing to run it unscoped`,
    );
    this.name = 'TenantScopeRefusedError';
  }
}

function isPlainObject(value: unknown): value is Filter {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively replaces every tenantId condition in a Prisma filter or write
 * payload with the context tenant. Values that are not plain objects or
 * arrays (ids, dates, strings) pass through untouched.
 */
function enforceTenant(value: unknown, tenantId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => enforceTenant(item, tenantId));
  if (!isPlainObject(value)) return value;
  const result: Filter = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = key === TENANT_FIELD ? tenantId : enforceTenant(child, tenantId);
  }
  return result;
}

/** Scopes a plain where (findMany / findFirst / count / aggregate / groupBy / *Many). */
function scopePlainWhere(where: unknown, tenantId: string): Filter {
  const walked = isPlainObject(where) ? (enforceTenant(where, tenantId) as Filter) : {};
  return { ...walked, [TENANT_FIELD]: tenantId };
}

/**
 * Scopes a unique where (findUnique / update / delete / upsert). A unique
 * where can only be filtered through AND, so the context tenant is added
 * there; any tenantId the caller placed in those filters is neutralised by
 * enforceTenant first.
 */
function scopeUniqueWhere(where: unknown, tenantId: string): Filter {
  const walked = isPlainObject(where) ? (enforceTenant(where, tenantId) as Filter) : {};
  const { AND: existing, ...uniqueFields } = walked;
  const conditions: unknown[] = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
  return { ...uniqueFields, AND: [{ [TENANT_FIELD]: tenantId }, ...conditions] };
}

/** Stamps a write payload with the context tenant, including nested writes. */
function stampData(data: unknown, tenantId: string): unknown {
  const stamped = enforceTenant(data, tenantId);
  if (Array.isArray(stamped)) {
    return stamped.map((item) => ({ ...(isPlainObject(item) ? item : {}), [TENANT_FIELD]: tenantId }));
  }
  if (stamped === null || typeof stamped !== 'object') return { [TENANT_FIELD]: tenantId };
  return { ...(stamped as Filter), [TENANT_FIELD]: tenantId };
}

async function scopeOperation({ model, operation, args, query }: OperationContext): Promise<unknown> {
  if (!SCOPED_MODELS.has(model)) return query(args);

  // No tenant in context: refuse. Running unscoped would read or write
  // across tenants, which is the class of bug this extension exists to make
  // impossible.
  const { tenantId } = getTenantContext();
  const scopedArgs: Filter = { ...args };

  switch (operation) {
    case 'create':
    case 'createMany':
      scopedArgs.data = stampData(args.data, tenantId);
      return query(scopedArgs);
    case 'update':
      scopedArgs.where = scopeUniqueWhere(args.where, tenantId);
      scopedArgs.data = stampData(args.data, tenantId);
      return query(scopedArgs);
    case 'updateMany':
      scopedArgs.where = scopePlainWhere(args.where, tenantId);
      scopedArgs.data = stampData(args.data, tenantId);
      return query(scopedArgs);
    case 'delete':
      scopedArgs.where = scopeUniqueWhere(args.where, tenantId);
      return query(scopedArgs);
    case 'deleteMany':
      scopedArgs.where = scopePlainWhere(args.where, tenantId);
      return query(scopedArgs);
    case 'upsert':
      scopedArgs.where = scopeUniqueWhere(args.where, tenantId);
      scopedArgs.create = stampData(args.create, tenantId);
      scopedArgs.update = stampData(args.update, tenantId);
      return query(scopedArgs);
    case 'findUnique':
      scopedArgs.where = scopeUniqueWhere(args.where, tenantId);
      return query(scopedArgs);
    case 'findMany':
    case 'findFirst':
    case 'count':
    case 'aggregate':
    case 'groupBy':
      scopedArgs.where = scopePlainWhere(args.where, tenantId);
      return query(scopedArgs);
    default:
      // Fail closed on anything not explicitly scoped above (raw operations,
      // or anything Prisma adds later).
      throw new TenantScopeRefusedError(model, operation);
  }
}

export const tenantScope = {
  name: 'tenant-scope',
  query: {
    $allModels: {
      $allOperations: scopeOperation,
    },
  },
};
