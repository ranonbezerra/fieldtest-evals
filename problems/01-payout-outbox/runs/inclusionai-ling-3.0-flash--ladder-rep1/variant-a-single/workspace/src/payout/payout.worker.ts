import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PayoutService } from "./payout.service.js";
import { MessageStatus, WORKER_INTERVAL_MS, MESSAGE_STUCK_TIMEOUT_MS } from "./payout.types.js";

@Injectable()
export class PayoutWorker implements OnModuleInit {
  constructor(
    private readonly payoutService: PayoutService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    setInterval(() => this.processMessages(), WORKER_INTERVAL_MS);
  }

  async processMessages() {
    await this.prisma.message.updateMany({
      where: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: {
          lt: new Date(Date.now() - MESSAGE_STUCK_TIMEOUT_MS) as unknown as Date,
        },
      },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
      },
    });

    const messages = await this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
      take: 100,
      include: { payout: true },
    });

    for (const message of messages) {
      await this.processSingleMessage(message.id, message.payoutId);
    }

    await this.payoutService.processConfirmations();
  }

  private async processSingleMessage(messageId: string, payoutId: string) {
    const locked = await this.tryLockMessage(messageId);
    if (!locked) return;

    try {
      await this.payoutService.processPayout(payoutId);
      await this.markMessageDone(messageId);
    } catch {
      await this.markMessageFailed(messageId);
    }
  }

  private async tryLockMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
      },
      data: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  private async markMessageDone(messageId: string) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED },
    });
  }

  private async markMessageFailed(messageId: string) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED },
    });
  }
}
