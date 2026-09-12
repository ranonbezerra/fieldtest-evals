import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BankClient, PUBLISHING_LAG_MS, classifyBankSend } from './bank-client.types.js';
import { iterDays } from './date-window.js';
import type {
  ExecuteResult,
  Order,
  ReconcileResult,
  ReconcileWindow,
  SendResult,
} from './order.types.js';
import { PayoutRepository } from './payout.repository.js';

export interface PayoutConfig {
  maxAttempts: number;
  lagMs: number;
}

export interface PayoutClock {
  now(): number;
}

/**
 * The txid is derived deterministically from the order + effective date.
 * Every retry of the same order on the same effective date carries the same
 * txid, so the bank idempotency key (and reconciliation matching) is stable.
 */
export function deriveTxid(orderId: string, effectiveDate: string): string {
  return createHash('sha256').update(`${orderId}|${effectiveDate}`).digest('hex');
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    private readonly bank: BankClient,
    private readonly clock: PayoutClock,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Send every order the state machine currently allows: fresh PENDING
   * orders, and FAILED orders that reconciliation has proven absent from the
   * statement past the publishing lag (under the attempt cap).
   */
  async executePayments(): Promise<ExecuteResult> {
    const candidates = await this.repository.findSendableOrders(this.config.maxAttempts);
    let executed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const txid = deriveTxid(candidate.id, candidate.effectiveDate);
      const claim = await this.repository.claim(candidate.id, txid, new Date(this.clock.now()));
      if (!claim.ok) {
        skipped += 1;
        continue;
      }

      const res = await this.bank.send({
        txid,
        amountMinor: candidate.amountMinor,
        key: claim.order.supplierKey,
      });
      await this.applySendResult(claim.order, res);
      executed += 1;
    }

    return { executed, skipped };
  }

  /**
   * Match statement entries to orders and advance their state. Safe to run
   * over overlapping windows: every transition is guarded, one-way, and
   * idempotent, and nothing here touches attempts.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date(this.clock.now());
    const result: ReconcileResult = {
      scannedDays: 0,
      entries: 0,
      settled: 0,
      absentConfirmed: 0,
      parked: 0,
      mismatches: 0,
    };

    const candidates = await this.repository.findSettleCandidates();
    const byTxid = new Map<string, Order>();
    for (const order of candidates) {
      if (order.txid) byTxid.set(order.txid, order);
    }

    for (const date of iterDays(window.from, window.to)) {
      result.scannedDays += 1;
      const entries = await this.bank.getStatement(date);
      result.entries += entries.length;
      for (const entry of entries) {
        const order = byTxid.get(entry.txid);
        if (!order) continue;
        const amountMatches = entry.amountMinor === order.amountMinor;
        const count = amountMatches
          ? await this.repository.settleMatched(order.id)
          : await this.repository.parkForReview(
              order.id,
              `amount_mismatch order=${order.amountMinor} statement=${entry.amountMinor}`,
            );
        if (count > 0) {
          if (amountMatches) result.settled += 1;
          else result.mismatches += 1;
        }
      }
    }

    const cutoffMs = now.getTime() - this.config.lagMs;
    for (const order of candidates) {
      if (order.state === 'SETTLED') continue;
      if (!order.sentAt || order.sentAt.getTime() >= cutoffMs) continue;
      if (order.state === 'PENDING') {
        result.parked += await this.repository.failStalePending(order.id, 'send_timeout');
        continue;
      }
      if (order.state === 'FAILED') {
        if (order.attempts >= this.config.maxAttempts) {
          result.parked += await this.repository.parkForReview(
            order.id,
            `attempts_exhausted attempts=${order.attempts}`,
          );
        } else {
          result.absentConfirmed += await this.repository.confirmAbsent(order.id, now);
        }
      }
    }

    return result;
  }

  private async applySendResult(order: Order, res: Parameters<typeof classifyBankSend>[0]): Promise<void> {
    const kind = classifyBankSend(res);
    const detail =
      res.code ?? (typeof res.status === 'number' ? `http_${res.status}` : res.statusText) ?? 'unknown';

    if (kind === 'accepted' || kind === 'duplicate') {
      // Bank has the txid (now or from a prior attempt). Settlement is
      // confirmed by reconciliation, never assumed here.
      await this.repository.sendResult(order.id, 'success', kind === 'duplicate' ? `duplicate:${detail}` : null);
      return;
    }
    if (kind === 'permanent') {
      await this.repository.sendResult(order.id, 'permanent', `permanent:${detail}`);
      return;
    }
    await this.repository.sendResult(order.id, 'transient', `transient:${detail}`);
  }
}
