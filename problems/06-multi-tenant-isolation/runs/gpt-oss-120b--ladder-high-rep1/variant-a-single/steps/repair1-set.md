# repair1-set

## reasoning

```
We need to fix import paths. Likely tsconfig path base? But simpler: add index.ts? Actually missing extensions not needed. The issue likely because files are .ts but using ES modules require adding .js? In Node with type module, imports need .js extensions. So need to add .js to import paths. Update all imports to include .js extension. Also express types missing; need to install @types/express but can't. Instead import types from 'express' works if @types present. Probably missing dev deps. But we can change to import { Request, Response, NextFunction } from 'express'; still error if types missing. We can use any instead? Simpler: add // @ts-ignore? Better to add import type from 'express' as any? Could declare minimal types locally. Create a file src/types/express.d.ts? But easier: change imports to from 'express' to from 'express-serve-static-core' which is included? Might still need types. Probably the repository lacks @types. We can avoid importing those types by using any. Modify files to remove express imports and type annotations.

Also Prisma NextMiddleware rename to Middleware. Change import to Prisma from '@prisma/client' and use Prisma.Middleware instead of NextMiddleware.

Implement changes in relevant files.

List files to modify: src/app.module.ts imports need .js extensions. All internal imports add .js.

Also test files imports need .js? test uses ts-node? Probably need .js too.

Let's apply modifications.
```

## reply

### src/app.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { MockAuthMiddleware } from './auth/auth.middleware.js';
import { TenantResolverMiddleware } from './tenant/tenant.middleware.js';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

@Module({
  imports: [PrismaModule, TenantModule, CustomersModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MockAuthMiddleware)
      .forRoutes('*')
      .apply(TenantResolverMiddleware)
      .forRoutes('*');
  }
}
```

### src/auth/auth.middleware.ts
```ts
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class MockAuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    // For this implementation we expect the org claim to be passed via a custom header.
    const orgHeader = req.headers['x-org'];
    if (!orgHeader || typeof orgHeader !== 'string') {
      throw new UnauthorizedException('Missing X-Org header');
    }
    (req as any).user = { org: orgHeader };
    next();
  }
}
```

### src/common/all-exceptions.filter.ts
```ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorResponse = {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        details: {},
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'error' in resp) {
        errorResponse = resp as any;
      } else {
        const message = (exception.message || 'Error') as string;
        const code = this.mapStatusToCode(status);
        errorResponse = {
          error: {
            code,
            message,
            details: {},
          },
        };
      }
    } else if (exception instanceof Error) {
      const message = exception.message || 'Error';
      errorResponse = {
        error: {
          code: 'internal_error',
          message,
          details: {},
        },
      };
    }

    response.status(status).json(errorResponse);
  }

  private mapStatusToCode(status: number): string {
    const map: { [key: number]: string } = {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'resource_not_found',
      409: 'conflict',
    };
    return map[status] ?? 'error';
  }
}
```

### src/customers/customers.controller.ts
```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { Customer } from '@prisma/client';

class CreateCustomerDto {
  email!: string;
  name!: string;
}

class UpdateCustomerDto {
  email?: string;
  name?: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  async list(): Promise<Customer[]> {
    return this.service.list();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number): Promise<Customer> {
    return this.service.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.service.create(dto.email, dto.name);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.service.delete(id);
    return { success: true };
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module, Scope } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CustomersRepository } from './customers.repository.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [
    {
      provide: CustomersRepository,
      useClass: CustomersRepository,
      scope: Scope.REQUEST,
    },
    {
      provide: CustomersService,
      useClass: CustomersService,
      scope: Scope.REQUEST,
    },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
