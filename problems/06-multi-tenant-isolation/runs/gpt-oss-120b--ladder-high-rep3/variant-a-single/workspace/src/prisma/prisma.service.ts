import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant-context/tenant-context.js';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
    });

    const tenantModels = new Set(['Customer', 'Plan', 'Order']);

    this.$use(async (params, next) => {
      const model = params.model;
      const action = params.action;

      // Skip models that are not tenant-scoped
      if (!tenantModels.has(model)) {
        return next(params);
      }

      // TenantContext returns a string (org claim) or undefined; cast/convert to number
      const tenantId = Number(TenantContext.getTenantId()!);

      const addTenantWhere = (where: any = {}) => {
        where.tenantId = tenantId;
        return where;
      };

      // READ actions
      if (['findUnique', 'findFirst', 'findMany', 'findFirstOrThrow', 'findUniqueOrThrow'].includes(action)) {
        params.args = params.args ?? {};
        params.args.where = addTenantWhere(params.args.where);
      }

      // CREATE actions
      if (['create', 'createMany'].includes(action)) {
        params.args = params.args ?? {};
        if (action === 'create') {
          params.args.data = { ...(params.args.data ?? {}), tenantId };
        } else if (action === 'createMany') {
          const dataArray = params.args.data;
          if (Array.isArray(dataArray)) {
            params.args.data = dataArray.map((d: any) => ({ ...d, tenantId }));
          } else {
            params.args.data = { ...dataArray, tenantId };
          }
        }
      }

      // UPDATE / UPSERT actions
      if (['update', 'updateMany', 'upsert'].includes(action)) {
        params.args = params.args ?? {};
        params.args.where = addTenantWhere(params.args.where);
        if (action === 'upsert') {
          if (params.args.create) {
            params.args.create.tenantId = tenantId;
          }
          if (params.args.update) {
            params.args.update.tenantId = tenantId;
          }
        } else {
          if (params.args.data) {
            params.args.data.tenantId = tenantId;
          }
        }
      }

      // DELETE actions
      if (['delete', 'deleteMany'].includes(action)) {
        params.args = params.args ?? {};
        params.args.where = addTenantWhere(params.args.where);
      }

      // AGGREGATE actions
      if (['aggregate', 'count', 'groupBy'].includes(action)) {
        params.args = params.args ?? {};
        params.args.where = addTenantWhere(params.args.where);
      }

      return next(params);
    });

    this.$connect();
  }
}
