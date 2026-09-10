import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { DriftRepairScheduler } from './drift-repair-scheduler.service.js';
import { DriftRepairService } from './drift-repair.service.js';
import { OperationTotalsController } from './operation-totals.controller.js';
import { OrderWritesController } from './order-writes.controller.js';
import { OrderWritesRepository } from './order-writes.repository.js';
import { OrderWritesService } from './order-writes.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';
import { ProjectionMaintenanceRepository } from './projection-maintenance.repository.js';
import { ProjectionMaintenanceService } from './projection-maintenance.service.js';
import { RederivationController } from './rederivation.controller.js';
import { RederivationRepository } from './rederivation.repository.js';
import { RederivationService } from './rederivation.service.js';

@Module({
  imports: [CommonModule],
  controllers: [
    OperationsController,
    OperationTotalsController,
    OrderWritesController,
    RederivationController,
  ],
  providers: [
    OperationsService,
    OperationsRepository,
    OrderWritesService,
    OrderWritesRepository,
    ProjectionMaintenanceService,
    ProjectionMaintenanceRepository,
    RederivationService,
    RederivationRepository,
    DriftRepairService,
    DriftRepairScheduler,
  ],
})
export class OperationsModule {}
