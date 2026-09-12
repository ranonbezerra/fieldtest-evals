import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DriftRepairModule } from '../drift-repair/drift-repair.module.js';

@Module({
  imports: [OrdersModule, DriftRepairModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService],
})
export class OperationsModule {}
