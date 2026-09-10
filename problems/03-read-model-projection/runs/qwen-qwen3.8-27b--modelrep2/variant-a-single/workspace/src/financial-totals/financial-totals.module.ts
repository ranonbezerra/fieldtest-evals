import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FinancialTotalsController } from './financial-totals.controller.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
  exports: [FinancialTotalsRepository, FinancialTotalsService],
})
export class FinancialTotalsModule {}
