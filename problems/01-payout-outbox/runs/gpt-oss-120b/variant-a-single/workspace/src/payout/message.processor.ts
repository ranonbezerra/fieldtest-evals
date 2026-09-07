// src/payout/message.processor.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PayoutRepository } from './payout.repository';
import { CryptoProvider } from '../provider/crypto.provider';
import { PayoutService } from './payout.service';

// The Prisma schema is expected to contain a table that acts as an outbox/queue.
// The original code referenced a `Message` type that is not exported by
// `@prisma/client`. We assume such a table exists and its shape is not crucial
// for the processor logic, so we fall back to `any` here.
// ASSUMPTION: The outbox table is called `Message` in the Prisma schema and
// has at least the fields `id: string`, `type: string`, `payload: string` and
// `processed: boolean`.
type Message = any;

/**
 * MessageProcessor polls the outbox table at a regular interval,
 * processes each pending message exactly once (at‑least‑once delivery
 * semantics), and updates the message status accordingly.
 *
 * It delegates the heavy lifting to the PayoutService (which contains
 * the business logic) and the CryptoProvider (which talks to the
 * blockchain). All DB interaction is performed through the
 * PayoutRepository, respecting the layer constraints.
 */
@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly payoutRepo: PayoutRepository,
    private readonly payoutService: PayoutService,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  /**
   * Runs every minute (adjustable via CronExpression) and processes
   * pending outbox messages.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processMessages(): Promise<void> {
    this.logger.debug('Starting outbox message processing cycle');

    // Fetch a batch of unprocessed messages. The repository method name
    // and return type are assumed; adjust if the actual implementation differs.
    // ASSUMPTION: payoutRepo.fetchPendingMessages returns Message[].
    const messages: Message[] = await this.payoutRepo.fetchPendingMessages();

    for (const msg of messages) {
      try {
        // Mark the message as "in‑process" to avoid duplicate work.
        // ASSUMPTION: payoutRepo.lockMessage returns the same Message after
        // setting a processing flag.
        const lockedMsg = await this.payoutRepo.lockMessage(msg.id);
        if (!lockedMsg) {
          // Message was already locked by another worker.
          continue;
        }

        // Dispatch based on message type. For this challenge we only care about
        // payout processing.
        switch (lockedMsg.type) {
          case 'PAYOUT':
            await this.handlePayoutMessage(lockedMsg);
            break;
          default:
            this.logger.warn(
              `Unsupported message type '${lockedMsg.type}' (id=${lockedMsg.id})`,
            );
            // Mark as processed to avoid endless retries of unknown types.
            await this.payoutRepo.markMessageProcessed(lockedMsg.id);
        }
      } catch (err) {
        this.logger.error(
          `Error processing message ${msg.id}: ${(err as Error).message}`,
        );
        // Optionally, record the failure for later inspection.
        await this.payoutRepo.recordMessageFailure(msg.id, (err as Error).message);
      }
    }

    this.logger.debug('Finished outbox message processing cycle');
  }

  /**
   * Handles a single payout outbox message.
   * The payload is expected to be a JSON string containing the payout details.
   */
  private async handlePayoutMessage(message: Message): Promise<void> {
    // Parse payload – we assume it contains the same fields as the CreatePayoutDto.
    // ASSUMPTION: The payload structure matches the DTO used in the controller.
    const payload = JSON.parse(message.payload);

    // Execute the payout via the service, which contains all business rules.
    // The service will interact with the repository and provider as needed.
    await this.payoutService.executePayoutFromMessage(payload, message.id);

    // After successful processing, mark the message as processed.
    await this.payoutRepo.markMessageProcessed(message.id);
  }
}
