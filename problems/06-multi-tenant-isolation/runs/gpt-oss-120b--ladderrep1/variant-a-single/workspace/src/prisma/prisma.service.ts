import { Injectable, OnModuleInit, OnModuleDestroy, HttpException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant.context.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenantContext: TenantContext) {
    super({
      log: ['error', 'warn'],
    });
    this.$use(this.tenantMiddleware.bind(this));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async tenantMiddleware(params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => any) {
    const tenantId = this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_resolved',
            message: 'Tenant could not be resolved for this request',
            details: {},
          },
        },
        400,
      );
    }

    const writeActions = ['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany'];
    const readActions = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'];

    if (writeActions.includes(params.action)) {
      if (params.args.data) {
        params.args.data = {
          ...params.args.data,
          tenantId,
        };
      } else if (params.args) {
        if (Array.isArray(params.args.data)) {
          params.args.data = params.args.data.map((d: any) => ({ ...d, tenantId }));
        } else {
          params.args.data = { tenantId, ...params.args.data };
        }
      }
    }

    if (readActions.includes(params.action)) {
      if (!params.args.where) {
        params.args.where = { tenantId };
      } else {
        params.args.where = {
          ...params.args.where,
          tenantId,
        };
      }
    }

    return next(params);
  }
}
