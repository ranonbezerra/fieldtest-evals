import { Module } from '@nestjs/common';
import { MultiTenantModule } from '../multi-tenant/multi-tenant.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';
import { PlanRepository } from './plan.repository.js';

@Module({
  imports: [MultiTenantModule],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository],
})
export class PlanModule {}
