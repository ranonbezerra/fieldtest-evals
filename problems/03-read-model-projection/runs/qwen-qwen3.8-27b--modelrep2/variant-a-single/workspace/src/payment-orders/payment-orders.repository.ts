import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePaymentOrderInput {
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
}

export interface PaymentOrderWithWorker {
  id: string;
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  workerName: string;
  workerCompanyId: string;
}

export interface StatusChangeResult {
  order: PaymentOrderWithWorker;
  /** null when the order was already in the requested status (no-op). */
  previousStatus: OrderStatus | null;
}

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([OrderStatus.VOID, OrderStatus.REFUNDED]);

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
  }

  async createInTx(tx: Prisma.TransactionClient, input: CreatePaymentOrderInput): Promise<PaymentOrderWithWorker> {
    const order = await tx.paymentOrder.create({
      data: {
        companyId: input.companyId,
        workerId: input.workerId,
        amount: input.amount,
        currency: input.currency,
      },
      include: { worker: { select: { name: true, companyId: true } } },
    });
    return toRow(order);
  }

  async changeStatusInTx(tx: Prisma.TransactionClient, id: string, toStatus: OrderStatus): Promise<StatusChangeResult> {
    const current = await tx.paymentOrder.findUnique({
      where: { id },
      include: { worker: { select: { name: true, companyId: true } } },
    });
    if (!current) {
      throw new ApiError('resource_not_found', `Payment order ${id} was not found.`, 404, { id });
    }
    if (current.status === toStatus) {
      return { order: toRow(current), previousStatus: null };
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new ApiError(
        'invalid_status_transition',
        `Payment order ${id} is ${current.status}; it cannot move to ${toStatus}.`,
        409,
        { id, from: current.status, to: toStatus },
      );
    }
    const updated = await tx.paymentOrder.update({ where: { id }, data: { status: toStatus } });
    return { order: toRow({ ...updated, worker: current.worker }), previousStatus: current.status };
  }
}

function toRow(order: {
  id: string;
  companyId: string;
  workerId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  worker: { name: string; companyId: string };
}): PaymentOrderWithWorker {
  return {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    workerName: order.worker.name,
    workerCompanyId: order.worker.companyId,
  };
}
