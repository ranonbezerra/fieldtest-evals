import { Injectable, OnModuleInit } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { CryptoProviderService } from '../provider/crypto-provider.js';

@Injectable()
export class PayoutWorkerService implements OnModuleInit {
  private intervalMs: number = Number(process.env.PAYOUT_WORKER_INTERVAL_MS) || 5000;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly provider: CryptoProviderService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.processMessages(), this.intervalMs);
  }

  async processMessages() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const message = await this.payoutRepository.fetchNextPendingMessage();
      if (!message) {
        return;
      }

      const locked = await this.payoutRepository.lockMessage(message.id);
      if (!locked) {
        return;
      }

      const payout = await this.payoutRepository.findPayoutById(message.payout_id);
      if (!payout) {
        await this.payoutRepository.markMessageFailed(message.id, 'Payout not found');
        return;
      }

      if (['COMPLETED', 'NEEDS_REVIEW', 'FAILED'].includes(payout.status)) {
        await this.payoutRepository.markMessageDone(message.id);
        return;
      }

      try {
        const result = await this.provider.transfer(payout.destination_address, payout.amount);
        await this.payoutRepository.settlePayout(payout.id, result.txHash);
        await this.payoutRepository.markMessageDone(message.id);
      } catch (error: any) {
        const errMsg = error?.message ?? 'Provider error';
        await this.payoutRepository.incrementMessageAttempts(message.id, errMsg);
        const attempts = await this.payoutRepository.getMessageAttempts(message.id);
        if (attempts >= message.max_attempts) {
          await this.payoutRepository.markPayoutNeedsReview(payout.id, errMsg);
          await this.payoutRepository.markMessageFailed(message.id, errMsg);
        } else {
          await this.payoutRepository.resetMessageToPending(message.id);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
