import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsDriftRepairService } from './operations.drift-repair.service.js';

@Module({
  imports: [ScheduleModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    OperationsDriftRepairService,
  ],
  exports: [OperationsRepository],
})
export class OperationsModule {}
