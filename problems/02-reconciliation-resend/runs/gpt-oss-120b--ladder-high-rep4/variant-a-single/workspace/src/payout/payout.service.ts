import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { Payout, PayoutState } from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  async createPayout(supplierKey: string, amount: number, effectiveDate: Date): Promise<Payout> {
    return this.payoutRepository.create({
      supplier_key: supplierKey,
      amount,
      effective_date: effectiveDate,
    });
  }

  async getPayoutById(id: number): Promise<Payout | null> {
    return this.payoutRepository.findById(id);
  }

  private deriveTxId(payout: Payout): string {
    const data = `${payout.id}|${payout.supplier_key}|${payout.amount}|${payout.effective_date.toISOString()}`;
    return createHash('sha256').update(data).digest('hex');
  }

  async executePayments(): Promise<void> {
    const pendingPayouts = await this.payoutRepository.findPending();
    for (const payout of pendingPayouts) {
      const txid = this.deriveTxId(payout);
      try {
        const result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplier_key,
        });
        await this.handleBankSendResult(payout, result);
      } catch (err) {
        this.logger.error(`Bank send threw an unexpected error for payout ${payout.id}`, err);
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.awaiting_evidence,
          attempts: { increment: 1 },
          last_attempt_at: new Date(),
          txid,
        });
      }
    }
  }

  private async handleBankSendResult(payout: Payout, result: BankSendResult): Promise<void> {
    const now = new Date();
    const txid = this.deriveTxId(payout);
    switch (result) {
      case BankSendResult.ACCEPTED:
      case BankSendResult.DUPLICATE:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.sent,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      case BankSendResult.TRANSIENT_ERROR:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.awaiting_evidence,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      case BankSendResult.PERMANENT_REJECTION:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.failed,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      default:
        this.logger.warn(`Unhandled bank send result ${result} for payout ${payout.id}`);
        break;
    }
  }

  async reconcile(window: { from: Date; to: Date }): Promise<void> {
    const settlements = await this.bankService.getStatement(window.from, window.to);
    const settlementMap = new Map<string, Settlement>();
    for (const s of settlements) {
      settlementMap.set(s.txid, s);
    }

    const now = new Date();

    const payouts = await this.payoutRepository.findByEffectiveDateRange(window.from, window.to);
    for (const payout of payouts) {
      if (payout.state === PayoutState.settled) {
        continue;
      }

      const txid = payout.txid ?? this.deriveTxId(payout);
      const settlement = settlementMap.get(txid);

      if (settlement) {
        await this.payoutRepository.updateState(payout.id, PayoutState.settled);
        continue;
      }

      if (payout.state === PayoutState.sent) {
        continue; // waiting for publishing lag
      }

      if (payout.state === PayoutState.awaiting_evidence) {
        const lastAttemptAt = payout.last_attempt_at;
        if (!lastAttemptAt) {
          continue;
        }
        if (now.getTime() - lastAttemptAt.getTime() < PayoutService.PUBLISHING_LAG_MS) {
          continue; // still within lag window
        }

        if (payout.attempts >= 5) {
          await this.payoutRepository.updateState(payout.id, PayoutState.parked);
        } else {
          try {
            const result = await this.bankService.send({
              txid,
              amount: payout.amount,
              key: payout.supplier_key,
            });
            await this.handleBankSendResult(payout, result);
          } catch (err) {
            this.logger.error(`Bank send error during resend for payout ${payout.id}`, err);
            await this.payoutRepository.updateStateAndAttempt(payout.id, {
              state: PayoutState.awaiting_evidence,
              attempts: { increment: 1 },
              last_attempt_at: now,
              txid,
            });
          }
        }
      }
    }
  }
}
