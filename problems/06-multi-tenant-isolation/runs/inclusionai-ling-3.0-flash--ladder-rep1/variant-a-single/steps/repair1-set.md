# repair1-set

## reasoning

```
Let me analyze the errors as a whole to find the distinct mistakes.

The dominant pattern is "Cannot find module" errors everywhere. This is because the project uses ESM (`"type": "module"`) with `moduleResolution: "node16"` or `nodenext`, which requires explicit `.js` file extensions in relative imports — even for TypeScript source files. So every relative import like `./foo` needs to become `./foo.js`.

Let me enumerate the distinct mistakes:

1. **Missing `.js` extensions on all relative imports.** This affects a huge number of files. Every relative import path needs `.js` added.

2. **`src/database/prisma.service.ts(12,5): error TS2739`**: The type issue with `$extends` return type. The issue is that `PrismaService` declares `prisma: PrismaClient` but the extended client doesn't match. Need to type it properly. Actually looking more carefully - the `prisma` property is typed as `PrismaClient` but `$extends` returns a `DynamicClientExtensionThis` type. We need to type it differently. Actually the simplest fix is to type it as `any` or use a proper type. Let me think... The cleanest is probably `public readonly prisma: PrismaClient` needs to accept the extended type. Actually since `$extends` returns a different type, we might need to cast or type `prisma` as `any`. Or we could declare it as `PrismaClient` but the assignment fails. Let me use a type assertion.

3. **`src/tenant/tenant-prisma.extension.ts(5,17): error TS2339: Property '$extends' does not exist on type 'typeof Prisma'.`** This is likely a type definition issue. We may need to use a different approach or cast. Actually this might be because Prisma types aren't properly loaded. One common fix is to use `PrismaClient` as the base and extend from it differently, or to use `as any` cast on `Prisma.$extends`. Let me think about what makes sense... Actually this could also be a Prisma version issue. The safest fix is to cast: `(Prisma as any).$extends(...)`.

4. **`src/tenant/tenant-prisma.extension.ts(8,32-56): Binding elements implicitly 'any'`** - This is because the callback parameters aren't typed. Need to type them properly using `Prisma.QueryFilter` or define proper types. Actually, looking at the Prisma extension API, the `$extends` query callback receives arguments. We need proper typing. Let me look at what the standard Prisma extension signature is... The standard signature is:
```ts
$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) { ... }
    }
  }
})
```
The types come from Prisma's internal types. If `$extends` doesn't exist on `typeof Prisma`, then we need to cast to `any` first, and the parameters will need typing or we can use `any`. Let me cast and use `any` for the params.

5. **`src/tenant/tenant.middleware.ts(2,45): error TS2305: Module '"@nestjs/common"' has no exported member 'NextFunction'`** - In NestJS, `NextFunction` is not exported from `@nestjs/common`. It should be imported from `@nestjs/core` or we can use `Function` type. Actually in recent NestJS versions, `NextFunction` might not exist. We can just use `Function` or import from the right place. The standard NestJS middleware uses `Next` type. Actually let me check - in newer versions, the middleware interface uses `void` return and the `next` callback is typically typed as `(...) => void` or just `Function`. The simplest fix is to remove the `NextFunction` import and type `next` as `Function`.

6. **`src/tenant/tenant.middleware.ts(22,31): error TS2339: Property 'host' does not exist on type 'Headers'`** - The `Headers` type in newer TS/Node doesn't have `host`. We should use `req.headers['host']` instead of `req.headers.host`.

7. **`src/tenant/tenant.middleware.ts(23,37): error TS2339: Property 'authorization' does not exist on type 'Headers'`** - Same issue, use `req.headers['authorization']`.

Now let me go through each file and fix all errors.

Let me think about what files I need to produce. I need to fix all files with errors. Let me list them:

1. `src/app.module.ts` - just `.js` extensions on imports
2. `src/customers/customers.controller.ts` - `.js` extensions on imports
3. `src/customers/customers.module.ts` - `.js` extensions on imports
4. `src/customers/customers.repository.ts` - `.js` extensions on imports
5. `src/customers/customers.service.ts` - `.js` extensions on imports
6. `src/database/database.module.ts` - `.js` extensions on imports
7. `src/database/prisma.service.ts` - `.js` extension + type issue
8. `src/main.ts` - `.js` extension on import
9. `src/plans/plans.controller.ts` - `.js` extensions on imports
10. `src/plans/plans.module.ts` - `.js` extensions on imports
11. `src/plans/plans.repository.ts` - `.js` extensions on imports
12. `src/plans/plans.service.ts` - `.js` extensions on imports
13. `src/tenant-config/tenant-config.controller.ts` - `.js` extensions on imports
14. `src/tenant-config/tenant-config.module.ts` - `.js` extensions on imports
15. `src/tenant-config/tenant-config.service.ts` - `.js` extensions on imports
16. `src/tenant/tenant-prisma.extension.ts` - `.js` extensions + `$extends` cast + parameter types
17. `src/tenant/tenant.middleware.ts` - `NextFunction` fix, `.js` extensions, `headers.host`/`authorization` fix, `.js` extension on import
18. `src/tenant/tenant.module.ts` - `.js` extensions on imports
19. `src/tenant/tenant.service.ts` - `.js` extensions on imports

Now let me construct each file. The approach for relative imports is to add `.js` extension to all relative import paths.

For `src/database/prisma.service.ts`, the type issue with the extended client: I'll type `prisma` using a type that accommodates the extension. The simplest reliable approach:
```ts
public readonly prisma: PrismaClient;
```
and cast the extension result, or declare it as `any`. Actually, the cleanest fix for TS2739 is to type it as the return type of `$extends`. But since `$extends` itself is erroring... Let me use:
```ts
public readonly prisma: PrismaClient;
```
and cast:
```ts
this.prisma = (baseClient as any).$extends(...) as PrismaClient;
```

For `src/tenant/tenant-prisma.extension.ts`:
- Cast `(Prisma as any).$extends(...)`
- Use `any` for the callback parameters since the type resolution is broken anyway

Let me now write out all the files.

For the middleware, let me fix:
- Remove `NextFunction` from import, replace with just using `Function` type for `next`
- Fix `req.headers.host` → `req.headers['host']`
- Fix `req.headers.authorization` → `req.headers['authorization']`
- Add `.js` to `../common/tenant-context` import

Wait, let me re-examine the NestJS middleware. The `NestMiddleware` interface has `use(req: Request, res: Response, next: NextFunction)`. In recent versions of `@nestjs/common`, `NextFunction` was removed. The alternative is to use `@nestjs/core`'s `NextFunction` or just type it as `Function`. Let me type `next: Function`.

Also I should keep the imports from `@nestjs/common` clean - remove `NextFunction` from the import and keep `Request, Response`.

Let me now produce all files systematically. I'll need to be very careful with every single import path.

Actually, wait. Let me reconsider the structure. The reference files show paths like:
- `src/database/prisma.service.ts` imports from `../tenant/tenant-prisma.extension` and `../common/tenant-context`
- `src/tenant/tenant.middleware.ts` imports from `./tenant.service` and `../common/tenant-context`

With `type: "module"` and `moduleResolution: "node16"/"nodenext"`, ALL relative imports need `.js` extension, even though the actual files are `.ts` (this is a TypeScript convention where the .ts files get compiled to .js).

Let me now go through each file carefully.

Let me write all the changed files:

### src/app.module.ts
Change all relative imports to have `.js`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PlansModule } from './plans/plans.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { AllExceptionsFilter } from './common/exceptions.filter.js';

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    TenantConfigModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

### src/customers/customers.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Post()
  async create(@Body() data: CreateCustomerDto) {
    return this.customersService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdateCustomerDto) {
    return this.customersService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.customersService.delete(id);
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository, CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
```

