import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Module({
  imports: [PrismaModule],
  providers: [CompanyTotalsRepository, CompanyTotalsService],
  exports: [CompanyTotalsRepository, CompanyTotalsService],
})
export class CompanyTotalsModule {}