```

### src/customers/customers.repository.ts
```ts
import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Customer } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: number): Promise<Customer | null> {
    // Use findFirst so the tenant middleware can add the tenant filter
    return this.prisma.customer.findFirst({
      where: { id },
    });
  }

  async create(data: { email: string; name: string }): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  async update(id: number, data: { email?: string; name?: string }): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async delete(id: number): Promise<Customer> {
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
```

### src/customers/customers.service.ts
```ts
import { Injectable, Scope, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { Customer } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async list(): Promise<Customer[]> {
    return this.repo.findAll();
  }

  async getById(id: number): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return customer;
  }

  async create(email: string, name: string): Promise<Customer> {
    return this.repo.create({ email, name });
  }

  async update(id: number, data: { email?: string; name?: string }): Promise<Customer> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return this.repo.update(id, data);
  }

  async delete(id: number): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    await this.repo.delete(id);
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
```

### src/tenant/tenant-config.controller.ts
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

### src/tenant/tenant-config.service.ts
```ts
import { Injectable, Scope, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class TenantConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  async getConfig() {
    const tenant = (this.request as any).tenant;
    if (!tenant) {
      throw new Error('Tenant not resolved');
    }
    return this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { branding: true, feature_flags: true },
    });
  }
}
```

### src/tenant/tenant.middleware.ts
```ts
import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service.js';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host;
    const org = (req as any).user?.org;

    if (!host) {
      throw new BadRequestException('Host header missing');
    }
    if (!org) {
      throw new UnauthorizedException('Auth token missing org claim');
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantService.findByHost(host),
      this.tenantService.findByOrg(org),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      throw new UnauthorizedException('Tenant not found');
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      throw new UnauthorizedException('Tenant host and org mismatch');
    }

    (req as any).tenant = { id: tenantByHost.id };
    next();
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, Scope } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantResolverMiddleware } from './tenant.middleware.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [
    TenantService,
    TenantResolverMiddleware,
    {
      provide: TenantConfigService,
      useClass: TenantConfigService,
      scope: Scope.REQUEST,
    },
  ],
  exports: [TenantService],
})
export class TenantModule {}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findByHost(host: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { host } });
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { org } });
  }

  async getConfig(tenantId: number) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { branding: true, feature_flags: true },
    });
  }
}
```

### test/multi-tenant.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '@prisma/client';

describe('Multi-tenant isolation', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const tenantA = { org: 'org-a', host: 'tenant-a.com', name: 'Tenant A' };
  const tenantB = { org: 'org-b', host: 'tenant-b.com', name: 'Tenant B' };

  let customerAId: number;
  let customerBId: number;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await prisma.order.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.tenant.deleteMany();

    const tenantARecord = await prisma.tenant.create({
      data: {
        org: tenantA.org,
        host: tenantA.host,
        name: tenantA.name,
        branding: { logo: 'logo-a.png' },
        feature_flags: { featureX: true },
      },
    });

    const tenantBRecord = await prisma.tenant.create({
      data: {
        org: tenantB.org,
        host: tenantB.host,
        name: tenantB.name,
        branding: { logo: 'logo-b.png' },
        feature_flags: { featureX: false },
      },
    });

    const custA = await prisma.customer.create({
      data: {
        tenantId: tenantARecord.id,
        email: 'alice@example.com',
        name: 'Alice',
      },
    });
    const custB = await prisma.customer.create({
      data: {
        tenantId: tenantBRecord.id,
        email: 'bob@example.com',
        name: 'Bob',
      },
    });

    customerAId = custA.id;
    customerBId = custB.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('Tenant B cannot see Tenant A rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe('bob@example.com');
  });

  it('Tenant B cannot fetch Tenant A customer by id (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body).toEqual({
      error: {
        code: 'resource_not_found',
        message: `Customer with id ${customerAId} not found`,
        details: {},
      },
    });
  });

  it('Tenant B cannot update Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .send({ name: 'Eve' })
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');

    const check = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(200);

    expect(check.body.name).toBe('Alice');
  });

  it('Tenant B cannot delete Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/customers/${customerAId}`)
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');

    const check = await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(200);
    expect(check.body.email).toBe('alice@example.com');
  });

  it('Same email can register in both tenants', async () => {
    const email = 'shared@example.com';

    const resA = await request(app.getHttpServer())
      .post('/customers')
      .send({ email, name: 'Shared A' })
      .set('host', tenantA.host)
      .set('x-org', tenantA.org)
      .expect(201);
    expect(resA.body.email).toBe(email);
    expect(resA.body.name).toBe('Shared A');

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .send({ email, name: 'Shared B' })
      .set('host', tenantB.host)
      .set('x-org', tenantB.org)
      .expect(201);
    expect(resB.body.email).toBe(email);
    expect(resB.body.name).toBe('Shared B');
  });

  it('Concurrent requests from different tenants do not cross contexts', async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .get('/customers')
        .set('host', tenantA.host)
        .set('x-org', tenantA.org),
      request(app.getHttpServer())
        .get('/customers')
        .set('host', tenantB.host)
        .set('x-org', tenantB.org),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const emailsA = resA.body.map((c: any) => c.email);
    const emailsB = resB.body.map((c: any) => c.email);

    expect(emailsA).toContain('alice@example.com');
    expect(emailsA).toContain('shared@example.com');
    expect(emailsA).not.toContain('bob@example.com');

    expect(emailsB).toContain('bob@example.com');
    expect(emailsB).toContain('shared@example.com');
    expect(emailsB).not.toContain('alice@example.com');
  });

  it('Request without tenant context fails', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantA.host)
      .expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});
```
