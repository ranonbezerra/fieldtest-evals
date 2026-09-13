import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { PrismaModule } from '../prisma.module.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, CompanyTotalsRepository],
  exports: [OperationsService],
})
export class OperationsModule {}
