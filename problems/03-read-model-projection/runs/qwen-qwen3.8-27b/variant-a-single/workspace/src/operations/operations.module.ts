import { Module } from '@nestjs/common';
import { DriftRepairProcessor } from './drift-repair.processor.js';
import { OperationsController } from './operations.controller.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { OperationsReconciliationService } from './operations-reconciliation.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    OperationsProjectionRepository,
    OperationsReconciliationService,
    DriftRepairProcessor,
  ],
  exports: [OperationsProjectionRepository],
})
export class OperationsModule {}
