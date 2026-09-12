import {
  Injectable,
  Scope,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient {
  constructor(@Inject(REQUEST) private readonly request: Request) {
    super();
    this.$use(this.tenantMiddleware.bind(this));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async tenantMiddleware(
    params: Prisma.MiddlewareParams,
    next: Prisma.Middleware,
  ) {
    const tenant = (this.request as any).tenant as { id: number } | undefined;
    const tenantId = tenant?.id;

    if (!tenantId) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_resolved',
            message: 'Tenant context missing',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const addTenantToWhere = (where: any) => ({
      ...(where ?? {}),
      tenantId,
    });

    if (
      [
        'create',
        'createMany',
        'update',
        'updateMany',
        'upsert',
        'delete',
        'deleteMany',
      ].includes(params.action)
    ) {
      if (params.action === 'create') {
        params.args.data = {
          ...params.args.data,
          tenantId,
        };
      } else if (params.action === 'createMany') {
        params.args.data = (params.args.data as any[]).map((d) => ({
          ...d,
          tenantId,
        }));
      } else if (['update', 'updateMany', 'delete', 'deleteMany'].includes(params.action)) {
        params.args.where = addTenantToWhere(params.args.where);
        if (['update', 'upsert'].includes(params.action)) {
          params.args.data = {
            ...params.args.data,
            tenantId,
          };
        }
      } else if (params.action === 'upsert') {
        params.args.where = addTenantToWhere(params.args.where);
        params.args.create = {
          ...params.args.create,
          tenantId,
        };
        params.args.update = {
          ...params.args.update,
          tenantId,
        };
      }
    }

    if (['findUnique', 'findFirst', 'findMany', 'count', 'aggregate'].includes(params.action)) {
      if (params.action === 'findUnique') {
        params.action = 'findFirst';
      }
      params.args.where = addTenantToWhere(params.args.where);
    }

    return next(params);
  }
}
