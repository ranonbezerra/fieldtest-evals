# repair2-set

## reasoning

```
We need fix imports missing .js extensions, tenantId missing in create. Add tenantId from context. Also main.ts using express import missing types; need to import from 'express' with types installed? Probably add @types/express not available. Simpler: avoid importing express types, use any. Change import to import type { Request, Response, NextFunction } from 'express'; but type errors still. Could add // @ts-ignore? Better to add import from 'express' but need types. Assume @types/express not installed, so we can use any instead: replace types with any.

Also main.ts using TenantResolutionMiddleware constructor requires args, but they passed none. Should get from Nest context, not instantiate manually. Use app.use(new TenantResolutionMiddleware().use.bind(...)) is wrong. Should use app.use((req,res,next)=>...). But for compile, change to accept zero args by making constructor params optional. Update TenantResolutionMiddleware to have optional tenantService and tenantContext and handle undefined.

Also test imports errors: tsconfig path? For test files, they compile with ts-node? Need to add .js extensions in imports. Change imports to include .js.

Update test file imports.

Also implicit any: add types any.

Implement changes.
```

## reply

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';
import { TenantContext } from '../tenant/tenant.context.js';

@Injectable()
export class CustomerRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async findAll(): Promise<Customer[]> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.findMany({
      where: { tenantId },
    });
  }

  async findById(id: string): Promise<Customer | null> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.findUnique({
      where: { id },
      rejectOnNotFound: false,
    }).then((c) => (c && c.tenantId === tenantId ? c : null));
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.create({
      data: {
        email: dto.email,
        name: dto.name,
        tenantId,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer | null> {
    const tenantId = this.tenantContext.get();
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: { ...dto },
      }).then((c) => (c.tenantId === tenantId ? c : null));
    } catch (e) {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    const tenantId = this.tenantContext.get();
    try {
      const del = await this.prisma.customer.delete({
        where: { id },
      });
      return del.tenantId === tenantId;
    } catch (e) {
      return false;
    }
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

  // Apply tenant resolution middleware globally using Nest's middleware consumer style
  const tenantMiddleware = app.get(TenantResolutionMiddleware);
  app.use(tenantMiddleware.use.bind(tenantMiddleware));

  await app.listen(3000);
}
bootstrap();
```

### src/tenant/tenant.middleware.ts
```ts
import {
  Injectable,
  NestMiddleware,
  HttpException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service.js';
import { TenantContext } from './tenant.context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantService?: TenantService,
    private readonly tenantContext?: TenantContext,
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

    if (!this.tenantService || !this.tenantContext) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Tenant services not initialized',
              details: {},
            },
          },
          500,
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

### test/tenant-isolation.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

describe('Multi‑Tenant Isolation (L2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let customerAId: string;
  let customerBId: string;

  const jwtPayload = (org: string) => ({
    sub: 'user-' + org,
    org,
  });

  const mockJwtGuard = (org: string) => ({
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = jwtPayload(org);
      return true;
    },
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = jwtPayload('org-a');
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);

    await prisma.order.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.plan.deleteMany({});
    await prisma.tenant.deleteMany({});

    const tenantA = await prisma.tenant.create({
      data: {
        org: 'org-a',
        domain: 'app.tenant-a.com',
        branding: { logo: 'A' },
        featureFlags: { beta: true },
      },
    });
    const tenantB = await prisma.tenant.create({
      data: {
        org: 'org-b',
        domain: 'app.tenant-b.com',
        branding: { logo: 'B' },
        featureFlags: { beta: false },
      },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

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
    await app.close();
  });

  it('Tenant B cannot list Tenant A customers', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.OK)
      .expect((res: any) => {
        const ids = res.body.map((c: any) => c.id);
        if (ids.includes(customerAId)) {
          throw new Error('Tenant B received Tenant A customer');
        }
        if (!ids.includes(customerBId)) {
          throw new Error('Tenant B did not receive its own customer');
        }
      });
  });

  it('Fetching Tenant A customer by ID from Tenant B returns 404', async () => {
    await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND)
      .expect((res: any) => {
        if (res.body.error?.code !== 'resource_not_found') {
          throw new Error('Incorrect error format');
        }
      });
  });

  it('Updating Tenant A customer from Tenant B returns 404 and does not modify', async () => {
    await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .send({ name: 'Hacked' })
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND);

    const fresh = await prisma.customer.findUnique({ where: { id: customerAId } });
    if (fresh?.name !== 'Alice A') {
      throw new Error('Tenant A customer was mutated by Tenant B');
    }
  });

  it('Deleting Tenant A customer from Tenant B returns 404 and stays', async () => {
    await request(app.getHttpServer())
      .delete(`/customers/${customerAId}`)
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.NOT_FOUND);

    const exists = await prisma.customer.findUnique({ where: { id: customerAId } });
    if (!exists) {
      throw new Error('Tenant A customer was deleted by Tenant B');
    }
  });

  it('Same email can be registered in both tenants', async () => {
    const resA = await request(app.getHttpServer())
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared A' })
      .set('Host', 'app.tenant-a.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.CREATED);

    const resB = await request(app.getHttpServer())
      .post('/customers')
      .send({ email: 'shared@example.com', name: 'Shared B' })
      .set('Host', 'app.tenant-b.com')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.CREATED);

    const aRec = await prisma.customer.findUnique({
      where: { id: resA.body.id },
    });
    const bRec = await prisma.customer.findUnique({
      where: { id: resB.body.id },
    });
    if (aRec?.tenantId !== tenantAId || bRec?.tenantId !== tenantBId) {
      throw new Error('Tenant assignment incorrect for shared email');
    }
  });

  it('Concurrent requests from different tenants stay isolated', async () => {
    const [respA, respB] = await Promise.all([
      request(app.getHttpServer())
        .get('/customers')
        .set('Host', 'app.tenant-a.com')
        .set('Authorization', 'Bearer dummy')
        .expect(HttpStatus.OK),
      request(app.getHttpServer())
        .get('/customers')
        .set('Host', 'app.tenant-b.com')
        .set('Authorization', 'Bearer dummy')
        .expect(HttpStatus.OK),
    ]);

    const idsA = respA.body.map((c: any) => c.id);
    const idsB = respB.body.map((c: any) => c.id);

    if (idsA.includes(customerBId) || idsB.includes(customerAId)) {
      throw new Error('Cross‑tenant data leaked in concurrent requests');
    }
  });

  it('Request without tenant resolution fails', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', 'Bearer dummy')
      .expect(HttpStatus.BAD_REQUEST)
      .expect((res: any) => {
        if (res.body.error?.code !== 'tenant_not_resolved') {
          throw new Error('Incorrect error when tenant missing');
        }
      });
  });
});
```
