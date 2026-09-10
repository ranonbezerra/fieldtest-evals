import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  imports: [CommonModule],
  exports: [OperationsRepository],
})
export class OperationsModule {}
