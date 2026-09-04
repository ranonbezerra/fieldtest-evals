import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module.js';
import { TenantController } from './tenant.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantRepository } from './tenant.repository.js';

@Module({
  imports: [PrismaModule],
  providers: [TenantRepository, TenantService],
  controllers: [TenantController],
})
export class TenantModule {}
