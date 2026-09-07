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
