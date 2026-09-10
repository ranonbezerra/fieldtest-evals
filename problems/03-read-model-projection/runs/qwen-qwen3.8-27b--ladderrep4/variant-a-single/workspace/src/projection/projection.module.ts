import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../common/prisma.module.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';
import { ProjectionController } from './projection.controller.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [ProjectionController],
  providers: [ProjectionRepository, ProjectionService],
  exports: [ProjectionRepository],
})
export class ProjectionModule {}
