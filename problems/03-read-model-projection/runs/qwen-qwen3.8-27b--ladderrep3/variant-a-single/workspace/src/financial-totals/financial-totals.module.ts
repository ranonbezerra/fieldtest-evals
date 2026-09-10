import { Module } from '@nestjs/common';
import { FinancialTotalsController } from './financial-totals.controller.js';
import { FinancialTotalsService } from './financial-totals.service.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Module({
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
})
export class FinancialTotalsModule {}
