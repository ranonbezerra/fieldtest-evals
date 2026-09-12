import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanRepository } from './plan.repository.js';
import { PlanService } from './plan.service.js';

@Module({
  imports: [PrismaModule],
  providers: [PlanService, PlanRepository],
  exports: [PlanService],
})
export class PlanModule {}
