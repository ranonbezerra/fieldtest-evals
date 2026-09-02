import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { BankClient, BankSettlement, BankSendResult } from './bank-client.js';
import type { PayoutsRepository } from './payouts.repository.js';

export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly repo: PayoutsRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }> {
    const orders = await this.repo.findPending(effectiveDate);
    let sent = 0;
    let rejected = 0;

    for (const order of orders) {
      const txid: string = order.txid ?? this.deriveTxid(order.id, effectiveDate);

      let result: BankSendResult;
      try {
        result = await this.bank.send({ txid, amountCents: order.amountCents, bankKey: order.bankKey });
      } catch {
        // Network error — treat as timeout; the payment may have landed.
        await this.repo.transition(order.id, 'PENDING', 'IN_FLIGHT', { txid, attempts: order.attempts + 1 });
        sent++;
        continue;
      }

      switch (result.kind) {
        case 'accepted':
        case 'duplicate':
          await this.repo.transition(order.id, 'PENDING', 'IN_FLIGHT', { txid, attempts: order.attempts + 1 });
          sent++;
          break;
        case 'transient':
          // No state change; attempts unchanged. Order remains eligible for retry.
          break;
        case 'permanent_rejection':
          await this.repo.transition(order.id, 'PENDING', 'REJECTED');
          rejected++;
          break;
      }
    }

    return { sent, rejected };
  }

  async reconcile(date: string): Promise<ReconcileResult> {
    const effectiveDate = new Date(`${date}T00:00:00.000Z`);
    const settlements: BankSettlement[] = await this.bank.getStatement(date);

    const statementMap = new Map<string, BankSettlement>();
    for (const s of settlements) {
      statementMap.set(s.txid, s);
    }

    let settled = 0;
    let provenAbsent = 0;
    let parked = 0;

    // Match phase: settle orders found in the statement.
    const inFlightOrders = await this.repo.findInFlight(effectiveDate);
    for (const order of inFlightOrders) {
      if (!order.txid) continue;
      const settlement: BankSettlement | undefined = statementMap.get(order.txid);
      if (!settlement) continue;

      if (settlement.amountCents !== order.amountCents) {
        // Amount mismatch — do not settle; requires manual investigation.
        continue;
      }

      const updated = await this.repo.transition(order.id, 'IN_FLIGHT', 'SETTLED');
      if (updated) settled++;
    }

    // Absence phase: for remaining IN_FLIGHT orders, check if we can prove absence.
    const remainingOrders = await this.repo.findInFlight(effectiveDate);
    for (const order of remainingOrders) {
      if (!this.isPastPublishingLag(effectiveDate)) continue;

      if (order.attempts >= 5) {
        const updated = await this.repo.transition(order.id, 'IN_FLIGHT', 'PARKED');
        if (updated) parked++;
      } else {
        const updated = await this.repo.transition(order.id, 'IN_FLIGHT', 'PENDING');
        if (updated) provenAbsent++;
      }
    }

    return { date, settled, provenAbsent, parked };
  }

  private deriveTxid(orderId: string, effectiveDate: Date): string {
    const input = `${orderId}:${effectiveDate.toISOString().slice(0, 10)}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  private isPastPublishingLag(effectiveDate: Date, now?: Date): boolean {
    const checkTime = now ?? new Date();
    const threshold = new Date(effectiveDate.getTime() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000);
    return checkTime.getTime() >= threshold.getTime();
  }
}
