# repair2-tenant-config.controller.ts

## reasoning

```
We need to write controller fixing imports: use NestJS, not express directly. Likely need to import Controller, Get, Req, Res, HttpException. Use Request from express types but need to install @types/express? but just import from 'express'. Compiler error says cannot find module 'express' types. We can avoid importing express types, use any or Nest's Request from '@nestjs/common'. Actually Nest provides Request from 'express' type, but same error. To avoid, we can not import express types, use any for request. Also need import TenantConfigService. Path correct. Provide route GET /tenant-config returning service.getConfig(). Use proper decorator.

Let's write:

import { Controller, Get, Req, HttpException, HttpStatus } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig(@Req() req: any) {
    // assume tenant resolved and stored in request, e.g., req.tenantId
    const tenantId = req?.tenantId;
    if (!tenantId) {
      throw new HttpException('Tenant not resolved', HttpStatus.BAD_REQUEST);
    }
    const config = await this.tenantConfigService.getConfig(tenantId);
    return { data: config };
  }
}

That avoids express import. Ensure service method signature unknown but assume getConfig(tenantId). This should compile.
```

## reply

```ts
// src/tenant-config/tenant-config.controller.ts

import { Controller, Get, Req, HttpException, HttpStatus } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

// ASSUMPTION: The tenant middleware stores the resolved tenant identifier on the
// request object under the `tenantId` property. The service exposes a method
// `getConfig(tenantId: string)` that returns the tenant's branding and feature
// flags.

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig(@Req() req: any) {
    const tenantId: string | undefined = req?.tenantId;

    if (!tenantId) {
      // No tenant resolved – this should not happen if the middleware is
      // correctly applied, but we guard against it.
      throw new HttpException(
        { error: { code: 'tenant_not_resolved', message: 'Tenant could not be resolved', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const config = await this.tenantConfigService.getConfig(tenantId);
    return { data: config };
  }
}
```
