# repair1-message.processor.ts

## reasoning

```
We need to write file fixing imports. Likely missing modules. We'll create minimal implementations: import PayoutRepository, CryptoProvider, Scheduler, PayoutService. Assuming they exist. We'll just import relative paths correctly. Use @Injectable and @Processor? Use @Cron from @nestjs/schedule. Implement class MessageProcessor with method handleMessages called by Cron. Use repository to get pending messages, process each: parse payload, call provider.transfer, update status, ledger, mark message. Use try/catch with retries count stored maybe in payload. Simplify.

Provide code.
```

## reply

```ts
// src/payout/message.processor.ts
// ---------------------------------------------------------------
// Message processor (outbox worker) for the payout domain.
// ---------------------------------------------------------------

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutRepository } from './payout.repository';
import { CryptoProvider } from '../provider/crypto.provider';
import { PayoutService } from './payout.service';
import { Message } from '@prisma/client';

interface TransferPayload {
  payoutId: string;
  destinationAddress: string;
  amount: number;
  retryCount?: number;
}

/**
 * The processor polls the `message` outbox table at a regular interval
 * (using a Cron job) and attempts to execute the blockchain transfer.
 * Delivery is at‑least‑once, therefore the processing is idempotent:
 *   - The payout status is checked before attempting a transfer.
 *   - Retries are bounded (default 3) and recorded in the payload.
 *   - After a successful provider call the ledger is updated and the
 *     message is marked as processed.
 *   - On permanent failure the payout is moved to a `FAILED` state and
 *     the message is still marked as processed to avoid endless loops.
 */
@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: CryptoProvider,
    private readonly payoutService: PayoutService,
  ) {}

  /**
   * Runs every minute (can be tuned via `CronExpression.EVERY_30_SECONDS`,
   * `EVERY_MINUTE`, etc.).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processMessages(): Promise<void> {
    const messages = await this.repository.getPendingMessages();

    for (const message of messages) {
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    let payload: TransferPayload;

    try {
      payload = JSON.parse(message.payload) as TransferPayload;
    } catch (err) {
      this.logger.error(
        `Failed to parse message payload (id=${message.id}): ${err}`,
      );
      // Malformed message – mark as processed to drop it.
      await this.repository.markMessageProcessed(message.id, false);
      return;
    }

    // Ensure we have a retry counter.
    payload.retryCount = payload.retryCount ?? 0;

    // Check payout status – if already sent/completed we can safely mark the
    // message as processed (idempotent handling of duplicate deliveries).
    const payout = await this.payoutService.findById(payload.payoutId);
    if (!payout) {
      this.logger.warn(
        `Payout not found for message (id=${message.id}, payoutId=${payload.payoutId}). Marking as processed.`,
      );
      await this.repository.markMessageProcessed(message.id, false);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // Already handled – just acknowledge the message.
      await this.repository.markMessageProcessed(message.id, true);
      return;
    }

    // Update payout status to PROCESSING (idempotent, will stay same if already set).
    await this.repository.updatePayoutStatus(payout.id, 'PROCESSING');

    try {
      const result = await this.provider.transfer({
        to: payload.destinationAddress,
        amount: payload.amount,
      });

      // Provider succeeded – mark payout as SENT, then COMPLETED,
      // and create ledger entries.
      await this.repository.updatePayoutStatus(payout.id, 'SENT');
      await this.repository.createLedgerEntries(
        payout.accountId,
        payload.amount,
      );
      await this.repository.updatePayoutStatus(payout.id, 'COMPLETED');

      // Finally, acknowledge the outbox message.
      await this.repository.markMessageProcessed(message.id, true);
      this.logger.log(
        `Successfully processed payout ${payout.id}, txHash=${result.txHash}`,
      );
    } catch (err) {
      // Provider threw – decide whether to retry or fail.
      payload.retryCount! += 1;

      if (payload.retryCount! <= this.MAX_RETRIES) {
        // Re‑queue the message with updated retry count.
        await this.repository.createMessage({
          ...payload,
        });
        this.logger.warn(
          `Transient failure for payout ${payout.id} (retry ${payload.retryCount}/${this.MAX_RETRIES}): ${err}`,
        );
      } else {
        // Exhausted retries – mark payout as FAILED and stop retrying.
        await this.repository.updatePayoutStatus(payout.id, 'FAILED');
        this.logger.error(
          `Exhausted retries for payout ${payout.id}: ${err}`,
        );
      }

      // In both cases we consider the current message processed to avoid
      // infinite loops.
      await this.repository.markMessageProcessed(message.id, false);
    }
  }
}
```
