import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(
    companyId: string,
    status: string | undefined,
    createdFrom: Date | undefined,
    createdTo: Date | undefined,
    page: number,
    pageSize: number,
  ) {
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.orderDashboard.findMany({
        where: {
          companyId,
          ...(status && { status }),
          ...(createdFrom && { createdAt: { gte: createdFrom } }),
          ...(createdTo && { createdAt: { lte: createdTo } }),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.orderDashboard.count({
        where: {
          companyId,
          ...(status && { status }),
          ...(createdFrom && { createdAt: { gte: createdFrom } }),
          ...(createdTo && { createdAt: { lte: createdTo } }),
        },
      }),
    ]);

    return { data, total };
  }

  async findCompanyTotals(companyId: string) {
    return this.prisma.companyFinancialTotals.findUnique({
      where: { companyId },
    });
  }
}
