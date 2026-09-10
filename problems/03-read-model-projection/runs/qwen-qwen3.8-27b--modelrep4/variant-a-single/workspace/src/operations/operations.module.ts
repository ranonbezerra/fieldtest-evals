import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsDriftRepairJob } from './operations-drift-repair.job.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, OperationsDriftRepairJob],
})
export class OperationsModule {}
