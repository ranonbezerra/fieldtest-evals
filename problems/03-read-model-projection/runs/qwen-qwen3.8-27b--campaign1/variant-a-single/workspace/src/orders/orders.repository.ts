import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// ASSUMPTION: @prisma/client has not been generated yet, so the Prisma namespace
// and OrderStatus enum are not importable. OrderStatus is defined locally to match
// the Prisma schema enum; remove this block and re-import once `prisma generate` runs.
export const OrderStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ASSUMPTION: PrismaService extends PrismaClient which is not yet generated;
  // casting to any to access generated model delegates and transaction methods.

  async createOrder(data: {
    companyId: string;
    eventId: string;
    workerId: string;
    amount: number;
    currency: string;
  }): Promise<{ id: string }> {
    return (this.prisma as any).paymentOrder.create({ data });
  }

  async approveOrder(
    orderId: string,
    companyId: string,
    onTransition: (tx: any) => Promise<void>,
  ): Promise<void> {
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: OrderStatus.APPROVED },
      });
      await onTransition(tx);
    });
  }

  async rejectOrder(
    orderId: string,
    companyId: string,
    onTransition: (tx: any) => Promise<void>,
  ): Promise<void> {
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: OrderStatus.REJECTED },
      });
      await onTransition(tx);
    });
  }
}