### src/customers/customers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './customers.dto.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.customer.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.customer.findFirst({
      where: { id },
    });
  }

  create(data: CreateCustomerDto) {
    return this.prisma.prisma.customer.create({ data });
  }

  update(id: string, data: UpdateCustomerDto) {
    return this.prisma.prisma.customer.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.prisma.customer.delete({
      where: { id },
    });
  }
}
```

### src/customers/customers.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async create(data: CreateCustomerDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateCustomerDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }
}
```

### src/database/database.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### src/database/prisma.service.ts
Fix the `.js` extension and the type issue. For the type issue, I'll cast the extension result.
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly prisma: PrismaClient;

  constructor() {
    const baseClient = new PrismaClient({ log: ['error', 'warn'] });
    this.prisma = baseClient.$extends(createTenantExtension(() => getTenantId())) as PrismaClient;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
```

Wait, but `$extends` doesn't exist on `typeof Prisma` per the error in the extension file. Let me check - the error says `src/tenant/tenant-prisma.extension.ts(5,17): error TS2339: Property '$extends' does not exist on type 'typeof Prisma'.` That's in the extension file where it does `Prisma.$extends(...)`. 

In `prisma.service.ts`, the error is `TS2739: Type 'DynamicClientExtensionThis<...>' is missing properties from type 'PrismaClient'`. So `$extends` works at runtime (since it's a Prisma client method), but the TypeScript types are complaining.

The fix for `prisma.service.ts` is the cast `as PrismaClient`. For the extension file, we need to fix the `$extends` issue.

For the extension file, the standard approach when types don't work is:
```ts
export function createTenantExtension(getTenantIdFn: () => string | undefined) {
  return (Prisma as unknown as typeof Prisma & { $extends: typeof Prisma.$extends }).$extends({
    ...
  });
}
```

Or simpler:
```ts
return (Prisma as any).$extends({...});
```

And for the callback parameters, type them as `any` since we're using `any` for the Prisma cast anyway.

### src/tenant/tenant-prisma.extension.ts
```ts
import { Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context.js';

export function createTenantExtension(getTenantIdFn: () => string | undefined) {
  return (Prisma as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: any; operation: any; args: any; query: any }) {
          const tenantId = getTenantIdFn();

          if (!tenantId) {
            throw new Error('No tenant in context');
          }

          return handleOperation(
            { model, operation, args, query, tenantId },
          );
        },
      },
    },
  });
}

