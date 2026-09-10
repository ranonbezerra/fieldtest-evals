import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import * as request from 'supertest';
import { App } from 'supertest';
import { CustomerModule } from '../src/customer/customer.module';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerRepository } from '../src/customer/customer.repository';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { TenantConfigModule } from '../src/tenant-config/tenant-config.module';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makePrismaForTenant(prisma: PrismaClient, tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const typedArgs = args as Record<string, unknown>;
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
          if (operation === 'create') {
            typedArgs.data = { ...(typedArgs.data as object), tenantId };
          }
          if (operation === 'createMany') {
            if (Array.isArray(typedArgs.data)) {
              typedArgs.data = (typedArgs.data as Record<string, unknown>[]).map(
                (d) => ({ ...d, tenantId }),
              );
            } else {
              typedArgs.data = { ...(typedArgs.data as object), tenantId };
            }
          }
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

describe('CustomerService (tenant isolation)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let serviceA: CustomerService;
  let serviceB: CustomerService;
  let prismaA: ReturnType<typeof makePrismaForTenant>;
  let prismaB: ReturnType<typeof makePrismaForTenant>;
  const basePrisma = new PrismaClient();

  function makeModule() {
    return {
      providers: [
        CustomerController,
        CustomerService,
        CustomerRepository,
        { provide: TenantContextService, useValue: { getTenantId: () => TENANT_A } },
        { provide: TenantPrismaService, useValue: prismaA },
      ],
      controllers: [CustomerController],
    };
  }

  beforeAll(async () => {
    await basePrisma.$connect();
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
    prismaA = makePrismaForTenant(basePrisma, TENANT_A);
    prismaB = makePrismaForTenant(basePrisma, TENANT_B);
    appA = await createApp(prismaA, TENANT_A);
    appB = await createApp(prismaB, TENANT_B);
  });

  afterAll(async () => {
    if (appA) await appA.close();
    if (appB) await appB.close();
    await basePrisma.$disconnect();
  });

  beforeEach(async () => {
    await basePrisma.customer.deleteMany({ where: { tenantId: TENANT_A } });
    await basePrisma.customer.deleteMany({ where: { tenantId: TENANT_B } });
  });

  async function seedTenant(id: string) {
    try {
      await basePrisma.tenant.create({ data: { id } });
    } catch {
      // already exists
    }
  }

  async function createApp(prisma: ReturnType<typeof makePrismaForTenant>, tenantId: string) {
    const moduleRef = await Test.createTestingModule({
      imports: [CustomerModule, TenantConfigModule],
      controllers: [CustomerController],
      providers: [
        CustomerService,
        CustomerRepository,
        { provide: TenantContextService, useValue: { getTenantId: () => tenantId } },
        { provide: TenantPrismaService, useValue: prisma },
      ],
    })
      .overrideProvider(TenantPrismaService)
      .useValue(prisma)
      .overrideProvider(TenantContextService)
      .useValue({ getTenantId: () => tenantId })
      .compile();

    const application = moduleRef.createNestApplication();
    await application.init();
    serviceA = moduleRef.get(CustomerService);
    serviceB = moduleRef.get(CustomerService);
    return application;
  }

  it('tenant B cannot list tenant A customers', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    expect(created.tenantId).toBe(TENANT_A);

    const b = await (serviceB as CustomerService).findAll();
    expect(b).toEqual([]);
  });

  it('tenant B cannot fetch-by-id a tenant A customer (404)', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    expect(created.id).toBeDefined();
    await expect(serviceB.findById(created.id)).rejects.toThrow();
  });

  it('tenant B cannot update a tenant A customer', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    await expect(
      serviceB.update(created.id, { email: 'alice@operator-x.com', name: 'Hacked' }),
    ).rejects.toThrow();
  });

  it('tenant B cannot delete a tenant A customer', async () => {
    const created = await serviceA.create({ email: 'alice@operator-x.com' });
    await expect(serviceB.remove(created.id)).rejects.toThrow();
    const stillThere = await prismaA.customer.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();
  });

  it('same email registers in both tenants', async () => {
    const a = await serviceA.create({ email: 'shared@operator-x.com' });
    const b = await serviceB.create({ email: 'shared@operator-x.com' });
    expect(a.tenantId).toBe(TENANT_A);
    expect(b.tenantId).toBe(TENANT_B);
    expect(a.id).not.toBe(b.id);
  });

  it('concurrent requests from different tenants do not cross contexts', async () => {
    const [a, b] = await Promise.all([
      serviceA.create({ email: 'concurrent@operator-x.com' }),
      serviceB.create({ email: 'concurrent@operator-x.com' }),
    ]);
    expect(a.tenantId).toBe(TENANT_A);
    expect(b.tenantId).toBe(TENANT_B);
  });
});
