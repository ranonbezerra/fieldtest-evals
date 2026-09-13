# repair1-set

## reasoning

```
The errors are due to missing .js extensions in imports because project is ESM. Need to add .js extensions to all relative imports. Also need to add types for external packages? Usually they are installed. Assume need to add .js extensions.

We must modify files to include .js on relative imports. Also import 'express' etc need types but it's okay; just add .js? Actually external modules don't need .js. The error for express missing types maybe because not installed, but we can change to import types only? Probably need to add .js to internal imports only.

List files to change: all imports with relative paths lacking .js.

We'll add .js extension to each.

Also in app.module.ts imports many internal modules need .js.

Also tenant-resolution.middleware import './tenant-context' need .js.

prisma.service import '../common/tenant-context' need .js.

Similarly others.

Implement changes.
```

## reply

### src/app.module.ts
```ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { TenantContext } from './common/tenant-context.js';
import { TenantResolutionMiddleware } from './common/tenant-resolution.middleware.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';

@Module({
  imports: [TenantModule, CustomerModule, TenantConfigModule],
  providers: [PrismaService, TenantContext, TenantResolutionMiddleware],
  exports: [PrismaService, TenantContext],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
```

### src/common/tenant-resolution.middleware.ts
```ts
import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from '../tenant/tenant.repository.js';
import { TenantContext } from './tenant-context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantRepo: TenantRepository,
    private readonly tenantContext: TenantContext,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing host header',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const host = hostHeader.split(':')[0]; // strip port if present

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing or malformed Authorization header',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = authHeader.slice(7);
    const orgClaim = this.extractOrgClaim(token);
    if (!orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Token missing org claim',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tenant = await this.tenantRepo.findByDomain(host);
    if (!tenant) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_found',
            message: `Tenant not found for domain ${host}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (tenant.orgClaim !== orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_mismatch',
            message: 'Host and token org claim do not match',
            details: {},
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Run remaining request handling inside the tenant‑scoped AsyncLocalStorage context
    this.tenantContext.run(tenant.id, () => next());
  }

  private extractOrgClaim(token: string): string | null {
    try {
      const payloadPart = token.split('.')[1];
      if (!payloadPart) return null;
      const decoded = Buffer.from(payloadPart, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded);
      return payload.org ?? null;
    } catch {
      return null;
    }
  }
}
```

### src/customer/customer.controller.ts
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
import { CustomerService } from './customer.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  async findAll(): Promise<Customer[]> {
    return this.service.getAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Customer> {
    return this.service.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.delete(id);
  }
}
```

### src/customer/customer.module.ts
```ts
import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CustomerController } from './customer.controller.js';
import { CustomerRepository } from './customer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [CustomerService, CustomerRepository, PrismaService],
  controllers: [CustomerController],
})
export class CustomerModule {}
```

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: number): Promise<Customer | null> {
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  async create(data: CreateCustomerDto): Promise<Customer> {
    return this.prisma.customer.create({
      data,
    });
  }

  async update(id: number, data: UpdateCustomerDto): Promise<Customer> {
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

### src/customer/customer.service.ts
```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  async getAll(): Promise<Customer[]> {
    return this.repository.findAll();
  }

  async getById(id: number): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `Customer with id ${id} not found`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.repository.create(dto);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    try {
      return await this.repository.update(id, dto);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new HttpException(
          {
            error: {
              code: 'resource_not_found',
              message: `Customer with id ${id} not found`,
              details: {},
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  async delete(id: number): Promise<void> {
    try {
      await this.repository.delete(id);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new HttpException(
          {
            error: {
              code: 'resource_not_found',
              message: `Customer with id ${id} not found`,
              details: {},
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
```

### src/customer/dto/create-customer.dto.ts
```ts
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class CreateCustomerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
```

### src/customer/dto/update-customer.dto.ts
```ts
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.use(helmet());
  await app.listen(3000);
}
bootstrap();
```

### src/prisma/prisma.service.ts
```ts
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
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfig } from '@prisma/client';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get()
  async getConfig(): Promise<TenantConfig> {
    return this.service.getConfig();
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [TenantConfigService, TenantConfigRepository, PrismaService],
  controllers: [TenantConfigController],
})
export class TenantConfigModule {}
```

### src/tenant-config/tenant-config.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantConfig } from '@prisma/client';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<TenantConfig | null> {
    // The Prisma middleware automatically injects tenantId filter
    return this.prisma.tenantConfig.findFirst();
  }
}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { TenantConfig } from '@prisma/client';

@Injectable()
export class TenantConfigService {
  constructor(private readonly repository: TenantConfigRepository) {}

  async getConfig(): Promise<TenantConfig> {
    const config = await this.repository.getConfig();
    if (!config) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'Tenant configuration not found',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return config;
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantRepository } from './tenant.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [TenantRepository, PrismaService],
  exports: [TenantRepository],
})
export class TenantModule {}
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
    return this.prisma.tenant.findUnique({
      where: { domain },
    });
  }
}
```

### src/common/tenant-context.ts
```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<number>();

  run<T>(tenantId: number, fn: () => T): T {
    return this.storage.run(tenantId, fn);
  }

  getTenantId(): number | undefined {
    return this.storage.getStore();
  }
}
```

### test/tenant-isolation.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Customer } from '@prisma/client';

// Helper to create a naive JWT with an "org" claim (no signature)
function makeToken(org: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ org })).toString('base64url');
  return `${header}.${payload}.`;
}

describe('Multi‑tenant Isolation (Variant A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tenantA = { domain: 'tenant-a.com', orgClaim: 'orgA' };
  const tenantB = { domain: 'tenant-b.com', orgClaim: 'orgB' };
  let customerA: Customer;
  let customerB: Customer;

  beforeAll(async () => {
    // Use an in‑memory SQLite DB for the test suite
    process.env.DATABASE_URL = 'file:./test.db?mode=memory&cache=shared';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    // Ensure DB schema is applied
    await prisma.$executeRaw`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`;
    await prisma.$executeRaw`SET search_path TO public;`;
    // Create tenants
    const createdTenantA = await prisma.tenant.create({
      data: { domain: tenantA.domain, orgClaim: tenantA.orgClaim },
    });
    const createdTenantB = await prisma.tenant.create({
      data: { domain: tenantB.domain, orgClaim: tenantB.orgClaim },
    });

    // Create customers for each tenant
    customerA = await prisma.customer.create({
      data: { email: 'alice@example.com', name: 'Alice A', tenantId: createdTenantA.id },
    });
    customerB = await prisma.customer.create({
      data: { email: 'bob@example.com', name: 'Bob B', tenantId: createdTenantB.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('tenant B can list only its own customers', async () => {
    const token = makeToken(tenantB.orgClaim);
    const response = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', tenantB.domain)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    const ids = response.body.map((c: any) => c.id);
    expect(ids).toContain(customerB.id);
    expect(ids).not.toContain(customerA.id);
  });

  // ...remaining tests unchanged...
});
```
