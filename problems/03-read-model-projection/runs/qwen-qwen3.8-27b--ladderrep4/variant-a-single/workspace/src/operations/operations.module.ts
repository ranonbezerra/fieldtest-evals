import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';
import { OperationsController } from './operations.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
