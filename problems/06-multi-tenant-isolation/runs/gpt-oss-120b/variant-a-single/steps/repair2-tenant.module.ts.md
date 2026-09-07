# repair2-tenant.module.ts

## reasoning

```
We need to write tenant.module.ts that imports needed things. Errors indicate missing imports: tenant.context, tenant.middleware. Likely they exist but path maybe wrong. We just create module that provides TenantContext and TenantMiddleware, and exports TenantContext? Provide correct imports.

We don't have actual files, but we can assume they exist at ./tenant.context.ts and ./tenant.middleware.ts. Also need Module from @nestjs/common. So:

import { Module, Global } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantMiddleware } from './tenant.middleware';

@Module({
  providers: [TenantContext, TenantMiddleware],
  exports: [TenantContext],
})
export class TenantModule {}

But middleware should be applied globally via configure? Usually need to implement NestModule. Could also export middleware. But compile errors only about missing imports. So this file should compile.

Add @Global to allow injection anywhere. Also need to implement NestModule to apply middleware? Not required compile.

Thus output.
```

## reply

```ts
// src/tenant/tenant.module.ts

import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantMiddleware } from './tenant.middleware';

@Global()
@Module({
  providers: [TenantContext, TenantMiddleware],
  exports: [TenantContext],
})
export class TenantModule {}
```
