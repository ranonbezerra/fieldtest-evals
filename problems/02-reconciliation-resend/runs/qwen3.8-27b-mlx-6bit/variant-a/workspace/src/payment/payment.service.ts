import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankPermanentError, type BankClient, type Settlement } from './bank-client.interface';
import type { PaymentRepository, OrderRecord } from './payment.repository';

export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    private readonly opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  ) {}

  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex');
  }

  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.opts.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.opts.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      const newCount = await this.repo.incrementAttempt(order.id, new Date());
      if (newCount === 0) continue;

      try {
        const response = await this.bank.send({
          txid: order.txid,
          amount_minor_units: order.amount_minor_units,
          key: order.supplier_key,
        });

        switch (response.status) {
          case 'accepted':
          case 'duplicate':
            await this.repo.markSent(order.id, new Date());
            break;
          case 'transient_error':
            await this.repo.markInDoubt(order.id, new Date());
            break;
          case 'permanent_rejection':
            await this.repo.markRejected(order.id);
            break;
        }
      } catch (err: unknown) {
        if (err instanceof BankPermanentError) {
          await this.repo.markRejected(order.id);
        } else {
          // Timeout or transient failure — treat as in_doubt
          await this.repo.markInDoubt(order.id, new Date());
        }
      }
    }
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);

    for (const date of dates) {
      const statement: Settlement[] = await this.bank.getStatement(date);
      const statementTxids = new Set<string>(statement.map((s) => s.txid));

      // Match settlements to orders
      for (const settlement of statement) {
        const order = await this.repo.findByTxid(settlement.txid);
        if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
          await this.repo.markSettled(order.id, settlement.settled_at);
          await this.repo.upsertSettlement({
            txid: settlement.txid,
            amount_minor_units: settlement.amount_minor_units,
            settled_at: settlement.settled_at,
            statement_date: date,
          });
          settled++;
        }
      }

      // Proven-absent check: only after the publishing lag has elapsed for this date
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      const completeAfter = endOfDay.getTime() + this.opts.publishingLagMs;

      if (Date.now() > completeAfter) {
        const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
        for (const order of inDoubtOrders) {
          if (!statementTxids.has(order.txid)) {
            await this.repo.markPendingForResend(order.id);
            provenAbsent++;
          }
        }
      }
    }

    return { settled, provenAbsent };
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

    while (current.getTime() <= endDay) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
}
