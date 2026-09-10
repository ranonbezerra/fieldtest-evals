import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
