import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DriftRepairService } from './drift-repair.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionRepository, ProjectionService, DriftRepairService],
  exports: [ProjectionService],
})
export class OperationsModule {}
