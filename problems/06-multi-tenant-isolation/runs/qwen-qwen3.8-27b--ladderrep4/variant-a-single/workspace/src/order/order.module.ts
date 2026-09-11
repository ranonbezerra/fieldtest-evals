import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';

@Module({
  imports: [TenantModule],
})
export class OrderModule {}
