import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankGateway, BankSendResponse, SendOutcome } from '../bank/bank.types';
import { PayoutRepository } from './payout.repository';
import {
  PayoutRecord,
  PayoutStatus,
  CreatePayoutInput,
  ReconcileWindow,
  ReconcileResult,
} from './payout.types';

export const PUBLISHING_LAG_MINUTES = 30;
export const MAX_SEND_ATTEMPTS = 5;

function deriveTxid(orderRef: string, effectiveDate: string): string {
  return createHash('sha256').update(`${orderRef}:${effectiveDate}`).digest('hex');
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    @Inject(BankGateway) private readonly bankGateway: BankGateway,
  ) {}

  async getPayout(id: string): Promise<PayoutRecord | null> {
    return this.repo.findById(id);
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutRecord> {
    const txid = deriveTxid(input.orderRef, input.effectiveDate);
    const existing = await this.repo.findByOrderRef(input.orderRef);
    if (existing) {
      throw new Error(`Order ${input.orderRef} already exists`);
    }
    return this.repo.create({
      orderRef: input.orderRef,
      effectiveDate: input.effectiveDate,
      amount: input.amount,
      txid,
      bankKey: input.bankKey,
    });
  }

  async executePayments(): Promise<Array<{ payoutId: string; outcome: string; txid: string }>> {
    const pending = await this.repo.findPending();
    const results: Array<{ payoutId: string; outcome: string; txid: string }> = [];

    for (const payout of pending) {
      const response = await this.bankGateway.send({
        txid: payout.txid,
        amount: payout.amount,
        key: payout.bankKey,
      });

      await this.handleSendResponse(payout, response);
      results.push({ payoutId: payout.id, outcome: response.outcome, txid: payout.txid });
    }

    return results;
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      settled: [],
      resent: [],
      parked: [],
      skipped: [],
    };

    const payouts = await this.repo.findAwaitingEvidenceInRange(window.start, window.end);

    for (const payout of payouts) {
      if (
        payout.status === PayoutStatus.SETTLED ||
        payout.status === PayoutStatus.PARKED_FOR_REVIEW ||
        payout.status === PayoutStatus.REJECTED
      ) {
        result.skipped.push(payout.id);
        continue;
      }

      const statementTxids = new Set<string>();
      const currentDate = new Date(window.start);
      while (currentDate <= window.end) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const settlements = await this.bankGateway.getStatement(dateStr);
        for (const settlement of settlements) {
          statementTxids.add(settlement.txid);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (statementTxids.has(payout.txid)) {
        await this.repo.markSettled(payout.id);
        result.settled.push(payout.id);
      } else if (this.isPastPublishingLag(payout.lastAttemptAt)) {
        if (payout.sendAttempts >= MAX_SEND_ATTEMPTS) {
          await this.repo.parkForReview(payout.id);
          result.parked.push(payout.id);
        } else {
          const response = await this.bankGateway.send({
            txid: payout.txid,
            amount: payout.amount,
            key: payout.bankKey,
          });
          await this.handleSendResponse(payout, response);
          result.resent.push({
            payoutId: payout.id,
            txid: payout.txid,
            outcome: response.outcome,
          });
        }
      }
    }

    return result;
  }

  private async handleSendResponse(
    payout: PayoutRecord,
    response: BankSendResponse,
  ): Promise<void> {
    switch (response.outcome) {
      case SendOutcome.ACCEPTED: {
        await this.repo.markSent(
          payout.id,
          payout.txid,
          response.outcome,
          response.code ?? null,
          response.message ?? null,
        );
        break;
      }
      case SendOutcome.DUPLICATE: {
        await this.repo.markSettled(payout.id);
        break;
      }
      case SendOutcome.TRANSIENT_ERROR: {
        await this.repo.markSent(
          payout.id,
          payout.txid,
          response.outcome,
          response.code ?? null,
          response.message ?? null,
        );
        break;
      }
      case SendOutcome.PERMANENT_REJECTION: {
        await this.repo.markRejected(
          payout.id,
          response.outcome,
          response.code ?? null,
          response.message ?? null,
        );
        break;
      }
      default: {
        throw new Error(`Unknown send outcome: ${(response as any).outcome}`);
      }
    }
  }

  private isPastPublishingLag(lastAttemptAt: Date | null): boolean {
    if (!lastAttemptAt) return false;
    const lagMs = PUBLISHING_LAG_MINUTES * 60 * 1000;
    return Date.now() - lastAttemptAt.getTime() > lagMs;
  }
}
