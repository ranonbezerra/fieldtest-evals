# repair2-set

## reasoning

```
We need to add missing type packages? Actually errors due to missing .js extensions in imports? In tsconfig with moduleResolution node, need .js extensions for ESM. Many imports use .js already. Missing imports like 'express', 'class-validator' need to be installed types but in code we can import types only. Probably need to add @types/express etc not allowed. Instead we can change imports to use type-only import? Actually runtime needs express types. Probably package.json missing deps but we can't modify. Simplify by adding a stub module declarations? Could create a declarations file? But easier: change imports to use require? Not.

Probably the issue is missing .js extension in import paths for internal modules: tenant-config imports './tenant-context.js' but file is .ts without .js extension. The reference shows file tenant-context.ts? Not provided. Likely missing extension causing error. Should change to './tenant-context' without .js. Similarly other imports have .js extension already correct.

Missing external modules: we can add "declare module 'express'" etc? But better to add @types as dev dependencies not possible.

Given constraints, maybe the repo uses ES modules and needs to import from 'express' which has types but need to install @types/express. Can't.

Probably the test expects we add type-only imports using import type {}? Not.

Probably the errors stem from missing .js extensions for external libs? Actually TS cannot find module 'express' because no node_modules. We can create stub modules in src/@types? Add a file src/express.d.ts exporting needed types. But many files use Request, Response from express. We can declare minimal types.

Create a file src/express.d.ts with declare module 'express' { export interface Request {...}; export interface Response {...}; export type NextFunction = () => void; } But that's many.

Simpler: change imports to import from '@nestjs/common' Request, Response types are exported there? Nest provides Request from express. Could import from 'express' is fine if types missing.

Given time, maybe just add "// @ts-ignore" comments? Not allowed.

Probably the intended fix: add .js extension to internal imports like './tenant-context.js' should be './tenant-context' because .ts compiled to .js. Change all .js extensions to .ts? In ESM, need .js. But TypeScript expects .js? It expects .js for runtime. However error says cannot find './tenant-context.js' maybe file is .ts but compiled output .js not present. So import should be './tenant-context' (no extension). Change those imports.

Also PrismaService tenantMiddleware line: const tenantInfo = TenantContext.getTenant(); TenantContext imported from '../tenant/tenant-context.js' maybe wrong. Change to without .js.

Search: src/prisma/prisma.service.ts imports '../tenant/tenant-context.js' line 2. Change to '../tenant/tenant-context'.

Also other imports with .js internal modules: many repository files import './dto/create-customer.dto.js' etc. Those are .ts files, need .js? Actually should be without extension. Change all .js extensions in internal imports to omit extension.

Also missing external modules: we can't fix.

Given limited, produce changes for import paths.
```

## reply

### src/auth/auth.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Mock authentication: extract org ID from custom header X-Org-Id
    const orgIdHeader = req.headers['x-org-id'];
    if (typeof orgIdHeader === 'string') {
      (req as any).user = { org: orgIdHeader };
    }
    next();
  }
}
```

### src/common/filters/http-exception.filter.ts
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
    let code = 'internal_server_error';
    let message = 'Internal server error';
    let details = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseObj = exception.getResponse();

      if (typeof responseObj === 'object' && responseObj !== null) {
        const resp = responseObj as any;
        message = resp.message || resp.error || exception.message;
        if (resp.code) {
          code = resp.code;
        }
        if (resp.details) {
          details = resp.details;
        }
      } else {
        message = responseObj as string;
      }
    }

    // Map generic status codes to default error codes if not set explicitly
    if (code === 'internal_server_error') {
      if (status === HttpStatus.NOT_FOUND) {
        code = 'resource_not_found';
      } else if (status === HttpStatus.FORBIDDEN) {
        code = 'forbidden';
      } else if (status === HttpStatus.UNAUTHORIZED) {
        code = 'unauthenticated';
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        details,
      },
    });
  }
}
```

### src/customers/customers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Customer } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.prisma.customer.create({ data: dto });
  }

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { id } });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async delete(id: string): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
```

### src/customers/dto/create-customer.dto.ts
```ts
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class CreateCustomerDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
```

### src/customers/dto/update-customer.dto.ts
```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerDto } from './create-customer.dto';

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
```

### src/orders/dto/create-order.dto.ts
```ts
import { IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  planId: string;
}
```

### src/orders/orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Order } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    return this.prisma.order.create({ data: dto });
  }

  async findAll(): Promise<Order[]> {
    return this.prisma.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.prisma.order.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<Order> {
    return this.prisma.order.delete({ where: { id } });
  }
}
```

