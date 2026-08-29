import { Injectable } from '@nestjs/common';
import type { PrismaClient } from './prisma.js';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Credit a wallet. Called only from the webhook handler, once the provider has
   * confirmed the money actually settled -- an accepted charge is not a settled one.
   */
  async credit(walletId: string, amountMinor: bigint, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: walletId },
        data: { balanceMinor: { increment: amountMinor } },
      });
      await tx.ledgerEntry.create({
        data: { walletId, amountMinor, type: 'CREDIT', reason },
      });
    });
  }
}
