import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    this.$use(this.tenantMiddleware.bind(this));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async tenantMiddleware(
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<any>,
  ) {
    const tenantInfo = TenantContext.getTenant();

    const tenantModels = ['Customer', 'Plan', 'Order'];
    const model = params.model;

    // Non-tenant-aware models pass through unchanged
    if (!tenantModels.includes(model)) {
      return next(params);
    }

    if (!tenantInfo) {
      throw new Error('Tenant not set in context');
    }

    const tenantId = tenantInfo.id;
    const { action, args } = params;

    const addTenantToWhere = (where: any) => {
      if (!where) {
        return { tenantId };
      }
      return {
        AND: [where, { tenantId }],
      };
    };

    // READ ACTIONS
    if (
      ['findFirst', 'findMany', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow'].includes(
        action,
      )
    ) {
      if (action === 'findUnique' || action === 'findUniqueOrThrow') {
        // Convert to findFirst with tenant filter
        params.action = 'findFirst';
        params.args.where = addTenantToWhere(args.where);
        return next(params);
      } else {
        // For findFirst, findMany, findFirstOrThrow
        params.args.where = addTenantToWhere(args.where);
        return next(params);
      }
    }

    // WRITE ACTIONS
    if (
      [
        'create',
        'createMany',
        'update',
        'updateMany',
        'upsert',
        'delete',
        'deleteMany',
      ].includes(action)
    ) {
      if (action === 'create') {
        args.data = { ...args.data, tenantId };
        return next(params);
      }
      if (action === 'createMany') {
        args.data = args.data.map((d: any) => ({ ...d, tenantId }));
        return next(params);
      }
      if (action === 'update' || action === 'upsert') {
        args.where = addTenantToWhere(args.where);
        if (action === 'update') {
          args.data = { ...args.data, tenantId };
        } else {
          // upsert
          args.create = { ...args.create, tenantId };
          args.update = { ...args.update, tenantId };
        }
        return next(params);
      }
      if (action === 'updateMany' || action === 'deleteMany') {
        args.where = addTenantToWhere(args.where);
        return next(params);
      }
      if (action === 'delete') {
        args.where = addTenantToWhere(args.where);
        return next(params);
      }
    }

    // Default: pass through
    return next(params);
  }
}
