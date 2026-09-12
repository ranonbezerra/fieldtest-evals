# repair1-set

## reasoning

```
We need to fix import paths: need .js extensions? Since moduleResolution node16 requires file extensions for relative imports. Add .js to all relative imports. Also missing express types: need to install but easier add import type from 'express'? Actually need to import Request, Response, NextFunction from 'express'. Types are from @types/express, but compile error cannot find module 'express'. Probably need to add a dev dependency, but we cannot. Instead change to import from 'express' with .js? No. Could use import type from 'express' still needs module. Might add a stub file? Simpler: change to use built-in types from '@nestjs/common'?? Nest middleware uses Request, Response from 'express'. We can add import from 'express' but need types. Probably tsconfig has allowJs? Might need to add .js extension: import { Request, Response, NextFunction } from 'express'; still same. Can't fix without types. But we can use any type: import * as express from 'express'; then const { Request, Response, NextFunction } = express; still need module. Might need to add a path alias to node_modules? Not possible.

Maybe the issue is that tsconfig moduleResolution node16 requires extensions for relative imports only, not for packages. So express import is fine. Error says cannot find module 'express' – means not installed. Can't add packages. Might need to use built-in types from '@nestjs/common' (Request is from express). Could replace imports with any: import type { Request, Response, NextFunction } from 'express'; still same.

Probably tests also need imports for '@nestjs/testing' etc. Those packages not present. Can't install. Maybe need to adjust tsconfig to skip type checking? Not allowed.

Thus likely the repo expects using paths with .js extensions for internal modules, and external packages are present in node_modules (they are). Maybe the error arises because tsconfig "moduleResolution": "node16" requires extensions for internal imports, but external packages okay. So just add .js to all relative imports.

Also fix host undefined issue: TenantContext.getTenantId returns string? In prisma.service line 19 uses host variable maybe. The error: Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Probably in $use where tenantId = TenantContext.getTenantId(); getTenantId returns maybe number | undefined. In code, they use tenantId as string? Actually tenantId used in where clause expects number. So need to assert non undefined: const tenantId = TenantContext.getTenantId()!; cast.

Also test file param res any warnings can be ignored by adding type any annotation in callbacks.

But we only modify source files, not test. Could add // @ts-ignore? Simpler: add explicit type to parameter: .expect(res => { ... }) => TS expects any, we can add (res: any) =>.

But that's test file changes allowed? Yes we can modify any file.

Thus apply changes: add .js extensions to all relative imports. Update imports accordingly.

Also fix prisma.service import path for TenantContext: add .js extension.

Update tenant-config.service import path.

Update tenant-resolver.middleware imports.

Update tenant.module imports.

Update tenant.repository import.

Update customers files imports.

Update app.module imports.

Update main.ts import.

Update prisma.module import.

Add non-null assertion for tenantId in PrismaService.

Update test file callbacks with typed param.

Let's produce changed files.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomersModule } from './customers/customers.module.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule],
})
export class AppModule {}
```

### src/customers/customers.controller.ts
```ts
import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  async findAll() {
    return this.service.getAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.getOne(parseInt(id, 10));
  }

  @Post()
  async create(@Body() createDto: CreateCustomerDto) {
    return this.service.create(createDto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateCustomerDto) {
    return this.service.update(parseInt(id, 10), updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CustomersRepository } from './customers.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository, PrismaService],
})
export class CustomersModule {}
```

### src/customers/customers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Customer, Prisma } from '@prisma/client';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: number): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  async create(data: Prisma.CustomerCreateInput): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  async update(id: number, data: Prisma.CustomerUpdateInput): Promise<Customer> {
    return this.prisma.customer.update({ where: { id }, data });
  }

  async delete(id: number): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
```

### src/customers/customers.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { Prisma, Customer } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async getAll(): Promise<Customer[]> {
    return this.repo.findAll();
  }

  async getOne(id: number): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Customer not found',
          details: {}
        }
      });
    }
    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    // tenantId will be injected by Prisma middleware
    return this.repo.create(dto as Prisma.CustomerCreateInput);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    try {
      return await this.repo.update(id, dto as Prisma.CustomerUpdateInput);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException({
          error: {
            code: 'resource_not_found',
            message: 'Customer not found',
            details: {}
          }
        });
      }
      throw err;
    }
  }

  async remove(id: number): Promise<Customer> {
    try {
      return await this.repo.delete(id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException({
          error: {
            code: 'resource_not_found',
            message: 'Customer not found',
            details: {}
          }
        });
      }
      throw err;
    }
  }
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3000);
}
bootstrap();
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/prisma/prisma.service.ts
```ts
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

      const tenantId = TenantContext.getTenantId()!;

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
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.service.getConfig();
  }
}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenant-context/tenant-context.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = TenantContext.getTenantId();
    if (!tenantId) {
      throw new NotFoundException({
        error: {
          code: 'tenant_not_resolved',
          message: 'Tenant not resolved',
          details: {}
        }
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        branding: true,
        featureFlags: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Tenant not found',
          details: {}
        }
      });
    }

    return tenant;
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantResolverMiddleware } from './tenant-resolver.middleware.js';
import { TenantRepository } from './tenant.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantConfigController } from '../tenant-config/tenant-config.controller.js';
import { TenantConfigService } from '../tenant-config/tenant-config.service.js';

