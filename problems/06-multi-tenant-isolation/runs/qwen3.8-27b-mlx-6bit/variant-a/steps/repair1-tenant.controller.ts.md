# repair1-tenant.controller.ts

## reasoning

```
Let me analyze the compiler errors that affect `src/tenant/tenant.controller.ts`:

```
src/tenant/tenant.controller.ts(2,48): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
```

This is the only error in `src/tenant/tenant.controller.ts`. The issue is that with `moduleResolution: node16` or `nodenext`, relative imports need explicit file extensions. So `./tenant.service` should be `./tenant.service.js`.

Let me also look at what the plan says about this file:

```ts
src/tenant/tenant.controller.ts
```ts
export class TenantController {
  constructor(service: TenantService);
  @Get('tenant-config') getConfig(): Promise<TenantConfigDto>;
}
```

So the file imports `TenantService` and `TenantConfigDto` from `./tenant.service`, and uses `@Controller` and `@Get` from `@nestjs/common`.

The fix is simple: change the relative import to include `.js` extension.

Let me write the complete file:

```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService, TenantConfigDto } from './tenant.service.js';

@Controller()
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto> {
    return this.service.getConfig();
  }
}
```

Wait, let me check the error message more carefully:

```
src/tenant/tenant.controller.ts(2,48): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
```

Line 2, column 48. The module path `./tenant.service` is at column 48. This is a relative import that needs `.js` extension under `moduleResolution: node16`.

The only error in this file is that one. So I just need to fix the import path from `./tenant.service` to `./tenant.service.js`.

The controller uses `@Controller()` and `@Get('tenant-config')` - these come from `@nestjs/common` which is a package import (not relative), so no extension needed there.

Let me write the complete file.
```

## reply

```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService, TenantConfigDto } from './tenant.service.js';

@Controller()
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto> {
    return this.service.getConfig();
  }
}
```
