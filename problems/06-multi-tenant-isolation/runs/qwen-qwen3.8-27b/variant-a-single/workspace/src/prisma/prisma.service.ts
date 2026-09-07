import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export const tenantStorage = new AsyncLocalStorage<string>();

const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly client;

  constructor() {
    this.raw = new PrismaClient();
    this.client = this.raw.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tenantId = tenantStorage.getStore();
            if (!tenantId) {
              throw new Error('Missing tenant context: no tenantId in AsyncLocalStorage');
            }

            if (READ_OPERATIONS.has(operation)) {
              const where = (args as Record<string, unknown>)?.where ?? {};
              (args as Record<string, unknown>).where = { ...where, tenantId };
            }

            if (WRITE_OPERATIONS.has(operation)) {
              const data = (args as Record<string, unknown>)?.data;
              if (data && typeof data === 'object') {
                (args as Record<string, unknown>).data = {
                  ...(data as Record<string, unknown>),
                  tenantId,
                };
              }
            }

            return query(args);
          },
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }
}
