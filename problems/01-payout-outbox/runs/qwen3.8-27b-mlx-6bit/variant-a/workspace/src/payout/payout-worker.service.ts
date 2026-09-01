import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import type { TransferProvider } from './payout.service.js';

const WORKER_POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const STALE_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('TRANSFER_PROVIDER') private readonly provider: TransferProvider,
    private readonly repo: PayoutRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error('processMessages failed', err instanceof Error ? err.stack : String(err));
      });
    }, WORKER_POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const [pending, stale] = await Promise.all([
      this.repo.nextPendingMessage(BATCH_SIZE),
      this.repo.claimStaleMessages(STALE_TIMEOUT_MS, BATCH_SIZE),
    ]);

    const candidates = [...pending, ...stale];

    for (const message of candidates) {
      try {
        await this.processOne(message);
      } catch (err) {
        this.logger.error(
          `Failed to process message ${message.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async processOne(message: {
    id: string;
    payoutId: string;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    const claimed = await this.repo.claimMessage(message.id);
    if (!claimed) {
      return;
    }

    const payout = await this.repo.findPayoutById(message.payoutId);
    if (!payout) {
      await this.repo.markMessageFailed(message.id, 'Payout not found');
      return;
    }

    await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.PROCESSING);

    const amount = BigInt(payout.amount);

    try {
      const { txHash } = await this.provider.transfer(payout.destinationAddress, amount);

      await this.repo.withTransaction(async (tx) => {
        await this.repo.settleLedger(message.payoutId, payout.accountId, amount, tx);
        await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.COMPLETED, txHash, tx);
        await this.repo.markMessageDone(message.id, tx);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (message.attempts < message.maxAttempts) {
        await this.repo.incrementAttempts(message.id, errorMessage);
      } else {
        await this.repo.withTransaction(async (tx) => {
          await this.repo.releaseHold(message.payoutId, payout.accountId, amount, tx);
          await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.NEEDS_REVIEW, undefined, tx);
          await this.repo.markMessageFailed(message.id, errorMessage, tx);
        });
      }
    }
  }
}