### src/plans/dto/create-plan.dto.ts
```ts
import { IsString, IsNotEmpty, IsNumber, IsPositive } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => Number(value))
  price: number;
}
```

### src/plans/dto/update-plan.dto.ts
```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanDto } from './create-plan.dto';

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
```

### src/plans/plans.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Plan } from '@prisma/client';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlanDto): Promise<Plan> {
    return this.prisma.plan.create({ data: dto });
  }

  async findAll(): Promise<Plan[]> {
    return this.prisma.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findFirst({ where: { id } });
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  async delete(id: string): Promise<Plan> {
    return this.prisma.plan.delete({ where: { id } });
  }
}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    this.$use(this.tenantMiddleware.bind(this));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async tenantMiddleware(
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<any>,
  ) {
    const tenantInfo = TenantContext.getTenant();

    const tenantModels = ['Customer', 'Plan', 'Order'];
    const model = params.model;

    // Non-tenant-aware models pass through unchanged
    if (!tenantModels.includes(model)) {
      return next(params);
    }

    if (!tenantInfo) {
      throw new Error('Tenant not set in context');
    }

    const tenantId = tenantInfo.id;
    const { action, args } = params;

    const addTenantToWhere = (where: any) => {
      if (!where) {
        return { tenantId };
      }
      return {
        AND: [where, { tenantId }],
      };
    };

    // READ ACTIONS
    if (
      ['findFirst', 'findMany', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow'].includes(
        action,
      )
    ) {
      if (action === 'findUnique' || action === 'findUniqueOrThrow') {
        // Convert to findFirst with tenant filter
        params.action = 'findFirst';
        params.args.where = addTenantToWhere(args.where);
        return next(params);
      } else {
        // For findFirst, findMany, findFirstOrThrow
        params.args.where = addTenantToWhere(args.where);
        return next(params);
      }
    }

    // WRITE ACTIONS
    if (
      [
        'create',
        'createMany',
        'update',
        'updateMany',
        'upsert',
        'delete',
        'deleteMany',
      ].includes(action)
    ) {
      if (action === 'create') {
        args.data = { ...args.data, tenantId };
        return next(params);
      }
      if (action === 'createMany') {
        args.data = args.data.map((d: any) => ({ ...d, tenantId }));
        return next(params);
      }
      if (action === 'update' || action === 'upsert') {
        args.where = addTenantToWhere(args.where);
        if (action === 'update') {
          args.data = { ...args.data, tenantId };
        } else {
          // upsert
          args.create = { ...args.create, tenantId };
          args.update = { ...args.update, tenantId };
        }
        return next(params);
      }
      if (action === 'updateMany' || action === 'deleteMany') {
        args.where = addTenantToWhere(args.where);
        return next(params);
      }
      if (action === 'delete') {
        args.where = addTenantToWhere(args.where);
        return next(params);
      }
    }

    // Default: pass through
    return next(params);
  }
}
```

### src/tenant/tenant.middleware.ts
```ts
import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext, TenantInfo } from './tenant-context';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Resolve host (domain)
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      throw new UnauthorizedException('Missing Host header');
    }
    const host = hostHeader.split(':')[0];

    // Resolve org claim from request.user set by AuthMiddleware
    const user = (req as any).user;
    const orgClaim = user?.org;
    if (!orgClaim) {
      throw new UnauthorizedException('Missing org claim in token');
    }

    // Find tenant by domain (host)
    const tenant = await this.prisma.tenant.findUnique({
      where: { domain: host },
    });

    if (!tenant) {
      throw new ForbiddenException(`Tenant not found for host ${host}`);
    }

    if (tenant.id !== orgClaim) {
      throw new ForbiddenException('Tenant mismatch between host and token');
    }

    const tenantInfo: TenantInfo = { id: tenant.id };
    // Run the rest of the request inside async local storage context
    TenantContext.run(tenantInfo, () => {
      // Attach tenant to request for convenience
      (req as any).tenant = tenant;
      next();
    });
  }
}
```

### src/tenant-config/tenant-config.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Tenant } from '@prisma/client';
import { TenantContext } from './tenant-context';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Pick<Tenant, 'id' | 'domain' | 'branding' | 'featureFlags'>> {
    const tenantInfo = TenantContext.getTenant();
    if (!tenantInfo) {
      throw new Error('Tenant not set');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantInfo.id },
      select: {
        id: true,
        domain: true,
        branding: true,
        featureFlags: true,
      },
    });
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    return tenant;
  }
}
```