async function handleOperation(ctx: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  tenantId: string;
}) {
  const { operation, args, query, tenantId } = ctx;

  const readOps = new Set([
    'findMany',
    'findFirst',
    'findUnique',
    'findFirstOrThrow',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ]);

  if (readOps.has(operation)) {
    const modifiedArgs = {
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    };
    return query(modifiedArgs);
  }

  if (operation === 'create') {
    return query({
      ...args,
      data: addTenantToCreateData(args.data, tenantId),
    });
  }

  if (operation === 'createMany') {
    const originalData = args.data;
    const newData =
      Array.isArray(originalData)
        ? originalData.map((d) => addTenantToCreateData(d, tenantId))
        : addTenantToCreateData(originalData, tenantId);
    return query({ ...args, data: newData });
  }

  if (operation === 'upsert') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      create: addTenantToCreateData(args.create, tenantId),
      update: addTenantToUpdateData(args.update, tenantId),
    });
  }

  if (operation === 'update' || operation === 'updateMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      data: addTenantToUpdateData(args.data, tenantId),
    });
  }

  if (operation === 'delete' || operation === 'deleteMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    });
  }

  return query(args);
}

function addTenantToWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = where as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId: { set: tenantId } };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId: { set: tenantId } };
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/plans/plans.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.plansService.findById(id);
  }

  @Post()
  async create(@Body() data: CreatePlanDto) {
    return this.plansService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdatePlanDto) {
    return this.plansService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.plansService.delete(id);
  }
}
```

### src/plans/plans.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [PlansRepository, PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule {}
```

