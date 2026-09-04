# 16-tenant.controller.ts

## reasoning

```
Looking at the plan for `src/tenant/tenant.controller.ts`:

```ts
export class TenantController {
  constructor(service: TenantService);
  @Get('tenant-config') getConfig(): Promise<TenantConfigDto>;
}
```

The controller needs:
- Import `Controller`, `Get` from `@nestjs/common`
- Import `TenantService` and `TenantConfigDto` from `./tenant.service`
- A class `TenantController` with a constructor taking `TenantService`
- A `getConfig()` method decorated with `@Get('tenant-config')` that returns `Promise<TenantConfigDto>`

The plan specifies the endpoint is `GET /tenant-config`. The naming convention says endpoints are kebab-case, plural. But the plan explicitly says `@Get('tenant-config')` so I'll follow that.

The service is in `./tenant.service.ts` (same directory), so the import path is `./tenant.service`.

Let me write this file.
```

## reply

```typescript
import { Controller, Get } from '@nestjs/common';
import { TenantService, TenantConfigDto } from './tenant.service';

@Controller()
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto> {
    return this.service.getConfig();
  }
}
```
