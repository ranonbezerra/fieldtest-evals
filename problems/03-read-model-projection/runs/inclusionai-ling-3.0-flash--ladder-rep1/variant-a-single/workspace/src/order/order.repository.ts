import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PrismaClient } from '@prisma/client';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    tx: PrismaClient | undefined,
    data: { companyId: string; workerId: string; amount: bigint | number | string; status?: string },
  ) {
    const client = tx ?? this.prisma;
    return client.paymentOrder.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        amount: data.amount.toString(),
        status: data.status ?? 'pending',
      },
    });
  }

  async findById(tx: PrismaClient | undefined, id: string) {
    const client = tx ?? this.prisma;
    return client.paymentOrder.findUnique({
      where: { id },
      include: { company: true, worker: true },
    });
  }

  async updateStatus(tx: PrismaClient, id: string, status: string) {
    return tx.paymentOrder.update({
      where: { id, status: 'pending' },
      data: { status, updatedAt: new Date() },
    });
  }
}
