import { Injectable, OnModuleInit, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../common/tenant-context.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(private readonly tenantContext: TenantContext) {
    super();
  }

  async onModuleInit() {
    await this.$connect();

    // Prisma middleware that enforces tenant isolation
    this.$use(
      async (
        params: Prisma.MiddlewareParams,
        next: (params: Prisma.MiddlewareParams) => Promise<any>,
      ) => {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
          throw new HttpException(
            {
              error: {
                code: 'tenant_not_resolved',
                message: 'Tenant not resolved in request context',
                details: {},
              },
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        const { model, action, args = {} } = params;

        // Only apply to models that have a tenantId column
        if (!model) {
          return next(params);
        }

        const whereWithTenant = (where: any) => ({
          ...where,
          tenantId,
        });

        const readActions = [
          'findUnique',
          'findFirst',
          'findMany',
          'count',
          'aggregate',
          'groupBy',
        ];
        const writeActions = [
          'create',
          'createMany',
          'update',
          'updateMany',
          'upsert',
          'delete',
          'deleteMany',
        ];

        if (readActions.includes(action)) {
          params.args = {
            ...args,
            where: whereWithTenant(args.where ?? {}),
          };
        } else if (writeActions.includes(action)) {
          // CREATE
          if (action === 'create') {
            params.args = {
              ...args,
              data: { ...(args.data ?? {}), tenantId },
            };
          }
          // CREATE MANY
          else if (action === 'createMany') {
            const dataArray = Array.isArray(args.data) ? args.data : [];
            params.args = {
              ...args,
              data: dataArray.map((d: any) => ({ ...d, tenantId })),
            };
          }
          // UPSERT
          else if (action === 'upsert') {
            params.args = {
              ...args,
              where: whereWithTenant(args.where ?? {}),
              create: { ...(args.create ?? {}), tenantId },
              update: args.update, // ensure update does not tamper tenantId
            };
          }
          // UPDATE / UPDATE MANY / DELETE / DELETE MANY
          else {
            params.args = {
              ...args,
              where: whereWithTenant(args.where ?? {}),
            };
            // For update actions, strip any tenantId from data payload
            if ((action === 'update' || action === 'updateMany') && args.data) {
              const { tenantId: _, ...rest } = args.data;
              params.args = { ...params.args, data: rest };
            }
          }
        }

        return next(params);
      },
    );
  }
}
