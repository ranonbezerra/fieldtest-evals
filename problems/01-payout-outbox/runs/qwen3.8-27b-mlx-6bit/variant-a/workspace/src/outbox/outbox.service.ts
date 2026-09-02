import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { BlockchainProvider, PayoutStatus } from '../payout/payout.types.js';
import type { PayoutRepository } from '../payout/payout.repository.js';
import type { OutboxRepository } from './outbox.repository.js';

// ASSUMPTION: OutboxMessageRow is declared but not exported from outbox.repository.ts;
// the service defines a minimal local shape for what it consumes.
interface ClaimedMessage {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    const interval = parseInt(process.env.PAYOUT_POLL_INTERVAL_MS ?? '5000', 10);
    this.timer = setInterval(() => {
      void this.processMessages();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages: ClaimedMessage[] = await this.outboxRepo.claimPending(BATCH_SIZE);

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: ClaimedMessage): Promise<void> {
    const payout = await this.payoutRepo.findById(message.payoutId);

    if (!payout) {
      // Payout should always exist (FK constraint). Mark done to avoid infinite re-claim.
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Idempotent redelivery: if already terminal, just mark done.
    if (payout.status === 'completed' || payout.status === 'failed') {
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Transition to processing if still in created state.
    if (payout.status === 'created') {
      await this.payoutRepo.updatePayout(payout.id, 'processing');
    }

    try {
      const { txHash } = await this.provider.transfer({
        to: message.payload.to,
        amount: BigInt(message.payload.amount),
      });

      // Success: record tx hash, post ledger entry + decrement balance, mark message done.
      await this.payoutRepo.updatePayout(payout.id, 'completed', txHash);
      await this.payoutRepo.confirmPayoutLedger(payout.accountId, payout.id, payout.amount);
      await this.outboxRepo.markDone(message.id);
    } catch (error) {
      const attempts = message.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        // Retry exhausted with no definitive outcome: flag for human review.
        await this.payoutRepo.updatePayout(payout.id, 'needs_review');
        await this.outboxRepo.markDone(message.id);
      } else {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.outboxRepo.recordAttempt(message.id, attempts, null, errMsg);
      }
    }
  }
}
