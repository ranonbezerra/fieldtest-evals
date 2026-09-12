import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsProjectionService } from './operations-projection.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { OperationsRebuilderService } from './operations-rebuilder.service.js';
import { OperationsDriftRepairService } from './operations-drift-repair.service.js';
import { OperationsScheduler } from './operations.scheduler.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    OperationsProjectionService,
    OperationsProjectionRepository,
    OperationsRebuilderService,
    OperationsDriftRepairService,
    OperationsScheduler,
  ],
  exports: [OperationsProjectionService],
})
export class OperationsModule {}