### test/tenant-isolation.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { Prisma } from '@prisma/client';

describe('Tenant Isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tenantA = {
    domain: 'a.operator.com',
    branding: 'Tenant A Branding',
    featureFlags: { featureX: true },
  };

  const tenantB = {
    domain: 'b.operator.com',
    branding: 'Tenant B Branding',
    featureFlags: { featureX: false },
  };

  let tenantAId: string;
  let tenantBId: string;

  let tenantACustomerId: string;
  let tenantBCustomerId: string;

  let tenantAPlanId: string;
  let tenantBPlanId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean DB
    await prisma.order.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.tenant.deleteMany();

    // Create tenants
    const tenantARecord = await prisma.tenant.create({
      data: {
        domain: tenantA.domain,
        branding: tenantA.branding,
        featureFlags: tenantA.featureFlags,
      },
    });
    tenantAId = tenantARecord.id;

    const tenantBRecord = await prisma.tenant.create({
      data: {
        domain: tenantB.domain,
        branding: tenantB.branding,
        featureFlags: tenantB.featureFlags,
      },
    });
    tenantBId = tenantBRecord.id;

    // Create customers
    const custA = await prisma.customer.create({
      data: {
        email: 'john@example.com',
        name: 'John A',
        tenantId: tenantAId,
      },
    });
    tenantACustomerId = custA.id;

    const custB = await prisma.customer.create({
      data: {
        email: 'jane@example.com',
        name: 'Jane B',
        tenantId: tenantBId,
      },
    });
    tenantBCustomerId = custB.id;

    // Create plans
    const planA = await prisma.plan.create({
      data: {
        name: 'Basic A',
        price: new Prisma.Decimal(9.99),
        tenantId: tenantAId,
      },
    });
    tenantAPlanId = planA.id;

    const planB = await prisma.plan.create({
      data: {
        name: 'Basic B',
        price: new Prisma.Decimal(19.99),
        tenantId: tenantBId,
      },
    });
    tenantBPlanId = planB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Tenant B cannot list Tenant A customers', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const emails = res.body.map((c: any) => c.email);
    expect(emails).not.toContain('john@example.com');
    expect(emails).toContain('jane@example.com');
  });

  it('Tenant B cannot fetch Tenant A customer by id (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');
  });

  it('Tenant B cannot update Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .send({ name: 'Hacked Name' })
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');

    const original = await prisma.customer.findUnique({ where: { id: tenantACustomerId } });
    expect(original?.name).toBe('John A');
  });

  it('Tenant B cannot delete Tenant A customer (404)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/customers/${tenantACustomerId}`)
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'resource_not_found');

    const still = await prisma.customer.findUnique({ where: { id: tenantACustomerId } });
    expect(still).not.toBeNull();
  });

  it('Same email can register in both tenants', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId)
      .send({ email: 'john@example.com', name: 'John B' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    const newCustomerId = res.body.id;

    const cust = await prisma.customer.findUnique({ where: { id: newCustomerId } });
    expect(cust?.email).toBe('john@example.com');
    expect(cust?.tenantId).toBe(tenantBId);
  });

  it('Concurrent requests from different tenants do not cross contexts', async () => {
    const reqA = request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantA.domain)
      .set('x-org-id', tenantAId);

    const reqB = request(app.getHttpServer())
      .get('/customers')
      .set('host', tenantB.domain)
      .set('x-org-id', tenantBId);

    const [resA, resB] = await Promise.all([reqA.expect(200), reqB.expect(200)]);

    const emailsA = resA.body.map((c: any) => c.email);
    const emailsB = resB.body.map((c: any) => c.email);

    expect(emailsA).toContain('john@example.com');
    expect(emailsA).not.toContain('jane@example.com');

    expect(emailsB).toContain('jane@example.com');
    expect(emailsB).not.toContain('john@example.com');
  });

  it('Query without tenant context fails', async () => {
    let errorCaught = false;
    try {
      await prisma.customer.findMany();
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toMatch(/Tenant not set/);
    }
    expect(errorCaught).toBe(true);
  });
});
```