### src/plans/plans.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.plan.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.plan.findFirst({ where: { id } });
  }

  create(data: CreatePlanDto) {
    return this.prisma.prisma.plan.create({ data });
  }

  update(id: string, data: UpdatePlanDto) {
    return this.prisma.prisma.plan.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.prisma.plan.delete({ where: { id } });
  }
}
```

### src/plans/plans.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PlansRepository } from './plans.repository.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Injectable()
export class PlansService {
  constructor(private readonly repository: PlansRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const plan = await this.repository.findById(id);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  async create(data: CreatePlanDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdatePlanDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }
}
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.tenantConfigService.getConfig();
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigController } from './tenant-config.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantConfigService],
  controllers: [TenantConfigController],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new NotFoundException('No tenant context');
    }

    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      name: tenant.name,
      domain: tenant.domain,
      branding: tenant.branding,
      flags: tenant.flags,
    };
  }
}
```

### src/tenant/tenant.middleware.ts
Fix `NextFunction` → `Function`, `.js` extension on imports, `headers.host` → `headers['host']`, `headers.authorization` → `headers['authorization']`.

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { NestMiddleware, Request, Response } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { setTenantContext } from '../common/tenant-context.js';

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: Function) {
    const host = (req.headers['host'] || '').split(':')[0];
    const authHeader = (req.headers['authorization'] || '') as string;
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const tokenPayload = decodeJwt(token);
    const orgClaim = tokenPayload?.org;

    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = orgClaim
      ? await this.tenantService.resolveByOrg(orgClaim)
      : null;

    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant resolution failed: host and token do not agree');
    }

    setTenantContext(hostTenant.id);
    (req as any).tenant = hostTenant;

    next();
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantService, TenantMiddleware],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByDomain(domain: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { domain },
    });
  }

  async resolveByOrg(org: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { org },
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}
```

Now let me also check: there's an `orders` module referenced in `app.module.ts` (`./orders/orders.module.js`) but there's no orders reference in the error list, meaning it presumably doesn't have errors (but we don't have its source). We don't need to produce it since there are no errors reported for it.

Also `src/common/tenant-context.ts` is imported by several files - it's not in the error list so it must be fine.

And `src/common/exceptions.filter.ts` - also not in error list, fine.

Let me double-check my understanding of the middleware `Headers` issue. In Node's `@types/node`, `Headers` (from `undici` types or the standard `Headers`) might not have `host` as a property. Using `req.headers['host']` should work since it's accessed via index signature.

Actually wait - `req.headers` in NestJS/Express is typed as `Record<string, string | string[] | undefined>` or similar. Actually in NestJS with the Request type, `req.headers` could be `PseudoHeaders` or `Headers` depending on the platform. The errors say `'host' does not exist on type 'Headers'` and `'authorization' does not exist on type 'Headers'`. Using bracket notation `req.headers['host']` should work because `Headers` has an index signature.

OK, I think my fixes are complete. Let me organize them.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantConfigModule } from './tenant-config/tenant-config.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PlansModule } from './plans/plans.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { AllExceptionsFilter } from './common/exceptions.filter.js';

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    TenantConfigModule,
    CustomersModule,
    PlansModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly prisma: PrismaClient;

  constructor() {
    const baseClient = new PrismaClient({ log: ['error', 'warn'] });
    this.prisma = baseClient.$extends(createTenantExtension(() => getTenantId())) as PrismaClient;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
```

