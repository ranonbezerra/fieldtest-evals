import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CompanyTotalsController } from './company-totals.controller.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Module({
  controllers: [CompanyTotalsController],
  providers: [CompanyTotalsService, CompanyTotalsRepository],
  imports: [CommonModule],
  exports: [CompanyTotalsRepository],
})
export class CompanyTotalsModule {}
