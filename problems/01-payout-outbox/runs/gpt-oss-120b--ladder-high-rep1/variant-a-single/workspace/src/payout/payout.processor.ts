import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { ProviderService } from '../provider/provider.service.js';
import { PayoutStatus } from '@prisma/client';

const MAX_ATTEMPTS = 3;
const PROCESS_INTERVAL_MS = Number(process.env.PROCESS_INTERVAL_MS) || 5000;

@Injectable()
export class PayoutProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutProcessor.name);
  private interval: NodeJS.Timeout;

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly providerService: ProviderService,
  ) {}

  onModuleInit() {
    this.interval = setInterval(
      () => this.processPendingMessages(),
      PROCESS_INTERVAL_MS,
    );
    this.logger.log(`Payout processor started (interval ${PROCESS_INTERVAL_MS}ms)`);
  }

  async onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async processPendingMessages() {
    const messages = await this.payoutRepository.fetchPendingMessages(10);
    for (const msg of messages) {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        this.logger.error(`Failed processing message ${msg.id}`, err);
      }
    }
  }

  private async handleMessage(message: any) {
    const claimed = await this.payoutRepository.claimMessage(message.id);
    if (!claimed) return; // Already being processed or done

    const payout = await this.payoutRepository.getPayoutById(message.payout_id);
    if (!payout) {
      await this.payoutRepository.markMessageDone(message.id);
      return;
    }

    try {
      // Attempt blockchain transfer
      const result = await this.providerService.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });

      // Record transfer metadata and increment attempts
      await this.payoutRepository.updatePayoutStatus(payout.id, PayoutStatus.SENT, result.txHash);
      await this.payoutRepository.incrementPayoutAttempts(payout.id);

      // Settlement: debit settled balance, release reservation, ledger entry
      await this.payoutRepository.settlePayout(payout.id);

      // Mark message as processed
      await this.payoutRepository.markMessageDone(message.id);
    } catch (error) {
      // Transient failure
      await this.payoutRepository.incrementPayoutAttempts(payout.id);
      const refreshed = await this.payoutRepository.getPayoutById(payout.id);
      if ((refreshed?.attempts ?? 0) >= MAX_ATTEMPTS) {
        // Give up, human review required; keep reservation
        await this.payoutRepository.updatePayoutStatus(payout.id, PayoutStatus.NEEDS_REVIEW);
        await this.payoutRepository.markMessageDone(message.id);
      } else {
        // Retry later
        await this.payoutRepository.resetMessageToPending(message.id);
      }
    }
  }
}
