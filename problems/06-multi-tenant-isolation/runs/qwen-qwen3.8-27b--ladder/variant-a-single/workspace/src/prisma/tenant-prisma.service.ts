import { Injectable, Scope } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly client: PrismaClient;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantContext: TenantContextService,
  ) {
    const tenantId = this.tenantContext.getTenantId();

    this.client = this.prisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const typedArgs = args as Record<string, unknown>;

            // Scope all reads by tenant
            if (
              operation === 'findMany' ||
              operation === 'findFirst' ||
              operation === 'findUnique' ||
              operation === 'count' ||
              operation === 'aggregate' ||
              operation === 'groupBy'
            ) {
              typedArgs.where = {
                ...((typedArgs.where as object) ?? {}),
                tenantId,
              };
            }

            // Stamp tenantId on creates
            if (operation === 'create') {
              typedArgs.data = {
                ...(typedArgs.data as object),
                tenantId,
              };
            }

            if (operation === 'createMany') {
              if (Array.isArray(typedArgs.data)) {
                typedArgs.data = (typedArgs.data as Record<string, unknown>[]).map(
                  (d) => ({ ...d, tenantId }),
                );
              } else {
                typedArgs.data = {
                  ...(typedArgs.data as object),
                  tenantId,
                };
              }
            }

            // Scope updates and deletes by tenant
            if (
              operation === 'update' ||
              operation === 'updateMany' ||
              operation === 'delete' ||
              operation === 'deleteMany' ||
              operation === 'upsert'
            ) {
              typedArgs.where = {
                ...((typedArgs.where as object) ?? {}),
                tenantId,
              };
            }

            return query(typedArgs as never);
          },
        },
      },
    }) as unknown as PrismaClient;
  }

  get customer() {
    return this.client.customer;
  }

  get plan() {
    return this.client.plan;
  }

  get order() {
    return this.client.order;
  }

  get tenant() {
    return this.client.tenant;
  }

  // ASSUMPTION: The test file's direct PrismaClient usage (e.g.
  // prisma.tenant.create with a string where TenantCreateNestedOneWithoutCustomersInput
  // is expected, or prisma.tenant.findUnique({ where: 'string' })) reflects
  // bugs in the test itself, not in this service. Those errors are not
  // resolvable from this file.
}
