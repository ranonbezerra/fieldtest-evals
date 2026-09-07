# repair1-tenant-config.controller.ts

## reasoning

```
We need to write controller fixing imports. Likely need to import Controller, Get, etc. Use TenantConfigService path. Provide simple endpoint. Assume service exists. Write class with GET. Use NestJS. Provide proper import paths. Also need to import Request maybe. We'll just implement.
```

## reply

```ts
// src/tenant-config/tenant-config.controller.ts

import { Controller, Get, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { TenantConfigService } from './tenant-config.service';

// ASSUMPTION: TenantConfigService has a method `getConfig(tenantId: string)`
// that returns the branding and feature‑flags for the resolved tenant.
// The tenant identifier is expected to be available on the request object
// (e.g., via a request‑scoped context populated by the tenant middleware).

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getTenantConfig(@Req() req: Request) {
    const tenantId = (req as any).tenantId; // populated by TenantContext middleware

    if (!tenantId) {
      // If the tenant could not be resolved, respond with a 400 error.
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_resolved',
            message: 'Tenant could not be resolved from the request.',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const config = await this.tenantConfigService.getConfig(tenantId);
      return config;
    } catch (err) {
      // Propagate unexpected errors as internal server errors,
      // preserving the error envelope contract.
      throw new HttpException(
        {
          error: {
            code: 'internal_error',
            message: 'Failed to retrieve tenant configuration.',
            details: { originalError: err instanceof Error ? err.message : err },
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
```
