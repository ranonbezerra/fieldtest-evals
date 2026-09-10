import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentOrder } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { ProjectionService } from '../projection/projection.service.js';
import { WorkersRepository } from '../workers/workers.repository.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repository: PaymentOrdersRepository,
    private readonly workersRepository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; workerId: string; amountCents: number }): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const worker = await this.workersRepository.findById(tx, input.workerId);
      if (!worker) throw AppError.notFound('worker', input.workerId);

      const order = await this.repository.create(tx, input);

      // The hook runs inside the write's transaction: the dashboard sees the
      // new order exactly when this transaction commits (read-your-own-writes).
      await this.projection.onOrderCreated(tx, order);
      return order;
    });
  }

  setStatus(id: string, status: OrderStatus): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const order = await this.repository.findById(tx, id);
      if (!order) throw AppError.notFound('payment order', id);
      if (order.status === status) return order; // idempotent no-op

      const updated = await this.repository.updateStatus(tx, id, status);
      await this.projection.onOrderStatusChanged(tx, updated, order.status);
      return updated;
    });
  }
}
