import { Module } from '@nestjs/common';
import { FinancialTotalsModule } from '../financial-totals/financial-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DriftRepairProcessor } from './drift-repair.processor.js';
import { DriftRepairRepository } from './drift-repair.repository.js';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  imports: [PrismaModule, OperationsModule, FinancialTotalsModule],
  providers: [DriftRepairRepository, DriftRepairService, DriftRepairProcessor],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
