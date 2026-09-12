import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlanController } from './plan.controller.js';
import { PlanRepository } from './plan.repository.js';
import { PlanService } from './plan.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository],
  exports: [PlanRepository],
})
export class PlanModule {}
