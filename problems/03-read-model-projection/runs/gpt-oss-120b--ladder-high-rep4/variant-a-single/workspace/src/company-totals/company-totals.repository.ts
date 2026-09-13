import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CompanyFinancialTotal } from '@prisma/client';

@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCompanyId(companyId: number): Promise<CompanyFinancialTotal | null> {
    return this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
  }
}