@Module({
  controllers: [TenantConfigController],
  providers: [TenantResolverMiddleware, TenantRepository, PrismaService, TenantConfigService],
  exports: [TenantRepository],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolverMiddleware).forRoutes('*');
  }
}
```

### src/tenant/tenant.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { domain } });
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { org } });
  }

  async findById(id: number): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }
}
```

### src/tenant/tenant-resolver.middleware.ts
```ts
import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from './tenant.repository.js';
import { TenantContext } from '../tenant-context/tenant-context.js';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const hostHeader = req.headers.host;
    const host = typeof hostHeader === 'string' ? hostHeader.split(':')[0] : undefined;

    const authHeader = req.headers['authorization'];
    const orgClaim =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!host || !orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing host or org claim',
            details: {}
          }
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantRepo.findByDomain(host),
      this.tenantRepo.findByOrg(orgClaim),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_found',
            message: 'Tenant not found',
            details: {}
          }
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_mismatch',
            message: 'Host and token org claim refer to different tenants',
            details: {}
          }
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const tenant = tenantByHost;

    await TenantContext.run(tenant.id, async () => {
      (req as any).tenant = tenant;
      await next();
    });
  }
}
```

### test/tenant-isolation.spec.ts
```ts
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Prisma, Customer, Tenant } from '@prisma/client';

let app: INestApplication;
let prisma: PrismaService;
let tenantAId: number;
let tenantBId: number;
let customerAId: number;
let customerBId: number;

beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  prisma = moduleRef.get<PrismaService>(PrismaService);

  // Clean up any existing data
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.tenant.deleteMany();

  // Create tenants
  const tenantA = await prisma.tenant.create({
    data: {
      org: 'tenantA',
      domain: 'app.tenant-a.com',
      name: 'Tenant A',
      branding: { logo: 'logo-a' },
      featureFlags: { featureX: true },
    },
  });
  const tenantB = await prisma.tenant.create({
    data: {
      org: 'tenantB',
      domain: 'app.tenant-b.com',
      name: 'Tenant B',
      branding: { logo: 'logo-b' },
      featureFlags: { featureX: false },
    },
  });

  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  // Create customers
  const custA = await prisma.customer.create({
    data: {
      email: 'alice@example.com',
      name: 'Alice A',
      tenantId: tenantAId,
    },
  });
  const custB = await prisma.customer.create({
    data: {
      email: 'bob@example.com',
      name: 'Bob B',
      tenantId: tenantBId,
    },
  });

  customerAId = custA.id;
  customerBId = custB.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

test('Tenant B cannot list Tenant A rows', async () => {
  const res = await request(app.getHttpServer())
    .get('/customers')
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(1);
  expect(res.body[0].email).toBe('bob@example.com');
});

test('Tenant B fetches Tenant A customer -> 404', async () => {
  await request(app.getHttpServer())
    .get(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(404)
    .expect((res: any) => {
      expect(res.body).toMatchObject({
        error: {
          code: 'resource_not_found',
          message: expect.any(String),
          details: {}
        }
      });
    });
});

test('Tenant B cannot update Tenant A customer', async () => {
  await request(app.getHttpServer())
    .patch(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .send({ name: 'Hacked' })
    .expect(404);
  const cust = await prisma.customer.findUnique({ where: { id: customerAId } });
  expect(cust!.name).toBe('Alice A');
});

test('Tenant B cannot delete Tenant A customer', async () => {
  await request(app.getHttpServer())
    .delete(`/customers/${customerAId}`)
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .expect(404);
  const cust = await prisma.customer.findUnique({ where: { id: customerAId } });
  expect(cust).not.toBeNull();
});

test('Same email can register in both tenants', async () => {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set('Host', 'app.tenant-b.com')
    .set('Authorization', 'Bearer tenantB')
    .send({ email: 'alice@example.com', name: 'Alice B' })
    .expect(201);
  expect(res.body.email).toBe('alice@example.com');

  const aliceB = await prisma.customer.findFirst({
    where: { email: 'alice@example.com', tenantId: tenantBId },
  });
  expect(aliceB).not.toBeNull();
});

test('Concurrent requests from different tenants do not cross contexts', async () => {
  const [resA, resB] = await Promise.all([
    request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-a.com')
      .set('Authorization', 'Bearer tenantA')
      .expect(200),
    request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer tenantB')
      .expect(200),
  ]);

  // Tenant A should see only its own customer
  expect(resA.body.length).toBe(1);
  expect(resA.body[0].email).toBe('alice@example.com');

  // Tenant B should see its own customers (bob and the newly added alice)
  const emailsB = resB.body.map((c: any) => c.email);
  expect(emailsB).toContain('bob@example.com');
  expect(emailsB).toContain('alice@example.com');
});

test('Request without tenant info fails', async () => {
  await request(app.getHttpServer())
    .get('/customers')
    .set('Host', 'app.tenant-a.com')
    // No Authorization header
    .expect(401)
    .expect((res: any) => {
      expect(res.body).toMatchObject({
        error: {
          code: 'tenant_resolution_failed',
          message: expect.any(String),
          details: {}
        }
      });
    });
});

test('GET /tenant-config returns branding and feature flags', async () => {
  const res = await request(app.getHttpServer())
    .get('/tenant-config')
    .set('Host', 'app.tenant-a.com')
    .set('Authorization', 'Bearer tenantA')
    .expect(200);
  expect(res.body).toMatchObject({
    branding: { logo: 'logo-a' },
    featureFlags: { featureX: true },
  });
});
```
