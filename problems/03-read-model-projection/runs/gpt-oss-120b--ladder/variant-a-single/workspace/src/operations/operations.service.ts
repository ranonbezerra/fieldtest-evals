import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { OperationsRepository } from './operations.repository.js';
import { QueryOperationsDto } from './dto/query-operations.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OperationsRepository,
  ) {}

  /**
   * Approve an order – this is a **write path** that must also update the
   * projection inside the same transaction so that the operator sees the change
   * immediately.
   */
  async approveOrder(orderId: number, operatorId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1️⃣ fetch the order (need companyId & amount for totals)
      const order = await tx.paymentOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { companyId: true, amount: true, status: true },
      });

      if (order.status === 'approved') {
        // already approved – nothing to do
        return;
      }

      // 2️⃣ update source row
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: 'approved' },
      });

      // 3️⃣ projection maintenance (sync hook)
      await this.repo.upsertProjection(orderId, tx);

      // 4️⃣ atomic totals increment
      await this.repo.incrementCompanyTotals(
        order.companyId,
        order.amount,
        tx,
      );
    });
  }

  /**
   * Dashboard query – reads only from the projection table.
   */
  async queryDashboard(dto: QueryOperationsDto) {
    const { companyId, status, startDate, endDate, page, size } = dto;

    const where: Prisma.OperationProjectionWhereInput = {};

    if (companyId !== undefined) where.companyId = companyId;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [total, rows] = await Promise.all([
      this.prisma.operationProjection.count({ where }),
      this.prisma.operationProjection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
    ]);

    return {
      total,
      page,
      size,
      rows,
    };
  }
}
