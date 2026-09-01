// ASSUMPTION: The modules './bank-client.interface' and './payment.repository' do not exist on disk;
// their types are inlined here per the PLAN.md contract so this file compiles standalone.

import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

// ─── Bank client types ────────────────────────────────────────────────────────

export interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string;
}

export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

export interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

export interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

// ─── Repository interface ─────────────────────────────────────────────────────

export interface PaymentRepository {
  findPending(limit: number): Promise<OrderRecord[]>;
  findByTxid(txid: string): Promise<OrderRecord | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>;

  markSent(id: string, lastAttemptAt: Date): Promise<void>;
  markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
  markRejected(id: string): Promise<void>;
  /** Returns true if the conditional update actually changed a row. */
  markSettled(id: string, settledAt: Date): Promise<boolean>;
  /** Returns true if the conditional update actually changed a row. */
  markPendingForResend(id: string): Promise<boolean>;
  markParked(id: string): Promise<void>;
  /** Returns the new attempt count, or 0 if another worker won the race. */
  incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>;

  upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentService {
  private readonly publishingLagMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    config?: { publishingLagMs?: number; batchSize?: number; maxAttempts?: number },
  ) {
    this.publishingLagMs = config?.publishingLagMs ?? 30 * 60 * 1000;
    this.batchSize = config?.batchSize ?? 100;
    this.maxAttempts = config?.maxAttempts ?? 5;
  }

  deriveTxid(orderId: string, effectiveDate: Date): string {
    const input = `${orderId}|${effectiveDate.toISOString()}`;
    return createHash('sha256').update(input).digest('hex');
  }

  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      const now = new Date();
      const newCount = await this.repo.incrementAttempt(order.id, now);
      if (newCount === 0) {
        continue; // another worker won the race
      }

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
      } catch {
        // Timeout or network-level failure — treat as in_doubt
        await this.repo.markInDoubt(order.id, new Date());
      }
    }
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);

    for (const date of dates) {
      const statement = await this.bank.getStatement(date);
      const statementTxids = new Set(statement.map((s) => s.txid));

      // Match settlements to orders
      for (const settlement of statement) {
        const order = await this.repo.findByTxid(settlement.txid);
        if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
          const updated = await this.repo.markSettled(order.id, settlement.settled_at);
          if (updated) {
            settled++;
            await this.repo.upsertSettlement({
              txid: settlement.txid,
              amount_minor_units: settlement.amount_minor_units,
              settled_at: settlement.settled_at,
              statement_date: date,
            });
          }
        }
      }

      // Proven-absent check: the statement for this date is complete once
      // now > endOfDay(date) + publishingLagMs
      const endOfDay = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
      );
      const statementCompleteAt = endOfDay.getTime() + this.publishingLagMs;

      if (Date.now() > statementCompleteAt) {
        const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
        for (const order of inDoubtOrders) {
          if (!statementTxids.has(order.txid)) {
            const updated = await this.repo.markPendingForResend(order.id);
            if (updated) {
              provenAbsent++;
            }
          }
        }
      }
    }

    return { settled, provenAbsent };
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    while (current <= last) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }
}
