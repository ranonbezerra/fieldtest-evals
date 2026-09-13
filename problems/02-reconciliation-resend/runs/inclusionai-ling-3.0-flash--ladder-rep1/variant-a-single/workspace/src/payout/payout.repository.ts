import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PayoutStatus } from "./payout.types";
import { deriveTxid } from "./payout.utils";

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    orderRef: string;
    amount: number;
    key: string;
    effectiveDate: Date;
  }): Promise<{
    id: string;
    orderRef: string;
    txid: string;
    amount: number;
    status: string;
    effectiveDate: Date;
    key: string;
    attemptCount: number;
    bankReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const txid = deriveTxid(data.orderRef, data.effectiveDate);
    return this.prisma.payout.create({
      data: {
        orderRef: data.orderRef,
        txid,
        amount: data.amount,
        key: data.key,
        effectiveDate: data.effectiveDate,
        status: PayoutStatus.PENDING,
        attemptCount: 0,
      },
    });
  }

  async findPending(): Promise<
    {
      id: string;
      orderRef: string;
      txid: string;
      amount: number;
      status: string;
      effectiveDate: Date;
      key: string;
      attemptCount: number;
      bankReference: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
    });
  }

  async findAwaitingSet(): Promise<
    {
      id: string;
      orderRef: string;
      txid: string;
      amount: number;
      status: string;
      effectiveDate: Date;
      key: string;
      attemptCount: number;
      bankReference: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.AWAITING_SET },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    data: { attemptCount?: number; bankReference?: string | null },
  ): Promise<void> {
    const updateData: Record<string, unknown> = { status, ...data };
    await this.prisma.payout.update({ where: { id }, data: updateData });
  }
}
