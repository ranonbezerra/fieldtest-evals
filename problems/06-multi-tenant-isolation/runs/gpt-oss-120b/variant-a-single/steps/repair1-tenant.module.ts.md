# repair1-tenant.module.ts

## reasoning

```
We need to write tenant.module.ts that imports needed things and exports. Errors: cannot find './tenant.context' and './tenant.middleware'. So we must create proper imports assuming those files exist. Probably path is src/tenant/tenant.context.ts and tenant.middleware.ts. We'll import TenantContext, TenantMiddleware, and provide them. Also need to import Module from @nestjs/common. Export TenantContext for other modules.

Write:

import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantMiddleware } from './tenant.middleware';

@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

Assume TenantContext is injectable and request-scoped? Might need scope, but not required.

Return that.
```

## reply

```ts
// src/tenant/tenant.module.ts

import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantMiddleware } from './tenant.middleware';

@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```
