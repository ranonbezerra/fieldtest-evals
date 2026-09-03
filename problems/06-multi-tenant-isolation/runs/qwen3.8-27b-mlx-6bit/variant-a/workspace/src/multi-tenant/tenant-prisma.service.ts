import { Injectable, Scope } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { ResourceNotFoundError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly extended: any;

  constructor(
    base: PrismaService,
    private readonly ctx: TenantContextService,
  ) {
    this.extended = base.$extends({
      query: {
        $allModels: {
          async $allOperations(params: {
            args: Record<string, any>;
            operation: string;
            query: (args?: Record<string, any>) => Promise<any>;
          }) {
            const { args, operation, query } = params;
            const tenantId = this.ctx.tenantId;

            if (operation === 'create') {
              args.data = { ...(args.data as object), tenantId };
            } else if (operation === 'createMany') {
              const data = args.data;
              if (Array.isArray(data)) {
                args.data = data.map((d: any) => ({ ...d, tenantId }));
              } else if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
                args.data = { ...data, data: (data as any).data.map((d: any) => ({ ...d, tenantId })) };
              }
            } else if (
              [
                'findMany',
                'findFirst',
                'findUnique',
                'count',
                'aggregate',
                'groupBy',
                'update',
                'updateMany',
                'delete',
                'deleteMany',
              ].includes(operation)
            ) {
              args.where = { ...(args.where as object), tenantId };
            }

            try {
              return await query(args);
            } catch (err: any) {
              if (err?.code === 'P2025' && (operation === 'update' || operation === 'delete')) {
                throw new ResourceNotFoundError(operation);
              }
              throw err;
            }
          },
        },
      },
    });
  }

  get customer() {
    return this.extended.customer;
  }

  get plan() {
    return this.extended.plan;
  }

  get order() {
    return this.extended.order;
  }
}
