import { Injectable } from '@nestjs/common';
import { PrismaClient, Message, Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Fetch unprocessed messages (processedAt is null) */
  async fetchPendingMessages(limit: number): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { processedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** Attempt to claim a message for processing (optimistic lock) */
  async claimMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        processedAt: null,
      },
      data: {
        // We use the same column as a flag; setting processedAt later when done.
        // Here we just bump attempts to indicate we are working on it.
        attempts: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  /** Mark message as fully processed */
  async markMessageProcessed(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { processedAt: new Date() },
    });
  }

  /** Load payout together with its current status */
  async getPayout(payoutId: string): Promise<Payout> {
    return this.prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
    });
  }

  /** Update payout attempts counter */
  async incrementAttempts(payoutId: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { attempts: { increment: 1 } },
    });
  }
}