### src/tenant/tenant-prisma.extension.ts
```ts
import { Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context.js';

export function createTenantExtension(getTenantIdFn: () => string | undefined) {
  return (Prisma as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: any; operation: any; args: any; query: any }) {
          const tenantId = getTenantIdFn();

          if (!tenantId) {
            throw new Error('No tenant in context');
          }

          return handleOperation(
            { model, operation, args, query, tenantId },
          );
        },
      },
    },
  });
}

async function handleOperation(ctx: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  tenantId: string;
}) {
  const { operation, args, query, tenantId } = ctx;

  const readOps = new Set([
    'findMany',
    'findFirst',
    'findUnique',
    'findFirstOrThrow',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ]);

  if (readOps.has(operation)) {
    const modifiedArgs = {
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    };
    return query(modifiedArgs);
  }

  if (operation === 'create') {
    return query({
      ...args,
      data: addTenantToCreateData(args.data, tenantId),
    });
  }

  if (operation === 'createMany') {
    const originalData = args.data;
    const newData =
      Array.isArray(originalData)
        ? originalData.map((d) => addTenantToCreateData(d, tenantId))
        : addTenantToCreateData(originalData, tenantId);
    return query({ ...args, data: newData });
  }

  if (operation === 'upsert') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      create: addTenantToCreateData(args.create, tenantId),
      update: addTenantToUpdateData(args.update, tenantId),
    });
  }

  if (operation === 'update' || operation === 'updateMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
      data: addTenantToUpdateData(args.data, tenantId),
    });
  }

  if (operation === 'delete' || operation === 'deleteMany') {
    return query({
      ...args,
      where: addTenantToWhere(args.where, tenantId),
    });
  }

  return query(args);
}

function addTenantToWhere(where: any, tenantId: string): any {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = where as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToCreateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId };
}

function addTenantToUpdateData(data: any, tenantId: string): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tenantId: { set: tenantId } };
  }
  const { tenantId: _ignored, ...rest } = data as Record<string, any>;
  return { ...rest, tenantId: { set: tenantId } };
}
```

### src/tenant/tenant.middleware.ts
```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { NestMiddleware, Request, Response } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { setTenantContext } from '../common/tenant-context.js';

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: Function) {
    const host = (req.headers['host'] || '').split(':')[0];
    const authHeader = (req.headers['authorization'] || '') as string;
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const tokenPayload = decodeJwt(token);
    const orgClaim = tokenPayload?.org;

    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = orgClaim
      ? await this.tenantService.resolveByOrg(orgClaim)
      : null;

    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant resolution failed: host and token do not agree');
    }

    setTenantContext(hostTenant.id);
    (req as any).tenant = hostTenant;

    next();
  }
}
```

### src/tenant/tenant.module.ts
```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantService, TenantMiddleware],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

### src/tenant/tenant.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByDomain(domain: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { domain },
    });
  }

  async resolveByOrg(org: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { org },
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}
```

### src/database/database.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/customers/customers.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Post()
  async create(@Body() data: CreateCustomerDto) {
    return this.customersService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdateCustomerDto) {
    return this.customersService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.customersService.delete(id);
  }
}
```

### src/customers/customers.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository, CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
```

### src/customers/customers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './customers.dto.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.customer.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.customer.findFirst({
      where: { id },
    });
  }

  create(data: CreateCustomerDto) {
    return this.prisma.prisma.customer.create({ data });
  }

  update(id: string, data: UpdateCustomerDto) {
    return this.prisma.prisma.customer.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.prisma.customer.delete({
      where: { id },
    });
  }
}
```

### src/customers/customers.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async create(data: CreateCustomerDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateCustomerDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }
}
```

### src/plans/plans.controller.ts
```ts
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.plansService.findById(id);
  }

  @Post()
  async create(@Body() data: CreatePlanDto) {
    return this.plansService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdatePlanDto) {
    return this.plansService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.plansService.delete(id);
  }
}
```

### src/plans/plans.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [PlansRepository, PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule {}
```

### src/plans/plans.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.plan.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.plan.findFirst({ where: { id } });
  }

  create(data: CreatePlanDto) {
    return this.prisma.prisma.plan.create({ data });
  }

  update(id: string, data: UpdatePlanDto) {
    return this.prisma.prisma.plan.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.prisma.plan.delete({ where: { id } });
  }
}
```

### src/plans/plans.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PlansRepository } from './plans.repository.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Injectable()
export class PlansService {
  constructor(private readonly repository: PlansRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const plan = await this.repository.findById(id);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  async create(data: CreatePlanDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdatePlanDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }
}
```

### src/tenant-config/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.tenantConfigService.getConfig();
  }
}
```

### src/tenant-config/tenant-config.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfigController } from './tenant-config.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantConfigService],
  controllers: [TenantConfigController],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}
```

### src/tenant-config/tenant-config.service.ts
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new NotFoundException('No tenant context');
    }

    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      name: tenant.name,
      domain: tenant.domain,
      branding: tenant.branding,
      flags: tenant.flags,
    };
  }
}
```
