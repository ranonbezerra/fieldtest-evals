import { Injectable, Logger } from "@nestjs/common";
import { PayoutRepository } from "./payout.repository";
import { BankService } from "../bank/bank.service";
import { PayoutStatus, SendOutcome } from "./payout.types";
import { deriveTxid } from "./payout.utils";
import { ReconcileWindow } from "../reconcile/reconcile.types";
import { BankSendResult, Settlement } from "../bank/bank.types";

const PUBLISHING_LAG_MS = 30 * 60 * 1000; // ~30 minutes
const MAX_ATTEMPTS = 5;

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  async executePayments(): Promise<void> {
    const payouts = await this.payoutRepository.findPending();
    for (const payout of payouts) {
      await this.sendPayout(payout, false);
    }
  }

  async reconcile(window: ReconcileWindow): Promise<void> {
    const payouts = await this.payoutRepository.findAwaitingSet();
    const statement = await this.bankService.getStatement(window.start, window.end);
    const statementTxids = new Set(statement.map((s: Settlement) => s.txid));

    for (const payout of payouts) {
      // Idempotency: skip anything already settled by a prior run.
      if (payout.status !== PayoutStatus.AWAITING_SET) {
        continue;
      }

      if (statementTxids.has(payout.txid)) {
        const entry = statement.find((s: Settlement) => s.txid === payout.txid);
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.SETTLED, {
          bankReference: entry?.reference ?? null,
        });
        continue;
      }

      const elapsed = Date.now() - new Date(payout.createdAt).getTime();
      if (elapsed >= PUBLISHING_LAG_MS) {
        if (payout.attemptCount >= MAX_ATTEMPTS) {
          await this.payoutRepository.updateStatus(payout.id, PayoutStatus.PARKED, {});
          this.logger.warn(
            `Payout ${payout.id} parked after ${MAX_ATTEMPTS} attempts — manual review required`,
          );
        } else {
          await this.resendPayout(payout);
        }
      }
    }
  }

  private async sendPayout(
    payout: {
      id: string;
      orderRef: string;
      txid: string;
      amount: number;
      key: string;
      effectiveDate: Date;
      attemptCount: number;
    },
    isResend: boolean,
  ): Promise<void> {
    const txid = deriveTxid(payout.orderRef, payout.effectiveDate);
    let result: BankSendResult;
    try {
      result = await this.bankService.send({ txid, amount: payout.amount, key: payout.key });
    } catch {
      // Any transport-level failure maps to transient: outcome unknown, wait for evidence.
      result = { outcome: SendOutcome.TRANSIENT };
    }
    await this.applySendResult(payout, result, isResend);
  }

  private async resendPayout(payout: {
    id: string;
    orderRef: string;
    txid: string;
    amount: number;
    key: string;
    effectiveDate: Date;
    attemptCount: number;
  }): Promise<void> {
    await this.sendPayout(payout, true);
  }

  private async applySendResult(
    payout: {
      id: string;
      attemptCount: number;
    },
    result: BankSendResult,
    isResend: boolean,
  ): Promise<void> {
    const nextAttempt = isResend ? payout.attemptCount + 1 : payout.attemptCount + 1;

    switch (result.outcome) {
      case SendOutcome.ACCEPTED:
        // In flight, awaiting statement evidence.
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.AWAITING_SET, {
          attemptCount: nextAttempt,
        });
        break;
      case SendOutcome.DUPLICATE:
        // Bank already holds this txid — success, not an error.
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.SETTLED, {
          attemptCount: nextAttempt,
        });
        break;
      case SendOutcome.TRANSIENT:
        // Outcome unknown — record the state and wait for evidence via reconciliation.
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.AWAITING_SET, {
          attemptCount: nextAttempt,
        });
        break;
      case SendOutcome.PERMANENT:
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.REJECTED, {
          attemptCount: nextAttempt,
        });
        break;
      default: {
        const _exhaustive: never = result.outcome as never;
        void _exhaustive;
        await this.payoutRepository.updateStatus(payout.id, PayoutStatus.AWAITING_SET, {
          attemptCount: nextAttempt,
        });
      }
    }
  }
}
