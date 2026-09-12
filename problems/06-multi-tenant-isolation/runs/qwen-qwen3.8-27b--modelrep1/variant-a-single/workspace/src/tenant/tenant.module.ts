import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantController } from './tenant.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantsRepository } from './tenant.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantService, TenantsRepository],
  exports: [TenantsRepository],
})
export class TenantModule {}
