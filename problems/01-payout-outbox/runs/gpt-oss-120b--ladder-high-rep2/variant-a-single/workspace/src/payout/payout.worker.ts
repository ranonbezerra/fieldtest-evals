import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProviderService } from './provider.service';
import { Payout, Prisma } from '@prisma/client';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private readonly MAX_RETRIES = 3; // bounded retry count

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ProviderService,
  ) {}

  /**
   * Called on a schedule (e.g., every N seconds) to process queued messages.
   */
  async processMessages(): Promise<void> {
    const messages = await this.prisma.message.findMany({
      take: 10,
      orderBy: { created_at: 'asc' },
    });

    for (const msg of messages) {
      await this.processMessage(msg.id);
    }
  }

  private async processMessage(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      // Already processed
      return;
    }

    // Acquire lock: move payout from PENDING → PROCESSING
    const lock = await this.prisma.payout.updateMany({
      where: { id: message.payout_id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });

    if (lock.count !== 1) {
      // Already being processed or completed – clean up the stale message
      await this.prisma.message.delete({ where: { id: messageId } });
      return;
    }

    // Load payout with its account after locking
    const payout = await this.prisma.payout.findUnique({
      where: { id: message.payout_id },
      include: { account: true },
    });

    if (!payout) {
      await this.prisma.message.delete({ where: { id: messageId } });
      return;
    }

    try {
      const result = await this.provider.transfer({
        to: payout.destination_address,
        amount: payout.amount,
      });

      // Provider succeeded – settle the payout atomically
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Debit settled balance and release reservation
        await tx.account.update({
          where: { id: payout.account_id },
          data: {
            settled_balance: {
              decrement: payout.amount,
            },
            reserved_balance: {
              decrement: payout.amount,
            },
          },
        });

        // Record ledger entry (double‑entry style)
        await tx.ledgerEntry.create({
          data: {
            account_id: payout.account_id,
            payout_id: payout.id,
            amount: payout.amount,
            type: 'DEBIT',
            description: `Payout to ${payout.destination_address}`,
          },
        });

        // Mark payout as completed
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: 'COMPLETED',
            provider_tx_hash: result.txHash,
          },
        });

        // Remove the processed outbox message
        await tx.message.delete({ where: { id: messageId } });
      });
    } catch (err) {
      this.logger.warn(`Provider transfer failed for payout ${payout.id}: ${err}`);

      const newRetries = (payout as any).retries + 1;

      if (newRetries >= this.MAX_RETRIES) {
        // Exhausted retries – move to review state, keep reservation intact
        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.payout.update({
            where: { id: payout.id },
            data: {
              status: 'NEEDS_REVIEW',
              retries: newRetries,
            },
          });
          // Delete the message so we don't retry forever
          await tx.message.delete({ where: { id: messageId } });
        });
      } else {
        // Allow another attempt later
        await this.prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: 'PENDING',
            retries: newRetries,
          },
        });

        await this.prisma.message.update({
          where: { id: messageId },
          data: {
            attempt_count: {
              increment: 1,
            },
          },
        });
      }
    }
  }
}
