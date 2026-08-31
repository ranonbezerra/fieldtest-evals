import { Module, NestModule } from '@nestjs/common';

import { DriftRepairProcessor } from './drift-repair.processor';
import { OperationReadModelRepository } from './operation-read-model.repository';
import { OperationReadModelService } from './operation-read-model.service';
import { OperationsController } from './operations.controller';

@Module({
  controllers: [OperationsController],
  providers: [OperationReadModelService, OperationReadModelRepository, DriftRepairProcessor],
  exports: [OperationReadModelService],
})
export class OperationsModule implements NestModule {}
