import { Inject, Injectable } from '@nestjs/common';
import type { CompanyFinancialTotals } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class FinancialTotalsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByCompanyId(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }
}
