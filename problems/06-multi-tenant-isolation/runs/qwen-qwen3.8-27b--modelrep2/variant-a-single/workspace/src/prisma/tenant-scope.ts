import type { PrismaClient } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';

/**
 * Structural isolation at the data layer.
 *
 * Applied to the Prisma client used by all repositories. For every model
 * except the tenant registry itself, this extension:
 *   - adds `tenantId` to the `where` clause of every read and every
 *     row-addressing write, so a query can never see or touch another
 *     tenant's rows;
 *   - stamps `tenantId` onto every created row, so writes can never miss
 *     a tenant;
 *   - fails closed on any operation it does not explicitly understand.
 *
 * The tenant is read from the request-scoped context (AsyncLocalStorage),
 * never from caller-supplied arguments.
 */
const UNSCOPED_MODELS: ReadonlySet<string> = new Set(['Tenant']);

const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'delete',
  'updateMany',
  'deleteMany',
]);

type OperationContext = {
  model: string;
  operation: string;
  // Prisma's per-operation args types vary widely; the interception is
  // deliberately structural here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<any>;
};

export function applyTenantScope<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations(ctx: OperationContext) {
          if (UNSCOPED_MODELS.has(ctx.model)) {
            return ctx.query(ctx.args);
          }

          const tenantId = tenantContext.require();
          const args = { ...ctx.args };

          switch (ctx.operation) {
            case 'create':
              args.data = { ...args.data, tenantId };
              break;
            case 'createMany':
              args.data = Array.isArray(args.data)
                ? args.data.map((row: Record<string, unknown>) => ({ ...row, tenantId }))
                : { ...args.data, tenantId };
              break;
            case 'upsert':
              args.where = { ...args.where, tenantId };
              args.create = { ...args.create, tenantId };
              break;
            default:
              if (!WHERE_OPERATIONS.has(ctx.operation)) {
                throw new AppError(
                  500,
                  'tenant_scope_unsupported_operation',
                  `Refusing to run Prisma operation "${ctx.operation}" without tenant isolation.`,
                  { model: ctx.model, operation: ctx.operation },
                );
              }
              args.where = { ...args.where, tenantId };
          }

          return ctx.query(args);
        },
      },
    },
  });
}
