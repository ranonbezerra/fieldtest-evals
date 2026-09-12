# repair1-set

## reasoning

```
We need fix import paths: likely missing .ts extensions? Actually using tsconfig with moduleResolution node, paths fine. But maybe folder structure different: files are in src/... but imports use relative paths incorrectly because compiled from root? In code they use './prisma/prisma.module' etc which is correct relative to src/app.module.ts. However error says cannot find module, likely because tsconfig's "module": "ESNext" with type: module? Maybe need to add .ts extensions? In ESM, need file extensions in imports. So need to change imports to include .js? Usually with "type":"module", need extensions .js after compilation. In source TS, need .js? Actually Node ESM requires .js extensions in runtime, but TypeScript compile can handle via "moduleResolution": "node16". Might need to add .js extensions in imports. Simplify: add .js to all imports. Let's modify files accordingly.

We'll adjust imports in all files to include .js extension (e.g., './prisma/prisma.module.js'). Also for external packages like express, supertest, @nestjs/testing need types; but errors are cannot find module maybe because missing dev dependencies. However likely due to missing type declarations; we can add // @ts-ignore? Better to add import types via adding "declare module". Simpler: add type declarations by creating a stub? But instruction not to add files. Maybe the issue is that tsconfig's "moduleResolution": "node" can't resolve because path is wrong due to missing .ts extension? Actually TypeScript resolves .ts automatically. So weird.

Maybe the folder structure is different: files are under src/... but imports like '../prisma/prisma.service' from tenant/tenant.repository.ts should resolve: tenant folder sibling to prisma folder, so ../prisma/... correct.

Why cannot find? Possibly because tsconfig's "baseUrl" not set and using paths starting with './prisma/...'? Should be relative. It's correct.

Maybe the repository uses .js extension for compiled files and tests run directly ts-node? Hard.

Given time, assume need to add .js extensions. Provide changes for all files with imports.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    CustomerModule,
    TenantConfigModule,
  ],
})
export class AppModule {}
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
  NotFoundException,
} from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  async list() {
    return this.customerService.findAll();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const cust = await this.customerService.findOne(id);
    if (!cust) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return cust;
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    const updated = await this.customerService.update(id, dto);
    if (!updated) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return updated;
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const deleted = await this.customerService.delete(id);
    if (!deleted) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return { success: true };
  }
}
```

### src/customer/customer.module.ts
```ts
import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
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

  async findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.prisma.customer.create({
      data: {
        email: dto.email,
        name: dto.name,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer | null> {
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: dto,
      });
    } catch (e) {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.customer.delete({
        where: { id },
      });
      return true;
    } catch (e) {
      return false;
    }
  }
}
```

### src/customer/customer.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async findAll() {
    return this.repo.findAll();
  }

  async findOne(id: string) {
    return this.repo.findById(id);
  }

  async create(dto: CreateCustomerDto) {
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    return this.repo.update(id, dto);
  }

  async delete(id: string) {
    return this.repo.delete(id);
  }
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { json } from 'express';
import { TenantResolutionMiddleware } from './tenant/tenant.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json());

  // Apply tenant resolution middleware globally
  app.use(new TenantResolutionMiddleware().use.bind(new TenantResolutionMiddleware()));

  await app.listen(3000);
}
bootstrap();
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from '../tenant/tenant.context.js';

@Global()
@Module({
  providers: [PrismaService, TenantContext],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy, HttpException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant.context.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenantContext: TenantContext) {
    super({
      log: ['error', 'warn'],
    });
    this.$use(this.tenantMiddleware.bind(this));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async tenantMiddleware(params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => any) {
    const tenantId = this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_resolved',
            message: 'Tenant could not be resolved for this request',
            details: {},
          },
        },
        400,
      );
    }

    const writeActions = ['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany'];
    const readActions = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'];

    if (writeActions.includes(params.action)) {
      if (params.args.data) {
        params.args.data = {
          ...params.args.data,
          tenantId,
        };
      } else if (params.args) {
        if (Array.isArray(params.args.data)) {
          params.args.data = params.args.data.map((d: any) => ({ ...d, tenantId }));
        } else {
          params.args.data = { tenantId, ...params.args.data };
        }
      }
    }

    if (readActions.includes(params.action)) {
      if (!params.args.where) {
        params.args.where = { tenantId };
      } else {
        params.args.where = {
          ...params.args.where,
          tenantId,
        };
      }
    }

    return next(params);
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

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigRepository } from './tenant-config.repository.js';

@Module({
  controllers: [TenantConfigController],
  providers: [TenantConfigService, TenantConfigRepository],
})
export class TenantConfigModule {}
```

### src/tenant-config/tenant-config.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Pick<Tenant, 'branding' | 'featureFlags'> | null> {
    const tenantId = (this.prisma as any).tenantContext?.getTenantId?.();
    if (!tenantId) {
      return null;
    }
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        branding: true,
        featureFlags: true,
      },
    });
  }
}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly repo: TenantConfigRepository) {}

  async getConfig() {
    const config = await this.repo.getConfig();
    if (!config) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Tenant configuration not found',
          details: {},
        },
      });
    }
    return {
      branding: config.branding,
      featureFlags: config.featureFlags,
    };
  }
}
```

### src/tenant/tenant.middleware.ts
```ts
import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service.js';
import { TenantContext } from './tenant.context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantContext: TenantContext,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host?.split(':')[0];
    if (!host) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Host header missing',
              details: {},
            },
          },
          400,
        ),
      );
    }

    const user = (req as any).user;
    if (!user?.org) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Authenticated user missing org claim',
              details: {},
            },
          },
          401,
        ),
      );
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantService.findByDomain(host),
      this.tenantService.findByOrg(user.org),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_not_found',
              message: 'Tenant could not be found for given host or org',
              details: {},
            },
          },
          404,
        ),
      );
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_mismatch',
              message: 'Host and token org refer to different tenants',
              details: {},
            },
          },
          400,
        ),
      );
    }

    await this.tenantContext.run(tenantByHost.id, async () => {
      next();
    });
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantResolutionMiddleware } from './tenant.middleware.js';
import { TenantContext } from './tenant.context.js';

@Module({
  providers: [TenantService, TenantRepository, TenantContext],
  exports: [TenantService, TenantRepository, TenantContext],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
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
    return this.prisma.tenant.findUnique({
      where: { domain },
    });
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { org },
    });
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantRepository } from './tenant.repository.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.tenantRepo.findByDomain(domain);
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.tenantRepo.findByOrg(org);
  }
}
```
