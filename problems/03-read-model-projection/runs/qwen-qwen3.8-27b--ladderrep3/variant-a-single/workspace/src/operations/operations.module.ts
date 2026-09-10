import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
